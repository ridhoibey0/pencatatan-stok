import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { angka, sejak, tanggalJam, LABEL_MUTASI } from "@/lib/format";
import { PageHeader, Card, Empty, Grid, Stat, StockPill, Note } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ forbidden?: string }>;
}) {
  const user = await requireUser();
  const { forbidden } = await searchParams;

  const [ringkas, lastMove, mutasiHariIni, hitung] = await Promise.all([
    queryOne<{
      sku_aktif: number;
      total_unit: number;
      menipis: number;
      habis: number;
      minus: number;
    }>(
      `SELECT COUNT(*) AS sku_aktif,
              COALESCE(SUM(stock_on_hand), 0) AS total_unit,
              COALESCE(SUM(stock_on_hand > 0 AND stock_on_hand <= reorder_point), 0) AS menipis,
              COALESCE(SUM(stock_on_hand = 0), 0) AS habis,
              COALESCE(SUM(stock_on_hand < 0), 0) AS minus
         FROM product_variants
        WHERE is_active = 1 AND deleted_at IS NULL`,
    ),
    queryOne<{ at: string | null }>(`SELECT MAX(created_at) AS at FROM stock_movements`),
    queryOne<{ masuk: string; keluar: string }>(
      `SELECT COALESCE(SUM(GREATEST(quantity, 0)), 0) AS masuk,
              COALESCE(SUM(LEAST(quantity, 0)), 0)   AS keluar
         FROM stock_movements
        WHERE movement_date = CURDATE()`,
    ),
    queryOne<{ retur: number }>(
      `SELECT (SELECT COUNT(*) FROM orders o
                WHERE o.status='cancelled' AND o.shipped_at IS NOT NULL
                  AND EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_type='order'
                                AND sm.reference_id=o.id AND sm.quantity<0)
                  AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_type='order'
                                    AND sm.reference_id=o.id AND sm.quantity>0)) AS retur`,
    ),
  ]);

  const perluPerhatian = await query<{
    id: number;
    sku: string;
    product_name: string;
    size: string | null;
    color: string | null;
    stock_on_hand: number;
    reorder_point: number;
  }>(
    `SELECT pv.id, pv.sku, p.name AS product_name, pv.size, pv.color,
            pv.stock_on_hand, pv.reorder_point
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
      WHERE pv.is_active = 1 AND pv.deleted_at IS NULL
        AND pv.stock_on_hand <= pv.reorder_point
      ORDER BY pv.stock_on_hand ASC
      LIMIT 8`,
  );

  const terbaru = await query<{
    id: number;
    variant_id: number;
    sku: string;
    product_name: string;
    movement_type: string;
    quantity: number;
    created_at: string;
    user_name: string | null;
  }>(
    `SELECT sm.id, pv.id AS variant_id, pv.sku, p.name AS product_name,
            sm.movement_type, sm.quantity, sm.created_at, u.name AS user_name
       FROM stock_movements sm
       JOIN product_variants pv ON pv.id = sm.product_variant_id
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN users u ON u.id = sm.recorded_by
      ORDER BY sm.id DESC
      LIMIT 8`,
  );

  const returMenunggu = Number(hitung?.retur ?? 0);

  return (
    <>
      <PageHeader
        title={`Halo, ${user.name.split(" ")[0]}`}
        description={
          lastMove?.at
            ? `Pencatatan terakhir ${sejak(lastMove.at)} · ${tanggalJam(lastMove.at)}`
            : "Belum ada pencatatan stok sama sekali."
        }
      />

      {forbidden && (
        <Note tone="warn" icon="alert">
          Halaman itu tidak tersedia untuk peran Anda.
        </Note>
      )}

      {returMenunggu > 0 && can(user.role, "record_stock") && (
        <Note tone="warn" icon="undo">
          <strong>{returMenunggu} paket retur menunggu konfirmasi.</strong> Stoknya
          sudah dikurangi karena barang keluar gudang — konfirmasi saat paketnya
          sampai.{" "}
          <Link href="/stok/retur" style={{ textDecoration: "underline" }}>
            Buka halaman retur
          </Link>
        </Note>
      )}

      <Grid min={150} gap={12}>
        <Stat
          label="SKU aktif"
          value={angka(ringkas?.sku_aktif ?? 0)}
          href="/stok"
          icon="tag"
        />
        <Stat
          label="Unit di gudang"
          value={angka(ringkas?.total_unit ?? 0)}
          icon="box"
        />
        <Stat
          label="Stok menipis"
          value={angka(ringkas?.menipis ?? 0)}
          tone={Number(ringkas?.menipis ?? 0) > 0 ? "warn" : "default"}
          href="/stok?status=low_stock"
        />
        <Stat
          label="Stok habis"
          value={angka(ringkas?.habis ?? 0)}
          tone={Number(ringkas?.habis ?? 0) > 0 ? "bad" : "default"}
          href="/stok?status=out_of_stock"
        />
        <Stat
          label="Stok minus"
          value={angka(ringkas?.minus ?? 0)}
          tone={Number(ringkas?.minus ?? 0) > 0 ? "bad" : "default"}
          hint={Number(ringkas?.minus ?? 0) > 0 ? "perlu opname" : "aman"}
        />
        <Stat
          label="Mutasi hari ini"
          value={`+${angka(mutasiHariIni?.masuk ?? 0)} / ${angka(mutasiHariIni?.keluar ?? 0)}`}
          hint="masuk / keluar"
        />
      </Grid>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 18,
        }}
      >
        <Card
          padded={false}
          title="Perlu perhatian"
          action={
            <Link href="/stok?status=low_stock" className="muted" style={{ fontSize: 13 }}>
              Lihat semua →
            </Link>
          }
        >
          {perluPerhatian.length === 0 ? (
            <Empty icon="check" title="Semua aman">
              Tidak ada SKU yang menyentuh batas minimum.
            </Empty>
          ) : (
            <table className="data">
              <tbody>
                {perluPerhatian.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/stok/${r.id}`}>
                        <div style={{ fontWeight: 550, fontSize: 13.8 }}>
                          {r.product_name}
                        </div>
                        <div className="muted mono" style={{ fontSize: 12 }}>
                          {r.sku} · {[r.color, r.size].filter(Boolean).join(" ")}
                        </div>
                      </Link>
                    </td>
                    <td className="num" style={{ fontWeight: 700, fontSize: 16 }}>
                      {angka(r.stock_on_hand)}
                    </td>
                    <td style={{ width: 1 }}>
                      <StockPill
                        stock={Number(r.stock_on_hand)}
                        reorderPoint={Number(r.reorder_point)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card padded={false} title="Pencatatan terbaru">
          {terbaru.length === 0 ? (
            <Empty icon="clipboard" title="Belum ada mutasi">
              Setiap barang masuk dan keluar akan muncul di sini beserta siapa yang
              mencatatnya.
            </Empty>
          ) : (
            <table className="data">
              <tbody>
                {terbaru.map((m) => {
                  const qty = Number(m.quantity);
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link href={`/stok/${m.variant_id}`}>
                          <div style={{ fontWeight: 550, fontSize: 13.8 }}>
                            {m.product_name}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {tanggalJam(m.created_at)} · {m.user_name ?? "sistem"}
                          </div>
                        </Link>
                      </td>
                      <td style={{ width: 1 }}>
                        <span className={qty > 0 ? "pill pill-ok" : "pill pill-bad"}>
                          {LABEL_MUTASI[m.movement_type] ?? m.movement_type}
                        </span>
                      </td>
                      <td
                        className="num"
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          color: qty > 0 ? "var(--ok)" : "var(--bad)",
                        }}
                      >
                        {qty > 0 ? "+" : ""}
                        {angka(qty)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
