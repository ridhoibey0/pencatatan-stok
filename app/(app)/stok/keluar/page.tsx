import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { recordMovement } from "@/lib/stock";
import { tanggalISO, angka } from "@/lib/format";
import { PageHeader, Card, FlashMessage, Tabs } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";
import { TABS } from "@/lib/nav";
import VariantPicker from "@/components/VariantPicker";

export const metadata = { title: "Catat Barang Keluar — Nerva" };
export const dynamic = "force-dynamic";

async function catatKeluar(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const variantId = Number(formData.get("variant_id"));
  const quantity = Number(formData.get("quantity"));
  const jenis = String(formData.get("jenis") ?? "out");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const date = tanggalISO(String(formData.get("date") ?? ""));

  if (!Number.isInteger(variantId) || variantId <= 0) {
    redirect("/stok/keluar?error=Pilih+SKU+dulu");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    redirect("/stok/keluar?error=Jumlah+harus+lebih+dari+nol");
  }

  const movementType = jenis === "damage" ? "damage" : "out";

  const result = await withTransaction((tx) =>
    recordMovement(tx, {
      variantId,
      quantity: -quantity,
      type: movementType,
      referenceType: "manual",
      notes,
      date,
      userId: user.id,
    }),
  );

  revalidatePath("/stok");
  revalidatePath("/stok/keluar");

  // Stok minus tidak ditolak -- lihat docs/PLANNING.md aturan 2.
  const pesan = result.wentNegative
    ? `Tercatat, tapi stok jadi ${result.balanceAfter}. Peringatan selisih dibuat — perlu stok opname.`
    : `Tercatat. Sisa stok ${result.balanceAfter}.`;

  redirect(
    `/stok/keluar?${result.wentNegative ? "error" : "ok"}=${encodeURIComponent(pesan)}`,
  );
}

export default async function CatatKeluarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

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

  const terakhir = await query<{
    id: number;
    sku: string;
    product_name: string;
    quantity: number;
    balance_after: number;
    notes: string | null;
    created_at: string;
  }>(
    `SELECT sm.id, pv.sku, p.name AS product_name, sm.quantity, sm.balance_after,
            sm.notes, sm.created_at
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.product_variant_id
       JOIN products p ON p.id = pv.product_id
      WHERE sm.reference_type = 'manual' AND sm.quantity < 0 AND sm.recorded_by = ?
      ORDER BY sm.id DESC LIMIT 8`,
    [user.id],
  );

  return (
    <>
      <PageHeader
        title="Catat Barang Keluar"
        description="Untuk barang keluar yang bukan dari penjualan marketplace: endorse, giveaway, dipakai sendiri, atau barang rusak."
      />

      <Tabs items={TABS.stok} active="/stok/keluar" />

      <FlashMessage ok={ok} error={error} />

      {variants.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>
            Belum ada varian produk.{" "}
            <Link href="/produk" style={{ color: "var(--brand)" }}>
              Tambahkan produk & varian dulu
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div
          className="keluar-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 420px) minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <Card>
            <form action={catatKeluar}>
              <VariantPicker variants={variants} />

              <div className="field">
                <label className="label" htmlFor="quantity">
                  Jumlah keluar
                </label>
                <input
                  id="quantity"
                  name="quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  defaultValue={1}
                  required
                  className="input"
                  style={{ fontSize: 20, fontWeight: 600, minHeight: 50 }}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="jenis">
                  Alasan
                </label>
                <select id="jenis" name="jenis" className="select" defaultValue="out">
                  <option value="out">Keluar (endorse, giveaway, dipakai)</option>
                  <option value="damage">Rusak / hilang</option>
                </select>
              </div>

              <div className="field">
                <label className="label" htmlFor="date">
                  Tanggal
                </label>
                <input
                  id="date"
                  name="date"
                  type="date"
                  className="input"
                  defaultValue={tanggalISO()}
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="notes">
                  Keterangan
                </label>
                <input
                  id="notes"
                  name="notes"
                  className="input"
                  placeholder="mis. endorse @akun, atau nomor pesanan"
                  maxLength={255}
                />
              </div>

              <SubmitButton
                className="btn btn-primary btn-lg"
                pendingLabel="Mencatat…"
                style={{ width: "100%" }}
              >
                Simpan Pencatatan
              </SubmitButton>
            </form>
          </Card>

          <div>
            <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>
              Pencatatan keluar terakhir oleh Anda
            </h2>
            <Card padded={false}>
              {terakhir.length === 0 ? (
                <div className="muted" style={{ padding: 22, fontSize: 14 }}>
                  Belum ada.
                </div>
              ) : (
                <div className="scroll-x">
                  <table className="data">
                    <tbody>
                      {terakhir.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <div style={{ fontWeight: 500, fontSize: 13.5 }}>
                              {t.product_name}
                            </div>
                            <div className="muted mono" style={{ fontSize: 12 }}>
                              {t.sku}
                              {t.notes ? ` · ${t.notes}` : ""}
                            </div>
                          </td>
                          <td className="num" style={{ color: "var(--bad)", fontWeight: 700 }}>
                            {angka(t.quantity)}
                          </td>
                          <td className="num muted" style={{ fontSize: 13 }}>
                            sisa {angka(t.balance_after)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 860px) {
          .keluar-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
