import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole, can } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { approveStockCount } from "@/lib/stock-count";
import { angka, tanggal } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage, Grid, Stat } from "@/components/ui";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

interface Sesi {
  id: number;
  reference_no: string;
  count_date: string;
  status: "draft" | "submitted" | "approved";
  notes: string | null;
  creator: string | null;
  approver: string | null;
  approved_at: string | null;
}

interface Item {
  id: number;
  variant_id: number;
  sku: string;
  product_name: string;
  size: string | null;
  color: string | null;
  system_quantity: string;
  counted_quantity: string;
  variance: string;
  notes: string | null;
}

async function simpanHitungan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin", "warehouse");
  const sessionId = Number(formData.get("session_id"));

  const sesi = await queryOne<{ status: string }>(
    `SELECT status FROM stock_counts WHERE id = ?`,
    [sessionId],
  );
  if (!sesi) notFound();
  if (sesi.status === "approved") {
    redirect(`/opname/${sessionId}?error=Sesi+sudah+disetujui+dan+tidak+bisa+diubah`);
  }

  const itemIds = formData.getAll("item_id").map((v) => Number(v));
  const counted = formData.getAll("counted_quantity").map((v) => Number(v));
  const catatan = formData.getAll("item_notes").map(String);

  await withTransaction(async (tx) => {
    for (let i = 0; i < itemIds.length; i++) {
      const qty = Number.isFinite(counted[i]) ? counted[i] : 0;
      await tx.execute(
        `UPDATE stock_count_items SET counted_quantity = ?, notes = ?
          WHERE id = ? AND stock_count_id = ?`,
        [qty, catatan[i]?.trim() || null, itemIds[i], sessionId],
      );
    }
    await tx.execute(`UPDATE stock_counts SET status = 'submitted' WHERE id = ?`, [
      sessionId,
    ]);
  });

  revalidatePath(`/opname/${sessionId}`);
  redirect(`/opname/${sessionId}?ok=Hasil+hitungan+disimpan.+Menunggu+persetujuan.`);
}

async function setujui(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin");
  const sessionId = Number(formData.get("session_id"));

  const hasil = await approveStockCount(sessionId, user.id);

  revalidatePath(`/opname/${sessionId}`);
  revalidatePath("/opname");
  revalidatePath("/stok");
  revalidatePath("/peringatan");

  if (hasil.sudahPernah) {
    redirect(`/opname/${sessionId}?error=Sesi+ini+sudah+disetujui+sebelumnya`);
  }
  redirect(
    `/opname/${sessionId}?ok=${encodeURIComponent(
      hasil.skuDisesuaikan === 0
        ? "Disetujui. Tidak ada selisih, jadi tidak ada penyesuaian stok."
        : `Disetujui. ${hasil.skuDisesuaikan} SKU disesuaikan (${hasil.unitDisesuaikan} unit). Stok sistem kini sama dengan hitungan fisik.`,
    )}`,
  );
}

