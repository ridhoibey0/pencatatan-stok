import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { angka, tanggalJam, LABEL_MUTASI } from "@/lib/format";
import { PageHeader, Card, Empty, StockPill, Grid, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

interface Variant {
  id: number;
  sku: string;
  size: string | null;
  color: string | null;
  stock_on_hand: number;
  reorder_point: number;
  product_name: string;
  category_name: string;
}

interface Movement {
  id: number;
  movement_type: string;
  quantity: number;
  balance_after: number;
  reference_type: string;
  reference_id: number | null;
  notes: string | null;
  movement_date: string;
  created_at: string;
  user_name: string | null;
  reverses_id: number | null;
}

const REF_LABEL: Record<string, string> = {
  goods_receipt: "Penerimaan",
  order: "Pesanan",
  stock_count: "Opname",
  manual: "Manual",
};

export default async function KartuStokPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const variantId = Number(id);
  if (!Number.isInteger(variantId)) notFound();

  const v = await queryOne<Variant>(
    `SELECT pv.id, pv.sku, pv.size, pv.color, pv.stock_on_hand, pv.reorder_point,
            p.name AS product_name, c.name AS category_name
       FROM product_variants pv
       JOIN products p   ON p.id = pv.product_id
       JOIN categories c ON c.id = p.category_id
      WHERE pv.id = ?`,
    [variantId],
  );
  if (!v) notFound();

  const movements = await query<Movement>(
    `SELECT sm.id, sm.movement_type, sm.quantity, sm.balance_after,
            sm.reference_type, sm.reference_id, sm.notes, sm.movement_date,
            sm.created_at, sm.reverses_id, u.name AS user_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.recorded_by
      WHERE sm.product_variant_id = ?
      ORDER BY sm.id DESC
      LIMIT 300`,
    [variantId],
  );

  const totalIn = movements
    .filter((m) => Number(m.quantity) > 0)
    .reduce((s, m) => s + Number(m.quantity), 0);
  const totalOut = movements
    .filter((m) => Number(m.quantity) < 0)
    .reduce((s, m) => s + Number(m.quantity), 0);

  return (
    <>
      <PageHeader
        title={`${v.sku} — ${v.product_name}`}
        description={[v.color, v.size].filter(Boolean).join(" · ") || v.category_name}
        back={{ href: "/stok", label: "Stok" }}
      />

      <Grid min={170} gap={12}>
        <Stat
          label="Stok sekarang"
          value={angka(v.stock_on_hand)}
          tone={
            Number(v.stock_on_hand) <= 0
              ? "bad"
              : Number(v.stock_on_hand) <= Number(v.reorder_point)
                ? "warn"
                : "ok"
          }
        />
        <Stat label="Batas minimum" value={angka(v.reorder_point)} />
        <Stat label="Total masuk" value={angka(totalIn)} hint="dari riwayat termuat" />
        <Stat label="Total keluar" value={angka(Math.abs(totalOut))} hint="dari riwayat termuat" />
      </Grid>

      <div style={{ margin: "18px 0 10px", display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Kartu Stok</h2>
        <StockPill
          stock={Number(v.stock_on_hand)}
          reorderPoint={Number(v.reorder_point)}
        />
        <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>
          {movements.length >= 300 ? "300 mutasi terakhir" : `${movements.length} mutasi`}
        </span>
      </div>

      <Card padded={false}>
        {movements.length === 0 ? (
          <Empty>Belum ada mutasi untuk SKU ini.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Jenis</th>
                  <th className="num">Jumlah</th>
                  <th className="num">Sisa</th>
                  <th>Referensi</th>
                  <th>Keterangan</th>
                  <th>Dicatat oleh</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                        {tanggalJam(m.created_at)}
                      </td>
                      <td>
                        <span
                          className={
                            qty > 0
                              ? "pill pill-ok"
                              : m.movement_type === "correction"
                                ? "pill pill-muted"
                                : "pill pill-bad"
                          }
                        >
                          {LABEL_MUTASI[m.movement_type] ?? m.movement_type}
                        </span>
                      </td>
                      <td
                        className="num"
                        style={{
                          fontWeight: 600,
                          color: qty > 0 ? "var(--ok)" : "var(--bad)",
                        }}
                      >
                        {qty > 0 ? "+" : ""}
                        {angka(qty)}
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {angka(m.balance_after)}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {REF_LABEL[m.reference_type] ?? m.reference_type}
                        {m.reference_id ? ` #${m.reference_id}` : ""}
                      </td>
                      <td className="muted" style={{ fontSize: 13, maxWidth: 260 }}>
                        {m.notes ?? "—"}
                        {m.reverses_id && (
                          <span className="pill pill-muted" style={{ marginLeft: 6 }}>
                            koreksi #{m.reverses_id}
                          </span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {m.user_name ?? "sistem"}
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
