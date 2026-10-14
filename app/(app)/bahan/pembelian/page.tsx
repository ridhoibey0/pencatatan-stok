import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { recordMaterialMovement } from "@/lib/stock";
import { angka, rupiah, tanggal, tanggalISO } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import { TABS } from "@/lib/nav";
import PurchaseForm from "./PurchaseForm";

export const metadata = { title: "Pembelian Bahan — Nerva" };
export const dynamic = "force-dynamic";

async function simpanPembelian(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const supplierName = String(formData.get("supplier_name") ?? "").trim();
  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim() || null;
  const purchaseDate = tanggalISO(String(formData.get("purchase_date") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const materialIds = formData.getAll("material_id").map((v) => Number(v));
  const quantities = formData.getAll("quantity").map((v) => Number(v));
  const prices = formData.getAll("unit_price").map((v) => Number(v) || 0);

  const items = materialIds
    .map((materialId, i) => ({
      materialId,
      quantity: quantities[i] ?? 0,
      unitPrice: prices[i] ?? 0,
    }))
    .filter((r) => Number.isInteger(r.materialId) && r.materialId > 0 && r.quantity > 0);

  if (!supplierName) redirect("/bahan/pembelian?error=Nama+supplier+wajib+diisi");
  if (items.length === 0) {
    redirect("/bahan/pembelian?error=Isi+minimal+satu+bahan+dengan+jumlah");
  }

  await withTransaction(async (tx) => {
    let supplier = await tx.queryOne<{ id: number }>(
      `SELECT id FROM suppliers WHERE name = ?`,
      [supplierName],
    );
    if (!supplier) {
      const ins = await tx.execute(`INSERT INTO suppliers (name) VALUES (?)`, [supplierName]);
      supplier = { id: ins.insertId };
    }

    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

    const { insertId: purchaseId } = await tx.execute(
      `INSERT INTO material_purchases
         (invoice_number, supplier_id, purchase_date, total_amount, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invoiceNumber, supplier.id, purchaseDate, total, notes, user.id],
    );

    for (const it of items) {
      await tx.execute(
        `INSERT INTO material_purchase_items
           (material_purchase_id, material_id, quantity, unit_price)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [purchaseId, it.materialId, it.quantity, it.unitPrice],
      );

      await recordMaterialMovement(tx, {
        materialId: it.materialId,
        quantity: it.quantity,
        type: "in",
        referenceType: "material_purchase",
        referenceId: purchaseId,
        notes: invoiceNumber ? `Nota ${invoiceNumber}` : `Pembelian dari ${supplierName}`,
        date: purchaseDate,
        userId: user.id,
      });
    }
  });

  revalidatePath("/bahan");
  revalidatePath("/bahan/pembelian");
  redirect(
    `/bahan/pembelian?ok=${encodeURIComponent(`${items.length} bahan dicatat masuk.`)}`,
  );
}

export default async function PembelianPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

  const materials = await query<{
    id: number;
    code: string;
    name: string;
    unit: string;
    stock_on_hand: string;
  }>(
    `SELECT id, code, name, unit, stock_on_hand FROM materials
      WHERE is_active = 1 AND deleted_at IS NULL ORDER BY name`,
  );

  const suppliers = await query<{ name: string }>(
    `SELECT name FROM suppliers WHERE is_active = 1 ORDER BY name`,
  );

  const riwayat = await query<{
    id: number;
    invoice_number: string | null;
    purchase_date: string;
    total_amount: string;
    supplier_name: string;
    item_count: number;
    user_name: string | null;
  }>(
    `SELECT mp.id, mp.invoice_number, mp.purchase_date, mp.total_amount,
            s.name AS supplier_name, COUNT(mpi.id) AS item_count, u.name AS user_name
       FROM material_purchases mp
       JOIN suppliers s ON s.id = mp.supplier_id
       LEFT JOIN material_purchase_items mpi ON mpi.material_purchase_id = mp.id
       LEFT JOIN users u ON u.id = mp.recorded_by
      GROUP BY mp.id, mp.invoice_number, mp.purchase_date, mp.total_amount,
               s.name, u.name
      ORDER BY mp.id DESC LIMIT 15`,
  );

  return (
    <>
      <PageHeader
        title="Pembelian Bahan"
        description="Satu nota bisa berisi banyak bahan. Stok bahan bertambah saat disimpan."
      />

      <Tabs items={TABS.bahan} active="/bahan/pembelian" />

      <FlashMessage ok={ok} error={error} />

      {materials.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>
            Belum ada data bahan baku.{" "}
            <Link href="/bahan" style={{ color: "var(--brand)" }}>
              Tambahkan bahan dulu
            </Link>
            .
          </p>
        </Card>
      ) : (
        <PurchaseForm
          action={simpanPembelian}
          materials={materials}
          suppliers={suppliers.map((s) => s.name)}
          today={tanggalISO()}
        />
      )}

      <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Pembelian terakhir</h2>
      <Card padded={false}>
        {riwayat.length === 0 ? (
          <Empty>Belum ada pembelian tercatat.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Supplier</th>
                  <th>Nota</th>
                  <th className="num">Jenis bahan</th>
                  <th className="num">Total</th>
                  <th>Dicatat oleh</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id}>
                    <td>{tanggal(r.purchase_date)}</td>
                    <td>{r.supplier_name}</td>
                    <td className="mono muted" style={{ fontSize: 13 }}>
                      {r.invoice_number ?? "—"}
                    </td>
                    <td className="num">{angka(r.item_count)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {rupiah(r.total_amount)}
                    </td>
                    <td className="muted">{r.user_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
