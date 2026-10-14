import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { query, queryOne, type Param } from "@/lib/db";
import {
  angka,
  rupiah,
  tanggalJam,
  LABEL_STATUS_PESANAN,
  LABEL_SUMBER_PESANAN,
} from "@/lib/format";
import { PageHeader, Card, Empty, Grid, Stat, Tabs } from "@/components/ui";
import { TABS } from "@/lib/nav";
import Icon from "@/components/Icon";

export const metadata = { title: "Pesanan — Nerva" };
export const dynamic = "force-dynamic";

const KELAS_STATUS: Record<string, string> = {
  pending: "pill pill-muted",
  processing: "pill pill-warn",
  shipped: "pill pill-warn",
  completed: "pill pill-ok",
  cancelled: "pill pill-bad",
};

const PER_HAL = 50;

export default async function PesananPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sumber?: string; hal?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { q = "", status = "", sumber = "", hal = "1" } = await searchParams;
  const halaman = Math.max(1, Number(hal) || 1);

  const where: string[] = [];
  const params: Param[] = [];

  if (q.trim()) {
    where.push("(o.order_number LIKE ? OR o.tracking_number LIKE ? OR o.buyer_username LIKE ?)");
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  if (["pending", "processing", "shipped", "completed", "cancelled"].includes(status)) {
    where.push("o.status = ?");
    params.push(status);
  }
  if (["live", "video", "product_card", "other"].includes(sumber)) {
    where.push("o.order_source = ?");
    params.push(sumber);
  }
  const klausa = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM orders o ${klausa}`,
    params,
  );
  const totalHal = Math.max(1, Math.ceil(Number(total?.n ?? 0) / PER_HAL));

  const orders = await query<{
    id: number;
    order_number: string;
    status: string;
    order_source: string;
    creator_handle: string | null;
    ordered_at: string;
    grand_total: string;
    channel_name: string;
    buyer_username: string | null;
    item_count: number;
    unit_count: number;
  }>(
    `SELECT o.id, o.order_number, o.status, o.order_source, o.creator_handle,
            o.ordered_at, o.grand_total, sc.name AS channel_name, o.buyer_username,
            COUNT(oi.id) AS item_count,
            COALESCE(SUM(oi.quantity), 0) AS unit_count
       FROM orders o
       JOIN sales_channels sc ON sc.id = o.sales_channel_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       ${klausa}
      GROUP BY o.id, o.order_number, o.status, o.order_source, o.creator_handle,
               o.ordered_at, o.grand_total, sc.name, o.buyer_username
      ORDER BY o.ordered_at DESC
      LIMIT ${PER_HAL} OFFSET ${(halaman - 1) * PER_HAL}`,
    params,
  );

  const ringkas = await queryOne<{
    total: number;
    selesai: number;
    batal: number;
    live: number;
    omzet: string;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(status = 'completed') AS selesai,
            SUM(status = 'cancelled') AS batal,
            SUM(order_source = 'live') AS live,
            COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN grand_total ELSE 0 END), 0) AS omzet
       FROM orders`,
  );

  const batalPersen =
    Number(ringkas?.total ?? 0) > 0
      ? Math.round((Number(ringkas?.batal ?? 0) / Number(ringkas!.total)) * 100)
      : 0;

  function url(patch: Record<string, string>) {
    const sp = new URLSearchParams({ q, status, sumber, hal: String(halaman), ...patch });
    for (const [k, v] of [...sp.entries()]) if (!v || v === "1") sp.delete(k);
    const s = sp.toString();
    return s ? `/pesanan?${s}` : "/pesanan";
  }

  return (
    <>
      <PageHeader
        title="Pesanan"
        description="Hasil import dari marketplace. Halaman ini hanya mencatat — pemrosesan pesanan tetap di marketplace."
        action={
          <Link href="/import" className="btn btn-primary">
            <Icon name="upload" size={18} />
            Import File
          </Link>
        }
      />

      <Tabs items={TABS.pesanan} active="/pesanan" />

      <Grid min={165} gap={12}>
        <Stat label="Total pesanan" value={angka(ringkas?.total ?? 0)} />
        <Stat label="Selesai" value={angka(ringkas?.selesai ?? 0)} tone="ok" />
        <Stat
          label="Dibatalkan"
          value={angka(ringkas?.batal ?? 0)}
          tone={batalPersen >= 20 ? "bad" : "default"}
          hint={`${batalPersen}% dari total`}
        />
        <Stat label="Dari live" value={angka(ringkas?.live ?? 0)} />
        <Stat label="Nilai (non-batal)" value={rupiah(ringkas?.omzet ?? 0)} />
      </Grid>

      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 12px" }}
      >
        <input
          name="q"
          className="input"
          defaultValue={q}
          placeholder="Cari no. pesanan, resi, atau pembeli…"
          style={{ flex: "1 1 240px", maxWidth: 340 }}
        />
        <select name="status" className="select" defaultValue={status} style={{ width: 165 }}>
          <option value="">Semua status</option>
          {Object.entries(LABEL_STATUS_PESANAN).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="sumber" className="select" defaultValue={sumber} style={{ width: 150 }}>
          <option value="">Semua sumber</option>
          {Object.entries(LABEL_SUMBER_PESANAN).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn">Terapkan</button>
        {(q || status || sumber) && (
          <Link href="/pesanan" className="btn">
            Reset
          </Link>
        )}
      </form>

      <Card padded={false}>
        {orders.length === 0 ? (
          <Empty>
            {q || status || sumber
              ? "Tidak ada pesanan yang cocok."
              : "Belum ada pesanan. Upload file export di halaman Import."}
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="data stack">
              <thead>
                <tr>
                  <th>No. Pesanan</th>
                  <th>Waktu</th>
                  <th>Channel</th>
                  <th>Sumber</th>
                  <th>Status</th>
                  <th className="num">Item</th>
                  <th className="num">Pcs</th>
                  <th className="num">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="cell-main" data-label="">
                      <Link href={`/pesanan/${o.id}`} style={{ color: "var(--brand)" }}>
                        {o.order_number}
                      </Link>
                      {o.buyer_username && (
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {o.buyer_username}
                        </div>
                      )}
                    </td>
                    <td data-label="Waktu" style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                      {tanggalJam(o.ordered_at)}
                    </td>
                    <td data-label="Channel" className="muted">{o.channel_name}</td>
                    <td data-label="Sumber">
                      <span
                        className={
                          o.order_source === "live" ? "pill pill-warn" : "pill pill-muted"
                        }
                      >
                        {LABEL_SUMBER_PESANAN[o.order_source] ?? o.order_source}
                      </span>
                      {o.creator_handle && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                          {o.creator_handle}
                        </div>
                      )}
                    </td>
                    <td data-label="Status">
                      <span className={KELAS_STATUS[o.status] ?? "pill pill-muted"}>
                        {LABEL_STATUS_PESANAN[o.status] ?? o.status}
                      </span>
                    </td>
                    <td data-label="Item" className="num">{angka(o.item_count)}</td>
                    <td data-label="Pcs" className="num">{angka(o.unit_count)}</td>
                    <td data-label="Nilai" className="num">{rupiah(o.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalHal > 1 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 14,
          }}
        >
          {halaman > 1 && (
            <Link href={url({ hal: String(halaman - 1) })} className="btn">
              ← Sebelumnya
            </Link>
          )}
          <span className="muted" style={{ fontSize: 13.5 }}>
            Halaman {halaman} dari {totalHal}
          </span>
          {halaman < totalHal && (
            <Link href={url({ hal: String(halaman + 1) })} className="btn">
              Berikutnya →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
