import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { angka, rupiah, tanggal, tanggalISO } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import { TABS } from "@/lib/nav";
import ProductionForm from "./ProductionForm";

export const metadata = { title: "Order Produksi — Nerva" };
export const dynamic = "force-dynamic";

const LABEL_STATUS: Record<string, { teks: string; kelas: string }> = {
  draft: { teks: "Draft", kelas: "pill pill-muted" },
  in_progress: { teks: "Diproses", kelas: "pill pill-warn" },
  completed: { teks: "Selesai", kelas: "pill pill-ok" },
  cancelled: { teks: "Batal", kelas: "pill pill-muted" },
};

async function buatOrderProduksi(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const manufacturerName = String(formData.get("manufacturer_name") ?? "").trim();
  const orderedDate = tanggalISO(String(formData.get("ordered_date") ?? ""));
  const dueDateRaw = String(formData.get("due_date") ?? "").trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : null;
  const laborCostRaw = String(formData.get("labor_cost") ?? "").trim();
  const laborCost = laborCostRaw ? Number(laborCostRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const variantIds = formData.getAll("variant_id").map((v) => Number(v));
  const quantities = formData.getAll("quantity").map((v) => Number(v));

  const items = variantIds
    .map((variantId, i) => ({ variantId, quantity: quantities[i] ?? 0 }))
    .filter((r) => Number.isInteger(r.variantId) && r.variantId > 0 && r.quantity > 0);

  if (!manufacturerName) redirect("/produksi?error=Nama+konveksi+wajib+diisi");
  if (items.length === 0) {
    redirect("/produksi?error=Tambahkan+minimal+satu+varian+dengan+jumlah");
  }

  await withTransaction(async (tx) => {
    // Konveksi dicari dulu; dibuat kalau belum ada, supaya tidak perlu
    // halaman master terpisah untuk data sesederhana ini.
    let manufacturer = await tx.queryOne<{ id: number }>(
      `SELECT id FROM manufacturers WHERE name = ?`,
      [manufacturerName],
    );
    if (!manufacturer) {
      const ins = await tx.execute(`INSERT INTO manufacturers (name) VALUES (?)`, [
        manufacturerName,
      ]);
      manufacturer = { id: ins.insertId };
    }

    const seq = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM production_orders`,
    );
    const refNo = `PO-${new Date().getFullYear()}-${String(seq?.n ?? 1).padStart(4, "0")}`;

    const { insertId: orderId } = await tx.execute(
      `INSERT INTO production_orders
         (reference_no, manufacturer_id, ordered_date, due_date, status,
          labor_cost, notes, created_by)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
      [refNo, manufacturer.id, orderedDate, dueDate, laborCost, notes, user.id],
    );

    for (const item of items) {
      await tx.execute(
        `INSERT INTO production_order_items
           (production_order_id, product_variant_id, quantity_ordered)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity_ordered = quantity_ordered + VALUES(quantity_ordered)`,
        [orderId, item.variantId, item.quantity],
      );
    }
  });

  // Belum ada mutasi stok di sini -- barang baru dipesan, belum datang.
  revalidatePath("/produksi");
  revalidatePath("/penerimaan");
  redirect("/produksi?ok=Order+produksi+dibuat.+Catat+barangnya+di+menu+Penerimaan+saat+datang.");
}

export default async function ProduksiPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

  const orders = await query<{
    id: number;
    reference_no: string;
    manufacturer_name: string;
    ordered_date: string;
    due_date: string | null;
    status: string;
    labor_cost: string | null;
    total_ordered: number;
    total_produced: number;
  }>(
    `SELECT po.id, po.reference_no, m.name AS manufacturer_name,
            po.ordered_date, po.due_date, po.status, po.labor_cost,
            COALESCE(SUM(poi.quantity_ordered), 0)  AS total_ordered,
            COALESCE(SUM(poi.quantity_produced), 0) AS total_produced
       FROM production_orders po
       JOIN manufacturers m ON m.id = po.manufacturer_id
       LEFT JOIN production_order_items poi ON poi.production_order_id = po.id
      GROUP BY po.id, po.reference_no, m.name, po.ordered_date, po.due_date,
               po.status, po.labor_cost
      ORDER BY po.id DESC
      LIMIT 50`,
  );

  const variants = await query<{
    id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
    stock_on_hand: number;
  }>(
    `SELECT pv.id, pv.sku, p.name AS product_name, pv.size, pv.color, pv.stock_on_hand
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
      WHERE pv.is_active = 1 AND pv.deleted_at IS NULL
      ORDER BY p.name, pv.color, pv.size`,
  );

  const konveksi = await query<{ name: string }>(
    `SELECT name FROM manufacturers WHERE is_active = 1 ORDER BY name`,
  );

  return (
    <>
      <PageHeader
        title="Order Produksi"
        description="Pesanan ke konveksi. Stok belum berubah di sini — baru bertambah saat barangnya diterima."
      />

      <Tabs items={TABS.gudangMasuk} active="/produksi" />

      <FlashMessage ok={ok} error={error} />

      <ProductionForm
        action={buatOrderProduksi}
        variants={variants}
        manufacturers={konveksi.map((k) => k.name)}
        today={tanggalISO()}
      />

      <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Daftar order</h2>
      <Card padded={false}>
        {orders.length === 0 ? (
          <Empty>Belum ada order produksi.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Konveksi</th>
                  <th>Tanggal</th>
                  <th>Target</th>
                  <th className="num">Dipesan</th>
                  <th className="num">Jadi</th>
                  <th>Status</th>
                  <th className="num">Biaya maklon</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const l = LABEL_STATUS[o.status] ?? {
                    teks: o.status,
                    kelas: "pill pill-muted",
                  };
                  const kurang =
                    Number(o.total_produced) < Number(o.total_ordered) &&
                    o.status !== "cancelled";
                  return (
                    <tr key={o.id}>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {o.reference_no}
                      </td>
                      <td>{o.manufacturer_name}</td>
                      <td>{tanggal(o.ordered_date)}</td>
                      <td className="muted">{o.due_date ? tanggal(o.due_date) : "—"}</td>
                      <td className="num">{angka(o.total_ordered)}</td>
                      <td
                        className="num"
                        style={{ fontWeight: 600, color: kurang ? "var(--warn)" : "var(--ok)" }}
                      >
                        {angka(o.total_produced)}
                      </td>
                      <td>
                        <span className={l.kelas}>{l.teks}</span>
                      </td>
                      <td className="num muted">
                        {o.labor_cost ? rupiah(o.labor_cost) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
