import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { query, queryOne, type Param } from "@/lib/db";
import { angka, sejak, tanggalJam } from "@/lib/format";
import { TABS } from "@/lib/nav";
import { PageHeader, Card, Empty, StockPill, Tabs } from "@/components/ui";
import Icon from "@/components/Icon";

export const metadata = { title: "Stok Sekarang — Nerva" };
export const dynamic = "force-dynamic";

interface Row {
  product_variant_id: number;
  sku: string;
  product_name: string;
  category_name: string;
  size: string | null;
  color: string | null;
  stock_on_hand: number;
  reorder_point: number;
  stock_status: string;
}

const FILTER: { value: string; label: string }[] = [
  { value: "", label: "Semua" },
  { value: "in_stock", label: "Aman" },
  { value: "low_stock", label: "Menipis" },
  { value: "out_of_stock", label: "Habis" },
];

export default async function StokPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { q = "", status = "" } = await searchParams;
  const bolehCatat = can(user.role, "record_stock");

  const where: string[] = [];
  const params: Param[] = [];

  if (q.trim()) {
    where.push("(sku LIKE ? OR product_name LIKE ? OR color LIKE ?)");
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  if (status && ["in_stock", "low_stock", "out_of_stock"].includes(status)) {
    where.push("stock_status = ?");
    params.push(status);
  }

  const rows = await query<Row>(
    `SELECT * FROM v_available_stock
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY stock_on_hand ASC, product_name ASC, size ASC`,
    params,
  );

  const last = await queryOne<{ at: string | null }>(
    `SELECT MAX(created_at) AS at FROM stock_movements`,
  );

  const totalUnit = rows.reduce((s, r) => s + Number(r.stock_on_hand), 0);
  const adaVarian = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM product_variants WHERE deleted_at IS NULL`,
  );

  function hrefFilter(v: string) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (v) sp.set("status", v);
    const s = sp.toString();
    return s ? `/stok?${s}` : "/stok";
  }

  return (
    <>
      <PageHeader
        title="Stok Sekarang"
        description="Jumlah barang jadi yang tercatat di gudang."
        action={
          bolehCatat ? (
            <Link href="/stok/keluar" className="btn btn-primary">
              <Icon name="truck-out" size={18} />
              Catat Keluar
            </Link>
          ) : undefined
        }
      />

      {bolehCatat && <Tabs items={TABS.stok} active="/stok" />}

      {/* Penanda waktu: angka tanpa keterangan kapan lebih berbahaya daripada
          angka yang jelas-jelas bertanda "data per tadi pagi". */}
      <div
        className="card"
        style={{
          padding: "11px 15px",
          marginBottom: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          fontSize: 13.5,
        }}
      >
        <Icon name="info" size={16} style={{ color: "var(--muted)" }} />
        <span className="muted">Pencatatan terakhir</span>
        <strong>{sejak(last?.at)}</strong>
        {last?.at && (
          <span className="muted hide-sm">({tanggalJam(last.at)})</span>
        )}
        <span className="muted" style={{ marginLeft: "auto" }}>
          {angka(rows.length)} SKU · {angka(totalUnit)} pcs
        </span>
      </div>

      <form style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 400 }}>
          <Icon
            name="search"
            size={17}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
            }}
          />
          <input
            name="q"
            className="input"
            defaultValue={q}
            placeholder="Cari SKU, produk, warna…"
            style={{ paddingLeft: 36 }}
          />
        </div>
        {status && <input type="hidden" name="status" value={status} />}
        <button type="submit" className="btn">
          Cari
        </button>
      </form>

      <div className="row" style={{ marginBottom: 14, gap: 6 }}>
        {FILTER.map((f) => (
          <Link
            key={f.value}
            href={hrefFilter(f.value)}
            className="btn btn-sm"
            style={
              status === f.value
                ? {
                    background: "var(--brand-soft)",
                    borderColor: "var(--brand)",
                    color: "var(--brand-text)",
                  }
                : undefined
            }
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          Number(adaVarian?.n ?? 0) === 0 ? (
            <Empty
              icon="tag"
              title="Belum ada varian produk"
              action={{ href: "/produk", label: "Buat produk pertama" }}
            >
              Stok menempel pada varian (SKU per ukuran dan warna), jadi produk dan
              variannya perlu dibuat dulu sebelum stok bisa dicatat.
            </Empty>
          ) : (
            <Empty icon="search" title="Tidak ada yang cocok">
              Coba kata kunci lain, atau ubah filter statusnya.
            </Empty>
          )
        ) : (
          <div className="scroll-x">
            <table className="data stack">
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Varian</th>
                  <th className="num">Stok</th>
                  <th className="num">Min</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product_variant_id}>
                    <td className="cell-main" data-label="">
                      <Link href={`/stok/${r.product_variant_id}`}>
                        <div style={{ fontWeight: 600 }}>{r.product_name}</div>
                        <div className="muted mono" style={{ fontSize: 12.5 }}>
                          {r.sku} · {r.category_name}
                        </div>
                      </Link>
                    </td>
                    <td data-label="Varian" className="muted">
                      {[r.color, r.size].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td
                      data-label="Stok"
                      className="num"
                      style={{
                        fontWeight: 700,
                        fontSize: 17,
                        color: Number(r.stock_on_hand) < 0 ? "var(--bad)" : undefined,
                      }}
                    >
                      {angka(r.stock_on_hand)}
                    </td>
                    <td data-label="Batas min." className="num muted">
                      {angka(r.reorder_point)}
                    </td>
                    <td data-label="Status">
                      <StockPill
                        stock={Number(r.stock_on_hand)}
                        reorderPoint={Number(r.reorder_point)}
                      />
                    </td>
                    <td data-label="" className="num">
                      <Link
                        href={`/stok/${r.product_variant_id}`}
                        className="btn btn-sm"
                      >
                        Riwayat
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <style>{`
        @media (max-width: 560px) { .hide-sm { display: none; } }
      `}</style>
    </>
  );
}
