import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import {
  angka,
  rupiah,
  tanggalJam,
  LABEL_MUTASI,
  LABEL_STATUS_PESANAN,
  LABEL_SUMBER_PESANAN,
} from "@/lib/format";
import { PageHeader, Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DetailPesananPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();

  const o = await queryOne<{
    id: number;
    order_number: string;
    status: string;
    platform_status: string | null;
    order_source: string;
    creator_handle: string | null;
    ordered_at: string;
    paid_at: string | null;
    shipped_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    courier: string | null;
    tracking_number: string | null;
    province: string | null;
    city: string | null;
    buyer_username: string | null;
    recipient_name: string | null;
    phone: string | null;
    shipping_cost: string;
    discount_total: string;
    grand_total: string;
    cancelled_by: string | null;
    cancel_reason: string | null;
    refund_amount: string;
    channel_name: string;
    batch_id: number | null;
  }>(
    `SELECT o.*, sc.name AS channel_name, o.import_batch_id AS batch_id
       FROM orders o
       JOIN sales_channels sc ON sc.id = o.sales_channel_id
      WHERE o.id = ?`,
    [orderId],
  );
  if (!o) notFound();

  const items = await query<{
    id: number;
    variant_id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
    channel_sku_id: string | null;
    quantity: number;
    returned_quantity: number;
    unit_price: string;
    discount: string;
    subtotal: string;
  }>(
    `SELECT oi.id, pv.id AS variant_id, pv.sku, p.name AS product_name,
            pv.size, pv.color, oi.channel_sku_id, oi.quantity,
            oi.returned_quantity, oi.unit_price, oi.discount, oi.subtotal
       FROM order_items oi
       JOIN product_variants pv ON pv.id = oi.product_variant_id
       JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = ?`,
    [orderId],
  );

  const movements = await query<{
    id: number;
    sku: string;
    movement_type: string;
    quantity: number;
    balance_after: number;
    created_at: string;
    notes: string | null;
  }>(
    `SELECT sm.id, pv.sku, sm.movement_type, sm.quantity, sm.balance_after,
            sm.created_at, sm.notes
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.product_variant_id
      WHERE sm.reference_type = 'order' AND sm.reference_id = ?
      ORDER BY sm.id`,
    [orderId],
  );

  const baris = (label: string, nilai: React.ReactNode) => (
    <div style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: 13.5 }}>
      <div className="muted" style={{ width: 140, flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ minWidth: 0 }}>{nilai}</div>
    </div>
  );

  const menungguRetur =
    o.status === "cancelled" &&
    o.shipped_at &&
    movements.some((m) => Number(m.quantity) < 0) &&
    !movements.some((m) => Number(m.quantity) > 0);

  return (
    <>
      <PageHeader
        title={o.order_number}
        description={`${o.channel_name} · ${LABEL_SUMBER_PESANAN[o.order_source] ?? o.order_source}${
          o.creator_handle ? ` · ${o.creator_handle}` : ""
        }`}
        back={{ href: "/pesanan", label: "Semua pesanan" }}
      />

      {menungguRetur && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          Paket ini sudah dikirim lalu dibatalkan, dan stoknya belum dikembalikan.{" "}
          <Link href="/stok/retur" style={{ textDecoration: "underline" }}>
            Konfirmasi di halaman retur
          </Link>{" "}
          saat barangnya sampai di gudang.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        <Card>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Status & waktu</h2>
          {baris(
            "Status",
            <>
              <span>{LABEL_STATUS_PESANAN[o.status] ?? o.status}</span>
              {o.platform_status && (
                <span className="muted"> (di marketplace: {o.platform_status})</span>
              )}
            </>,
          )}
          {baris("Dipesan", tanggalJam(o.ordered_at))}
          {baris("Dibayar", o.paid_at ? tanggalJam(o.paid_at) : "—")}
          {baris("Dikirim", o.shipped_at ? tanggalJam(o.shipped_at) : "—")}
          {baris("Diterima", o.completed_at ? tanggalJam(o.completed_at) : "—")}
          {o.cancelled_at && baris("Dibatalkan", tanggalJam(o.cancelled_at))}
          {o.cancel_reason &&
            baris("Alasan batal", `${o.cancel_reason} (${o.cancelled_by ?? "—"})`)}
          {Number(o.refund_amount) > 0 && baris("Refund", rupiah(o.refund_amount))}
        </Card>

        <Card>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Pengiriman & pembeli</h2>
          {baris("Kurir", o.courier ?? "—")}
          {baris("No. resi", <span className="mono">{o.tracking_number ?? "—"}</span>)}
          {baris("Tujuan", [o.city, o.province].filter(Boolean).join(", ") || "—")}
          {baris("Pembeli", o.buyer_username ?? "—")}
          {baris("Penerima", o.recipient_name ?? "—")}
          {baris("Telepon", o.phone ?? "—")}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Data pembeli disamarkan oleh marketplace di file export.
          </div>
        </Card>

        <Card>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Nilai</h2>
          {baris("Ongkir", rupiah(o.shipping_cost))}
          {baris("Total diskon", rupiah(o.discount_total))}
          {baris(
            "Total dibayar",
            <strong style={{ fontSize: 15 }}>{rupiah(o.grand_total)}</strong>,
          )}
          {baris("Batch import", o.batch_id ? `#${o.batch_id}` : "—")}
        </Card>
      </div>

      <h2 style={{ fontSize: 15, margin: "20px 0 10px" }}>Item</h2>
      <Card padded={false}>
        <div className="scroll-x">
          <table className="data">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produk</th>
                <th>SKU ID marketplace</th>
                <th className="num">Qty</th>
                <th className="num">Retur</th>
                <th className="num">Harga</th>
                <th className="num">Diskon</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="mono" style={{ fontSize: 13 }}>
                    <Link href={`/stok/${it.variant_id}`} style={{ color: "var(--brand)" }}>
                      {it.sku}
                    </Link>
                  </td>
                  <td>
                    <div style={{ fontSize: 13.5 }}>{it.product_name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {[it.color, it.size].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="mono muted" style={{ fontSize: 11.5 }}>
                    {it.channel_sku_id ?? "—"}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {angka(it.quantity)}
                  </td>
                  <td className="num muted">{angka(it.returned_quantity)}</td>
                  <td className="num">{rupiah(it.unit_price)}</td>
                  <td className="num muted">{rupiah(it.discount)}</td>
                  <td className="num">{rupiah(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 style={{ fontSize: 15, margin: "20px 0 10px" }}>Mutasi stok dari pesanan ini</h2>
      <Card padded={false}>
        {movements.length === 0 ? (
          <Empty>
            Tidak ada mutasi stok. Pesanan ini dibatalkan sebelum barangnya keluar gudang.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>SKU</th>
                  <th>Jenis</th>
                  <th className="num">Jumlah</th>
                  <th className="num">Sisa</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                        {tanggalJam(m.created_at)}
                      </td>
                      <td className="mono" style={{ fontSize: 13 }}>
                        {m.sku}
                      </td>
                      <td>
                        <span className={qty > 0 ? "pill pill-ok" : "pill pill-bad"}>
                          {LABEL_MUTASI[m.movement_type] ?? m.movement_type}
                        </span>
                      </td>
                      <td
                        className="num"
                        style={{ fontWeight: 600, color: qty > 0 ? "var(--ok)" : "var(--bad)" }}
                      >
                        {qty > 0 ? "+" : ""}
                        {angka(qty)}
                      </td>
                      <td className="num">{angka(m.balance_after)}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {m.notes ?? "—"}
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
