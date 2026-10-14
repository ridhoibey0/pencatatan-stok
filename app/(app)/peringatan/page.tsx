import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireRole } from "@/lib/auth";
import { query, execute } from "@/lib/db";
import { angka, tanggalJam } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage } from "@/components/ui";

export const metadata = { title: "Peringatan Stok — Nerva" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, { teks: string; kelas: string }> = {
  low_stock: { teks: "Menipis", kelas: "pill pill-warn" },
  out_of_stock: { teks: "Habis", kelas: "pill pill-bad" },
  variance: { teks: "Selisih", kelas: "pill pill-bad" },
};

async function tandaiSelesai(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");
  const id = Number(formData.get("id"));
  await execute(
    `UPDATE stock_alerts
        SET status = 'resolved', resolved_by = ?, resolved_at = NOW()
      WHERE id = ?`,
    [user.id, id],
  );
  revalidatePath("/peringatan");
  redirect("/peringatan?ok=Peringatan+ditandai+selesai");
}

export default async function PeringatanPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; semua?: string }>;
}) {
  await requireUser();
  const { ok, error, semua } = await searchParams;
  const tampilSemua = semua === "1";

  const rows = await query<{
    id: number;
    alert_type: string;
    message: string;
    stock_level: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
    variant_id: number | null;
    sku: string | null;
    product_name: string | null;
    material_name: string | null;
    resolver: string | null;
  }>(
    `SELECT a.id, a.alert_type, a.message, a.stock_level, a.status,
            a.created_at, a.resolved_at,
            pv.id AS variant_id, pv.sku, p.name AS product_name,
            m.name AS material_name, u.name AS resolver
       FROM stock_alerts a
       LEFT JOIN product_variants pv ON pv.id = a.product_variant_id
       LEFT JOIN products p          ON p.id = pv.product_id
       LEFT JOIN materials m         ON m.id = a.material_id
       LEFT JOIN users u             ON u.id = a.resolved_by
      ${tampilSemua ? "" : "WHERE a.status <> 'resolved'"}
      ORDER BY (a.status = 'resolved'), a.created_at DESC
      LIMIT 200`,
  );

  return (
    <>
      <PageHeader
        title="Peringatan Stok"
        description="Muncul otomatis saat stok menyentuh batas minimum, habis, atau jadi minus."
        action={
          <Link href={tampilSemua ? "/peringatan" : "/peringatan?semua=1"} className="btn">
            {tampilSemua ? "Sembunyikan yang selesai" : "Tampilkan semua"}
          </Link>
        }
      />

      <FlashMessage ok={ok} error={error} />

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty>
            {tampilSemua
              ? "Belum pernah ada peringatan."
              : "Tidak ada peringatan terbuka. Semua stok dalam batas aman."}
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Jenis</th>
                  <th>Item</th>
                  <th>Pesan</th>
                  <th className="num">Stok</th>
                  <th>Waktu</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const l = LABEL[r.alert_type] ?? {
                    teks: r.alert_type,
                    kelas: "pill pill-muted",
                  };
                  const selesai = r.status === "resolved";
                  return (
                    <tr key={r.id} style={{ opacity: selesai ? 0.55 : 1 }}>
                      <td>
                        <span className={l.kelas}>{l.teks}</span>
                      </td>
                      <td>
                        {r.variant_id ? (
                          <Link href={`/stok/${r.variant_id}`}>
                            <div style={{ fontWeight: 500 }}>{r.product_name}</div>
                            <div className="muted mono" style={{ fontSize: 12 }}>
                              {r.sku}
                            </div>
                          </Link>
                        ) : (
                          <div>{r.material_name ?? "—"}</div>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 13.5, maxWidth: 360 }}>
                        {r.message}
                      </td>
                      <td
                        className="num"
                        style={{
                          fontWeight: 600,
                          color: Number(r.stock_level) < 0 ? "var(--bad)" : undefined,
                        }}
                      >
                        {angka(r.stock_level)}
                      </td>
                      <td className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                        {tanggalJam(r.created_at)}
                      </td>
                      <td className="num">
                        {selesai ? (
                          <span className="muted" style={{ fontSize: 12.5 }}>
                            selesai · {r.resolver ?? "—"}
                          </span>
                        ) : (
                          <form action={tandaiSelesai}>
                            <input type="hidden" name="id" value={r.id} />
                            <button
                              className="btn"
                              style={{ minHeight: 32, padding: "4px 10px", fontSize: 13 }}
                            >
                              Tandai selesai
                            </button>
                          </form>
                        )}
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
