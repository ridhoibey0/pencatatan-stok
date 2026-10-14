import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { recordMovement } from "@/lib/stock";
import { angka, tanggal, tanggalISO, rupiah } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import { TABS } from "@/lib/nav";

export const metadata = { title: "Konfirmasi Retur — Nerva" };
export const dynamic = "force-dynamic";

interface MenungguRow {
  order_id: number;
  order_number: string;
  cancel_reason: string | null;
  shipped_at: string;
  cancelled_at: string | null;
  tracking_number: string | null;
  refund_amount: string;
  variant_id: number;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
  quantity: number;
}

/**
 * Pesanan yang barangnya sudah keluar gudang lalu dibatalkan, dan paketnya
 * belum dikonfirmasi kembali. Tidak perlu kolom status tersendiri -- cukup
 * diturunkan dari ada/tidaknya mutasi masuk untuk pesanan itu.
 */
const SQL_MENUNGGU = `
  SELECT o.id AS order_id, o.order_number, o.cancel_reason, o.shipped_at,
         o.cancelled_at, o.tracking_number, o.refund_amount,
         pv.id AS variant_id, pv.sku, p.name AS product_name, pv.size, pv.color,
         oi.quantity
    FROM orders o
    JOIN order_items oi      ON oi.order_id = o.id
    JOIN product_variants pv ON pv.id = oi.product_variant_id
    JOIN products p          ON p.id = pv.product_id
   WHERE o.status = 'cancelled'
     AND o.shipped_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM stock_movements sm
                  WHERE sm.reference_type = 'order' AND sm.reference_id = o.id
                    AND sm.quantity < 0)
     AND NOT EXISTS (SELECT 1 FROM stock_movements sm
                      WHERE sm.reference_type = 'order' AND sm.reference_id = o.id
                        AND sm.quantity > 0)
   ORDER BY o.cancelled_at ASC, o.id ASC`;

async function konfirmasiRetur(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const orderId = Number(formData.get("order_id"));
  const kondisi = String(formData.get("kondisi") ?? "resellable");
  const tanggalTerima = tanggalISO(String(formData.get("tanggal") ?? ""));

  if (!Number.isInteger(orderId) || orderId <= 0) {
    redirect("/stok/retur?error=Pesanan+tidak+valid");
  }

  const hasil = await withTransaction(async (tx) => {
    const order = await tx.queryOne<{ id: number; order_number: string }>(
      `SELECT id, order_number FROM orders WHERE id = ? FOR UPDATE`,
      [orderId],
    );
    if (!order) throw new Error("Pesanan tidak ditemukan");

    // Jaga-jaga kalau dua orang menekan tombol yang sama bersamaan.
    const sudah = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM stock_movements
        WHERE reference_type = 'order' AND reference_id = ? AND quantity > 0`,
      [orderId],
    );
    if (Number(sudah?.n ?? 0) > 0) return { sudahPernah: true, total: 0 };

    const items = await tx.query<{ product_variant_id: number; quantity: number }>(
      `SELECT product_variant_id, quantity FROM order_items WHERE order_id = ?`,
      [orderId],
    );

    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity);
      // Barang rusak tetap dicatat masuk lalu dikeluarkan lagi sebagai 'damage',
      // supaya jejaknya lengkap: pernah kembali, lalu disingkirkan.
      await recordMovement(tx, {
        variantId: Number(it.product_variant_id),
        quantity: qty,
        type: "return",
        referenceType: "order",
        referenceId: orderId,
        notes: `Retur pesanan ${order.order_number}`,
        date: tanggalTerima,
        userId: user.id,
      });
      if (kondisi === "damaged") {
        await recordMovement(tx, {
          variantId: Number(it.product_variant_id),
          quantity: -qty,
          type: "damage",
          referenceType: "order",
          referenceId: orderId,
          notes: `Barang retur rusak, pesanan ${order.order_number}`,
          date: tanggalTerima,
          userId: user.id,
        });
      }
      total += qty;
    }
    return { sudahPernah: false, total };
  });

  revalidatePath("/stok/retur");
  revalidatePath("/stok");

  if (hasil.sudahPernah) {
    redirect("/stok/retur?error=Retur+pesanan+ini+sudah+dikonfirmasi+sebelumnya");
  }
  redirect(
    `/stok/retur?ok=${encodeURIComponent(
      kondisi === "damaged"
        ? `${hasil.total} pcs dicatat kembali lalu ditandai rusak.`
        : `${hasil.total} pcs masuk kembali ke stok.`,
    )}`,
  );
}

export default async function ReturPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

  const rows = await query<MenungguRow>(SQL_MENUNGGU);

  const perOrder = new Map<number, { info: MenungguRow; items: MenungguRow[] }>();
  for (const r of rows) {
    const e = perOrder.get(r.order_id);
    if (e) e.items.push(r);
    else perOrder.set(r.order_id, { info: r, items: [r] });
  }
  const orders = [...perOrder.values()];
  const totalPcs = rows.reduce((s, r) => s + Number(r.quantity), 0);

  return (
    <>
      <PageHeader
        title="Konfirmasi Retur"
        description="Paket yang sudah dikirim lalu dibatalkan. Stok baru bertambah setelah paketnya benar-benar diterima kembali di gudang."
      />

      <Tabs items={TABS.stok} active="/stok/retur" />

      <FlashMessage ok={ok} error={error} />

      {orders.length === 0 ? (
        <Card>
          <Empty>Tidak ada paket retur yang menunggu konfirmasi.</Empty>
        </Card>
      ) : (
        <>
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <strong>
              {orders.length} paket ({angka(totalPcs)} pcs) sedang dalam perjalanan pulang.
            </strong>{" "}
            Stoknya sudah dikurangi karena barang memang keluar gudang. Konfirmasi
            di sini saat paketnya sampai, bukan saat pembatalannya muncul di
            marketplace — barang di jalan belum bisa dijual.
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {orders.map(({ info, items }) => (
              <Card key={info.order_id}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 14,
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ minWidth: 240 }}>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                      {info.order_number}
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                      Dikirim {tanggal(info.shipped_at)} · Dibatalkan{" "}
                      {tanggal(info.cancelled_at)}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {info.cancel_reason ?? "—"}
                      {info.tracking_number ? ` · resi ${info.tracking_number}` : ""}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      Refund {rupiah(info.refund_amount)}
                    </div>

                    <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                      {items.map((it) => (
                        <li key={it.variant_id}>
                          <strong>{angka(it.quantity)}×</strong> {it.product_name}{" "}
                          <span className="muted mono">{it.sku}</span>{" "}
                          <span className="muted">
                            {[it.color, it.size].filter(Boolean).join(" ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <form
                    action={konfirmasiRetur}
                    style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
                  >
                    <input type="hidden" name="order_id" value={info.order_id} />
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label className="label">Tanggal terima</label>
                      <input
                        name="tanggal"
                        type="date"
                        className="input"
                        defaultValue={tanggalISO()}
                        style={{ width: 150 }}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label className="label">Kondisi</label>
                      <select name="kondisi" className="select" style={{ width: 150 }}>
                        <option value="resellable">Layak jual</option>
                        <option value="damaged">Rusak</option>
                      </select>
                    </div>
                    <button className="btn btn-primary" style={{ minHeight: 40 }}>
                      Barang Diterima
                    </button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
