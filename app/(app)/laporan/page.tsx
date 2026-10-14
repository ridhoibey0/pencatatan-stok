import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { angka, rupiah, tanggal, tanggalISO } from "@/lib/format";
import { PageHeader, Card, Empty, Grid, Stat } from "@/components/ui";

export const metadata = { title: "Laporan — Nerva" };
export const dynamic = "force-dynamic";

function awalBulan(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const dari = tanggalISO(sp.dari) === tanggalISO() && !sp.dari ? awalBulan() : tanggalISO(sp.dari);
  const sampai = tanggalISO(sp.sampai);

  const [mutasi, terlaris, dead, nilai, perSumber] = await Promise.all([
    queryOne<{ masuk: string; keluar: string; opname: string; hari: number }>(
      `SELECT COALESCE(SUM(GREATEST(quantity,0)),0) AS masuk,
              COALESCE(SUM(LEAST(quantity,0)),0)    AS keluar,
              COALESCE(SUM(CASE WHEN movement_type='count_adjustment' THEN quantity ELSE 0 END),0) AS opname,
              COUNT(DISTINCT movement_date) AS hari
         FROM stock_movements
        WHERE movement_date BETWEEN ? AND ?`,
      [dari, sampai],
    ),
    query<{
      variant_id: number;
      sku: string;
      product_name: string;
      size: string | null;
      color: string | null;
      terjual: string;
    }>(
      `SELECT pv.id AS variant_id, pv.sku, p.name AS product_name, pv.size, pv.color,
              COALESCE(-SUM(sm.quantity), 0) AS terjual
         FROM stock_movements sm
         JOIN product_variants pv ON pv.id = sm.product_variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE sm.reference_type = 'order' AND sm.quantity < 0
          AND sm.movement_date BETWEEN ? AND ?
        GROUP BY pv.id, pv.sku, p.name, pv.size, pv.color
        ORDER BY terjual DESC
        LIMIT 12`,
      [dari, sampai],
    ),
    query<{
      variant_id: number;
      sku: string;
      product_name: string;
      stock_on_hand: number;
      terakhir: string | null;
    }>(
      `SELECT pv.id AS variant_id, pv.sku, p.name AS product_name, pv.stock_on_hand,
              (SELECT MAX(sm.movement_date) FROM stock_movements sm
                WHERE sm.product_variant_id = pv.id AND sm.quantity < 0) AS terakhir
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.is_active = 1 AND pv.deleted_at IS NULL AND pv.stock_on_hand > 0
       HAVING terakhir IS NULL OR terakhir < DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY pv.stock_on_hand DESC
        LIMIT 12`,
    ),
    queryOne<{ unit: string; nilai: string }>(
      `SELECT COALESCE(SUM(pv.stock_on_hand),0) AS unit,
              COALESCE(SUM(pv.stock_on_hand * COALESCE(pv.price, p.base_price)),0) AS nilai
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
        WHERE pv.is_active = 1 AND pv.deleted_at IS NULL AND pv.stock_on_hand > 0`,
    ),
    query<{ order_source: string; jumlah: number; pcs: string; nilai: string }>(
      `SELECT o.order_source, COUNT(DISTINCT o.id) AS jumlah,
              COALESCE(SUM(oi.quantity),0) AS pcs,
              COALESCE(SUM(oi.subtotal),0) AS nilai
         FROM orders o
         LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE DATE(o.ordered_at) BETWEEN ? AND ? AND o.status <> 'cancelled'
        GROUP BY o.order_source
        ORDER BY pcs DESC`,
      [dari, sampai],
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Laporan"
        description="Ringkasan mutasi stok dan penjualan untuk rentang tanggal yang dipilih."
      />

      <Card style={{ marginBottom: 18 }}>
        <form style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="dari">
              Dari
            </label>
            <input id="dari" name="dari" type="date" className="input" defaultValue={dari} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="sampai">
              Sampai
            </label>
            <input
              id="sampai"
              name="sampai"
              type="date"
              className="input"
              defaultValue={sampai}
            />
          </div>
          <button className="btn btn-primary" style={{ minHeight: 42 }}>
            Tampilkan
          </button>
          <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
            {tanggal(dari)} — {tanggal(sampai)}
          </span>
        </form>
      </Card>

      <Grid min={168} gap={12}>
        <Stat label="Barang masuk" value={`+${angka(mutasi?.masuk ?? 0)}`} tone="ok" />
        <Stat label="Barang keluar" value={angka(mutasi?.keluar ?? 0)} tone="bad" />
        <Stat
          label="Penyesuaian opname"
          value={angka(mutasi?.opname ?? 0)}
          tone={Number(mutasi?.opname ?? 0) !== 0 ? "warn" : "default"}
        />
        <Stat label="Hari ada mutasi" value={angka(mutasi?.hari ?? 0)} />
        <Stat label="Unit di gudang" value={angka(nilai?.unit ?? 0)} />
        <Stat
          label="Nilai persediaan"
          value={rupiah(nilai?.nilai ?? 0)}
          hint="harga jual × stok"
        />
      </Grid>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
          gap: 16,
          marginTop: 18,
        }}
      >
        <div>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Paling laku</h2>
          <Card padded={false}>
            {terlaris.length === 0 ? (
              <Empty>Belum ada penjualan di rentang ini.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="data">
                  <tbody>
                    {terlaris.map((t, i) => (
                      <tr key={t.variant_id}>
                        <td className="muted num" style={{ width: 28 }}>
                          {i + 1}
                        </td>
                        <td>
                          <Link href={`/stok/${t.variant_id}`}>
                            <div style={{ fontSize: 13.5 }}>{t.product_name}</div>
                            <div className="muted mono" style={{ fontSize: 12 }}>
                              {t.sku} · {[t.color, t.size].filter(Boolean).join(" ")}
                            </div>
                          </Link>
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {angka(t.terjual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>
            Stok mengendap{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              (tidak laku 30 hari+)
            </span>
          </h2>
          <Card padded={false}>
            {dead.length === 0 ? (
              <Empty>Tidak ada stok yang mengendap.</Empty>
            ) : (
              <div className="scroll-x">
                <table className="data">
                  <tbody>
                    {dead.map((d) => (
                      <tr key={d.variant_id}>
                        <td>
                          <Link href={`/stok/${d.variant_id}`}>
                            <div style={{ fontSize: 13.5 }}>{d.product_name}</div>
                            <div className="muted mono" style={{ fontSize: 12 }}>
                              {d.sku}
                            </div>
                          </Link>
                        </td>
                        <td className="num" style={{ fontWeight: 700 }}>
                          {angka(d.stock_on_hand)}
                        </td>
                        <td className="muted num" style={{ fontSize: 12.5 }}>
                          {d.terakhir ? `laku ${tanggal(d.terakhir)}` : "belum pernah"}
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

      <h2 style={{ fontSize: 15, margin: "20px 0 10px" }}>Penjualan per sumber</h2>
      <Card padded={false}>
        {perSumber.length === 0 ? (
          <Empty>Belum ada pesanan di rentang ini.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Sumber</th>
                  <th className="num">Pesanan</th>
                  <th className="num">Pcs</th>
                  <th className="num">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {perSumber.map((s) => (
                  <tr key={s.order_source}>
                    <td>
                      <span
                        className={
                          s.order_source === "live" ? "pill pill-warn" : "pill pill-muted"
                        }
                      >
                        {s.order_source === "live"
                          ? "Live"
                          : s.order_source === "video"
                            ? "Video"
                            : s.order_source === "product_card"
                              ? "Etalase"
                              : "Lainnya"}
                      </span>
                    </td>
                    <td className="num">{angka(s.jumlah)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {angka(s.pcs)}
                    </td>
                    <td className="num">{rupiah(s.nilai)}</td>
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
