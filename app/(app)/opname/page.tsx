import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { angka, tanggal, tanggalISO } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage } from "@/components/ui";

export const metadata = { title: "Stok Opname — Nerva" };
export const dynamic = "force-dynamic";

const LABEL_STATUS: Record<string, { teks: string; kelas: string }> = {
  draft: { teks: "Draft", kelas: "pill pill-muted" },
  submitted: { teks: "Menunggu persetujuan", kelas: "pill pill-warn" },
  approved: { teks: "Disetujui", kelas: "pill pill-ok" },
};

async function buatSesi(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");
  const countDate = tanggalISO(String(formData.get("count_date") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const id = await withTransaction(async (tx) => {
    const seq = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) + 1 AS n FROM stock_counts`,
    );
    const refNo = `SO-${new Date().getFullYear()}-${String(seq?.n ?? 1).padStart(4, "0")}`;

    const ins = await tx.execute(
      `INSERT INTO stock_counts (reference_no, count_type, count_date, status, notes, created_by)
       VALUES (?, 'product', ?, 'draft', ?, ?)`,
      [refNo, countDate, notes, user.id],
    );

    // Semua varian aktif dimuat dengan qty sistem dibekukan saat sesi dibuat,
    // supaya angka pembanding tidak ikut berubah selama penghitungan berjalan.
    await tx.execute(
      `INSERT INTO stock_count_items
         (stock_count_id, product_variant_id, system_quantity, counted_quantity)
       SELECT ?, id, stock_on_hand, stock_on_hand
         FROM product_variants
        WHERE is_active = 1 AND deleted_at IS NULL`,
      [ins.insertId],
    );
    return ins.insertId;
  });

  revalidatePath("/opname");
  redirect(`/opname/${id}?ok=Sesi+opname+dibuat.+Isi+hasil+hitungan+fisiknya.`);
}

export default async function OpnamePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

  const sessions = await query<{
    id: number;
    reference_no: string;
    count_date: string;
    status: string;
    notes: string | null;
    creator: string | null;
    approver: string | null;
    item_count: number;
    variance_count: number;
    variance_total: string;
  }>(
    `SELECT sc.id, sc.reference_no, sc.count_date, sc.status, sc.notes,
            cu.name AS creator, au.name AS approver,
            COUNT(sci.id) AS item_count,
            SUM(sci.variance <> 0) AS variance_count,
            COALESCE(SUM(ABS(sci.variance)), 0) AS variance_total
       FROM stock_counts sc
       LEFT JOIN stock_count_items sci ON sci.stock_count_id = sc.id
       LEFT JOIN users cu ON cu.id = sc.created_by
       LEFT JOIN users au ON au.id = sc.approved_by
      GROUP BY sc.id, sc.reference_no, sc.count_date, sc.status, sc.notes,
               cu.name, au.name
      ORDER BY sc.id DESC
      LIMIT 30`,
  );

  return (
    <>
      <PageHeader
        title="Stok Opname"
        description="Membandingkan stok sistem dengan hitungan fisik, lalu menyesuaikan selisihnya lewat mutasi yang tercatat."
      />

      <FlashMessage ok={ok} error={error} />

      <Card style={{ marginBottom: 18 }}>
        <form
          action={buatSesi}
          style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="count_date">
              Tanggal hitung
            </label>
            <input
              id="count_date"
              name="count_date"
              type="date"
              className="input"
              defaultValue={tanggalISO()}
              style={{ width: 170 }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: "1 1 240px" }}>
            <label className="label" htmlFor="notes">
              Catatan
            </label>
            <input
              id="notes"
              name="notes"
              className="input"
              placeholder="mis. opname bulanan September"
              maxLength={255}
            />
          </div>
          <button className="btn btn-primary" style={{ minHeight: 42 }}>
            Mulai Sesi Opname
          </button>
        </form>
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Semua varian aktif akan dimuat dengan angka sistem saat ini sebagai pembanding.
        </div>
      </Card>

      <Card padded={false}>
        {sessions.length === 0 ? (
          <Empty>Belum pernah ada opname.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Tanggal</th>
                  <th>Status</th>
                  <th className="num">SKU</th>
                  <th className="num">Selisih</th>
                  <th className="num">Total unit selisih</th>
                  <th>Dibuat / disetujui</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const l = LABEL_STATUS[s.status] ?? {
                    teks: s.status,
                    kelas: "pill pill-muted",
                  };
                  return (
                    <tr key={s.id}>
                      <td className="mono" style={{ fontSize: 13 }}>
                        <Link href={`/opname/${s.id}`} style={{ color: "var(--brand)" }}>
                          {s.reference_no}
                        </Link>
                      </td>
                      <td>{tanggal(s.count_date)}</td>
                      <td>
                        <span className={l.kelas}>{l.teks}</span>
                      </td>
                      <td className="num">{angka(s.item_count)}</td>
                      <td
                        className="num"
                        style={{
                          fontWeight: 600,
                          color:
                            Number(s.variance_count) > 0 ? "var(--warn)" : "var(--ok)",
                        }}
                      >
                        {angka(s.variance_count)}
                      </td>
                      <td className="num">{angka(s.variance_total)}</td>
                      <td className="muted" style={{ fontSize: 13 }}>
                        {s.creator ?? "—"}
                        {s.approver ? ` → ${s.approver}` : ""}
                      </td>
                      <td className="num">
                        <Link
                          href={`/opname/${s.id}`}
                          className="btn"
                          style={{ minHeight: 32, padding: "4px 10px", fontSize: 13 }}
                        >
                          Buka
                        </Link>
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