export default async function DetailOpnamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; filter?: string }>;
}) {
  const user = await requireRole("owner", "admin", "warehouse");
  const { id } = await params;
  const { ok, error, filter } = await searchParams;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) notFound();

  const sesi = await queryOne<Sesi>(
    `SELECT sc.id, sc.reference_no, sc.count_date, sc.status, sc.notes,
            sc.approved_at, cu.name AS creator, au.name AS approver
       FROM stock_counts sc
       LEFT JOIN users cu ON cu.id = sc.created_by
       LEFT JOIN users au ON au.id = sc.approved_by
      WHERE sc.id = ?`,
    [sessionId],
  );
  if (!sesi) notFound();

  const hanyaSelisih = filter === "selisih";
  const items = await query<Item>(
    `SELECT sci.id, pv.id AS variant_id, pv.sku, p.name AS product_name,
            pv.size, pv.color, sci.system_quantity, sci.counted_quantity,
            sci.variance, sci.notes
       FROM stock_count_items sci
       JOIN product_variants pv ON pv.id = sci.product_variant_id
       JOIN products p ON p.id = pv.product_id
      WHERE sci.stock_count_id = ?
      ${hanyaSelisih ? "AND sci.variance <> 0" : ""}
      ORDER BY p.name, pv.color, pv.size`,
    [sessionId],
  );

  const ringkas = await queryOne<{
    total: number;
    selisih: number;
    lebih: string;
    kurang: string;
  }>(
    `SELECT COUNT(*) AS total,
            SUM(variance <> 0) AS selisih,
            COALESCE(SUM(GREATEST(variance, 0)), 0) AS lebih,
            COALESCE(SUM(LEAST(variance, 0)), 0)    AS kurang
       FROM stock_count_items WHERE stock_count_id = ?`,
    [sessionId],
  );

  const terkunci = sesi.status === "approved";
  const bolehSetujui = can(user.role, "approve_count");

  return (
    <>
      <PageHeader
        title={`Opname ${sesi.reference_no}`}
        description={`${tanggal(sesi.count_date)}${sesi.notes ? ` · ${sesi.notes}` : ""} · dibuat ${sesi.creator ?? "—"}`}
        back={{ href: "/opname", label: "Semua opname" }}
      />

      <FlashMessage ok={ok} error={error} />

      <Grid min={160} gap={12}>
        <Stat label="SKU dihitung" value={angka(ringkas?.total ?? 0)} />
        <Stat
          label="SKU berselisih"
          value={angka(ringkas?.selisih ?? 0)}
          tone={Number(ringkas?.selisih ?? 0) > 0 ? "warn" : "ok"}
        />
        <Stat label="Fisik lebih" value={`+${angka(ringkas?.lebih ?? 0)}`} tone="ok" />
        <Stat label="Fisik kurang" value={angka(ringkas?.kurang ?? 0)} tone="bad" />
      </Grid>

      {terkunci && (
        <div className="alert alert-ok" style={{ margin: "16px 0" }}>
          Sesi ini sudah disetujui oleh {sesi.approver ?? "—"} dan tidak bisa diubah.
          Penyesuaiannya sudah tercatat sebagai mutasi di kartu stok masing-masing SKU.
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          margin: "18px 0 10px",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: 15, margin: 0 }}>Hasil hitungan</h2>
        <Link
          href={`/opname/${sessionId}${hanyaSelisih ? "" : "?filter=selisih"}`}
          className="btn"
          style={{ minHeight: 32, padding: "4px 11px", fontSize: 13 }}
        >
          {hanyaSelisih ? "Tampilkan semua" : "Hanya yang berselisih"}
        </Link>
      </div>

      <form action={simpanHitungan}>
        <input type="hidden" name="session_id" value={sessionId} />
        <Card padded={false}>
          {items.length === 0 ? (
            <Empty>
              {hanyaSelisih ? "Tidak ada selisih. Semua cocok." : "Tidak ada SKU di sesi ini."}
            </Empty>
          ) : (
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Produk</th>
                    <th className="num">Sistem</th>
                    <th className="num" style={{ width: 120 }}>
                      Fisik
                    </th>
                    <th className="num">Selisih</th>
                    <th style={{ minWidth: 180 }}>Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const selisih = Number(it.variance);
                    return (
                      <tr key={it.id}>
                        <td className="mono" style={{ fontSize: 13 }}>
                          {it.sku}
                          <input type="hidden" name="item_id" value={it.id} />
                        </td>
                        <td>
                          <div style={{ fontSize: 13.5 }}>{it.product_name}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[it.color, it.size].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td className="num muted">{angka(it.system_quantity)}</td>
                        <td className="num">
                          <input
                            name="counted_quantity"
                            type="number"
                            inputMode="numeric"
                            step={1}
                            min={0}
                            defaultValue={Number(it.counted_quantity)}
                            disabled={terkunci}
                            className="input num"
                            style={{ width: 100, fontWeight: 600 }}
                          />
                        </td>
                        <td
                          className="num"
                          style={{
                            fontWeight: 700,
                            color:
                              selisih === 0
                                ? "var(--muted)"
                                : selisih > 0
                                  ? "var(--ok)"
                                  : "var(--bad)",
                          }}
                        >
                          {selisih > 0 ? "+" : ""}
                          {angka(selisih)}
                        </td>
                        <td>
                          <input
                            name="item_notes"
                            defaultValue={it.notes ?? ""}
                            disabled={terkunci}
                            className="input"
                            placeholder="alasan selisih"
                            maxLength={255}
                            style={{ minHeight: 34 }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {!terkunci && (
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <SubmitButton pendingLabel="Menyimpan…">Simpan Hitungan</SubmitButton>
            <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
              Angka selisih diperbarui setelah disimpan.
            </span>
          </div>
        )}
      </form>

      {!terkunci && bolehSetujui && (
        <Card style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 14.5, margin: "0 0 8px" }}>Setujui penyesuaian</h3>
          <p className="muted" style={{ fontSize: 13.5, margin: "0 0 12px", maxWidth: "70ch" }}>
            Menyetujui akan membuat mutasi penyesuaian untuk tiap SKU yang berselisih,
            dan mengunci sesi ini. Stok sistem jadi sama dengan hitungan fisik, dan
            selisihnya tetap terlihat di kartu stok sebagai jejak.
          </p>
          <form action={setujui}>
            <input type="hidden" name="session_id" value={sessionId} />
            <SubmitButton pendingLabel="Menyesuaikan stok…">
              Setujui &amp; Sesuaikan Stok
            </SubmitButton>
          </form>
        </Card>
      )}

      {!terkunci && !bolehSetujui && (
        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          Persetujuan penyesuaian stok hanya bisa dilakukan Owner atau Admin.
        </div>
      )}
    </>
  );
}
