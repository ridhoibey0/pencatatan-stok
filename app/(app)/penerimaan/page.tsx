import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { recordMovement } from "@/lib/stock";
import { angka, tanggal, tanggalISO } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import { TABS } from "@/lib/nav";
import ReceiptForm from "./ReceiptForm";

export const metadata = { title: "Penerimaan Barang — Nerva" };
export const dynamic = "force-dynamic";

async function simpanPenerimaan(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");

  const productionOrderId = Number(formData.get("production_order_id"));
  const invoiceNumber = String(formData.get("invoice_number") ?? "").trim() || null;
  const receivedDate = tanggalISO(String(formData.get("received_date") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Baris dikirim sebagai variant_id[] dan quantity[] yang sejajar.
  const variantIds = formData.getAll("variant_id").map((v) => Number(v));
  const quantities = formData.getAll("quantity").map((v) => Number(v));
  const rejects = formData.getAll("quantity_rejected").map((v) => Number(v) || 0);

  const items = variantIds
    .map((variantId, i) => ({
      variantId,
      quantity: quantities[i] ?? 0,
      rejected: rejects[i] ?? 0,
    }))
    .filter((r) => Number.isInteger(r.variantId) && r.variantId > 0 && r.quantity > 0);

  if (!Number.isInteger(productionOrderId) || productionOrderId <= 0) {
    redirect("/penerimaan?error=Pilih+order+produksi+dulu");
  }
  if (items.length === 0) {
    redirect("/penerimaan?error=Isi+minimal+satu+baris+dengan+jumlah+lebih+dari+nol");
  }

  await withTransaction(async (tx) => {
    const seq = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM goods_receipts`,
    );
    const refNo = `GR-${new Date().getFullYear()}-${String(seq?.n ?? 1).padStart(4, "0")}`;

    const { insertId: receiptId } = await tx.execute(
      `INSERT INTO goods_receipts
         (reference_no, production_order_id, invoice_number, received_date, notes, received_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [refNo, productionOrderId, invoiceNumber, receivedDate, notes, user.id],
    );

    for (const item of items) {
      await tx.execute(
        `INSERT INTO goods_receipt_items
           (goods_receipt_id, product_variant_id, quantity, quantity_rejected)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity),
                                 quantity_rejected = quantity_rejected + VALUES(quantity_rejected)`,
        [receiptId, item.variantId, item.quantity, item.rejected],
      );

      await recordMovement(tx, {
        variantId: item.variantId,
        quantity: item.quantity,
        type: "in",
        referenceType: "goods_receipt",
        referenceId: receiptId,
        notes: invoiceNumber ? `Nota ${invoiceNumber}` : null,
        date: receivedDate,
        userId: user.id,
      });

      await tx.execute(
        `UPDATE production_order_items
            SET quantity_produced = quantity_produced + ?,
                quantity_rejected = quantity_rejected + ?
          WHERE production_order_id = ? AND product_variant_id = ?`,
        [item.quantity, item.rejected, productionOrderId, item.variantId],
      );
    }

    // Order produksi ditandai selesai kalau semua barisnya sudah terpenuhi.
    const sisa = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM production_order_items
        WHERE production_order_id = ? AND quantity_produced < quantity_ordered`,
      [productionOrderId],
    );
    if (Number(sisa?.n ?? 0) === 0) {
      await tx.execute(
        `UPDATE production_orders
            SET status = 'completed', completed_date = ?
          WHERE id = ? AND status <> 'completed'`,
        [receivedDate, productionOrderId],
      );
    }
  });

  revalidatePath("/penerimaan");
  revalidatePath("/stok");
  revalidatePath("/produksi");
  redirect(`/penerimaan?ok=${encodeURIComponent(`${items.length} baris diterima, stok bertambah.`)}`);
}

export default async function PenerimaanPage({
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
    status: string;
  }>(
    `SELECT po.id, po.reference_no, m.name AS manufacturer_name,
            po.ordered_date, po.status
       FROM production_orders po
       JOIN manufacturers m ON m.id = po.manufacturer_id
      WHERE po.status IN ('draft','in_progress')
      ORDER BY po.ordered_date DESC`,
  );

  const orderItems = await query<{
    production_order_id: number;
    variant_id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
    quantity_ordered: number;
    quantity_produced: number;
  }>(
    `SELECT poi.production_order_id, pv.id AS variant_id, pv.sku,
            p.name AS product_name, pv.size, pv.color,
            poi.quantity_ordered, poi.quantity_produced
       FROM production_order_items poi
       JOIN product_variants pv ON pv.id = poi.product_variant_id
       JOIN products p ON p.id = pv.product_id
       JOIN production_orders po ON po.id = poi.production_order_id
      WHERE po.status IN ('draft','in_progress')
      ORDER BY p.name, pv.color, pv.size`,
  );

  const riwayat = await query<{
    id: number;
    reference_no: string;
    invoice_number: string | null;
    received_date: string;
    manufacturer_name: string;
    total_qty: number;
    receiver: string | null;
  }>(
    `SELECT gr.id, gr.reference_no, gr.invoice_number, gr.received_date,
            m.name AS manufacturer_name,
            COALESCE(SUM(gri.quantity), 0) AS total_qty,
            u.name AS receiver
       FROM goods_receipts gr
       JOIN production_orders po ON po.id = gr.production_order_id
       JOIN manufacturers m ON m.id = po.manufacturer_id
       LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
       LEFT JOIN users u ON u.id = gr.received_by
      GROUP BY gr.id, gr.reference_no, gr.invoice_number, gr.received_date,
               m.name, u.name
      ORDER BY gr.id DESC
      LIMIT 15`,
  );

  return (
    <>
      <PageHeader
        title="Penerimaan Barang"
        description="Catat barang jadi yang datang dari konveksi. Stok bertambah saat disimpan."
      />

      <Tabs items={TABS.gudangMasuk} active="/penerimaan" />

      <FlashMessage ok={ok} error={error} />

      {orders.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>
            Tidak ada order produksi yang masih berjalan.{" "}
            <Link href="/produksi" style={{ color: "var(--brand)" }}>
              Buat order produksi dulu
            </Link>{" "}
            supaya penerimaan bisa dicocokkan dengan pesanannya.
          </p>
        </Card>
      ) : (
        <ReceiptForm
          action={simpanPenerimaan}
          orders={orders}
          items={orderItems}
          today={tanggalISO()}
        />
      )}

      <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Penerimaan terakhir</h2>
      <Card padded={false}>
        {riwayat.length === 0 ? (
          <Empty>Belum ada penerimaan tercatat.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Tanggal</th>
                  <th>Konveksi</th>
                  <th>Nota</th>
                  <th className="num">Jumlah</th>
                  <th>Diterima oleh</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id}>
                    <td className="mono" style={{ fontSize: 13 }}>
                      {r.reference_no}
                    </td>
                    <td>{tanggal(r.received_date)}</td>
                    <td>{r.manufacturer_name}</td>
                    <td className="muted mono" style={{ fontSize: 13 }}>
                      {r.invoice_number ?? "—"}
                    </td>
                    <td className="num" style={{ fontWeight: 600, color: "var(--ok)" }}>
                      +{angka(r.total_qty)}
                    </td>
                    <td className="muted">{r.receiver ?? "—"}</td>
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
