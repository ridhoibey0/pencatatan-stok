import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { query, queryOne, execute, withTransaction } from "@/lib/db";
import { recordMaterialMovement } from "@/lib/stock";
import { angka, tanggalISO, LABEL_MUTASI } from "@/lib/format";
import { TABS } from "@/lib/nav";
import { PageHeader, Card, Empty, FlashMessage, Tabs } from "@/components/ui";
import Modal, { ModalActions } from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/Icon";

export const metadata = { title: "Bahan Baku — Nerva" };
export const dynamic = "force-dynamic";

const LABEL_JENIS: Record<string, string> = {
  fabric: "Kain",
  accessory: "Aksesoris",
  packaging: "Kemasan",
  other: "Lainnya",
};

interface Material {
  id: number;
  code: string;
  name: string;
  type: string;
  unit: string;
  stock_on_hand: string;
  reorder_point: string;
  is_active: number;
  movement_count: number;
}

function isRedirect(e: unknown) {
  return (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");
}

async function tambahBahan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin", "warehouse");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "fabric");
  const unit = String(formData.get("unit") ?? "").trim();
  const reorderPoint = Number(formData.get("reorder_point") ?? 0);

  if (!code || !name || !unit) redirect("/bahan?error=Kode,+nama,+dan+satuan+wajib+diisi");

  try {
    await execute(
      `INSERT INTO materials (code, name, type, unit, reorder_point) VALUES (?, ?, ?, ?, ?)`,
      [code, name, type, unit, reorderPoint],
    );
    revalidatePath("/bahan");
    redirect("/bahan?ok=Bahan+ditambahkan");
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect("/bahan?error=Kode+bahan+sudah+dipakai");
    }
    throw e;
  }
}

async function ubahBahan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin", "warehouse");
  const id = Number(formData.get("id"));
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "fabric");
  const unit = String(formData.get("unit") ?? "").trim();
  const reorderPoint = Number(formData.get("reorder_point") ?? 0);
  const isActive = formData.get("is_active") ? 1 : 0;

  if (!code || !name || !unit) redirect("/bahan?error=Kode,+nama,+dan+satuan+wajib+diisi");

  try {
    await execute(
      `UPDATE materials SET code = ?, name = ?, type = ?, unit = ?,
              reorder_point = ?, is_active = ?
        WHERE id = ?`,
      [code, name, type, unit, reorderPoint, isActive, id],
    );
    revalidatePath("/bahan");
    redirect("/bahan?ok=Bahan+diperbarui");
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect("/bahan?error=Kode+bahan+sudah+dipakai");
    }
    throw e;
  }
}

async function hapusBahan(formData: FormData) {
  "use server";
  await requireRole("owner", "admin", "warehouse");
  const id = Number(formData.get("id"));

  // Bahan yang sudah pernah bermutasi tidak dihapus -- riwayatnya harus tetap terbaca.
  const pakai = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM material_movements WHERE material_id = ?`,
    [id],
  );
  if (Number(pakai?.n ?? 0) > 0) {
    await execute(`UPDATE materials SET is_active = 0, deleted_at = NOW() WHERE id = ?`, [id]);
    revalidatePath("/bahan");
    redirect("/bahan?ok=Bahan+punya+riwayat+mutasi,+jadi+diarsipkan+(bukan+dihapus)");
  }

  await execute(`DELETE FROM materials WHERE id = ?`, [id]);
  revalidatePath("/bahan");
  redirect("/bahan?ok=Bahan+dihapus");
}

async function catatPemakaian(formData: FormData) {
  "use server";
  const user = await requireRole("owner", "admin", "warehouse");
  const materialId = Number(formData.get("material_id"));
  const productionOrderId = Number(formData.get("production_order_id")) || null;
  const quantity = Number(formData.get("quantity"));
  const date = tanggalISO(String(formData.get("date") ?? ""));
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!(quantity > 0)) redirect("/bahan?error=Jumlah+pemakaian+harus+lebih+dari+nol");

  const hasil = await withTransaction((tx) =>
    recordMaterialMovement(tx, {
      materialId,
      quantity: -quantity,
      type: "usage",
      referenceType: productionOrderId ? "production" : "manual",
      referenceId: productionOrderId,
      notes,
      date,
      userId: user.id,
    }),
  );

  revalidatePath("/bahan");
  redirect(`/bahan?ok=${encodeURIComponent(`Pemakaian tercatat. Sisa ${hasil.balanceAfter}.`)}`);
}

function FormBahan({ bahan }: { bahan?: Material }) {
  const k = bahan?.id ?? "new";
  return (
    <>
      {bahan && <input type="hidden" name="id" value={bahan.id} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor={`code-${k}`}>
            Kode
          </label>
          <input
            id={`code-${k}`}
            name="code"
            className="input mono"
            defaultValue={bahan?.code}
            required
            maxLength={30}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`unit-${k}`}>
            Satuan
          </label>
          <input
            id={`unit-${k}`}
            name="unit"
            className="input"
            placeholder="meter / pcs / roll"
            defaultValue={bahan?.unit}
            required
            maxLength={20}
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`name-${k}`}>
          Nama bahan
        </label>
        <input
          id={`name-${k}`}
          name="name"
          className="input"
          defaultValue={bahan?.name}
          required
          maxLength={100}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label className="label" htmlFor={`type-${k}`}>
            Jenis
          </label>
          <select
            id={`type-${k}`}
            name="type"
            className="select"
            defaultValue={bahan?.type ?? "fabric"}
          >
            {Object.entries(LABEL_JENIS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor={`rp-${k}`}>
            Batas minimum
          </label>
          <input
            id={`rp-${k}`}
            name="reorder_point"
            type="number"
            step="0.01"
            min={0}
            defaultValue={bahan ? Number(bahan.reorder_point) : 0}
            className="input"
          />
        </div>
      </div>

      {bahan && (
        <label className="check">
          <input type="checkbox" name="is_active" defaultChecked={!!bahan.is_active} />
          Bahan aktif
        </label>
      )}
    </>
  );
}

export default async function BahanPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole("owner", "admin", "warehouse");
  const { ok, error } = await searchParams;

  const materials = await query<Material>(
    `SELECT m.id, m.code, m.name, m.type, m.unit, m.stock_on_hand,
            m.reorder_point, m.is_active,
            (SELECT COUNT(*) FROM material_movements mm WHERE mm.material_id = m.id)
              AS movement_count
       FROM materials m
      WHERE m.deleted_at IS NULL
      ORDER BY m.is_active DESC, m.type, m.name`,
  );

  const produksi = await query<{ id: number; reference_no: string }>(
    `SELECT id, reference_no FROM production_orders
      WHERE status IN ('draft','in_progress') ORDER BY id DESC`,
  );

  const mutasi = await query<{
    id: number;
    name: string;
    unit: string;
    movement_type: string;
    quantity: string;
    balance_after: string;
    notes: string | null;
    user_name: string | null;
  }>(
    `SELECT mm.id, m.name, m.unit, mm.movement_type, mm.quantity, mm.balance_after,
            mm.notes, u.name AS user_name
       FROM material_movements mm
       JOIN materials m ON m.id = mm.material_id
       LEFT JOIN users u ON u.id = mm.recorded_by
      ORDER BY mm.id DESC LIMIT 10`,
  );

  return (
    <>
      <PageHeader
        title="Bahan Baku"
        description="Stok kain, aksesoris, dan kemasan. Bertambah dari pembelian, berkurang saat dipakai produksi."
        action={
          <Modal
            title="Tambah Bahan"
            defaultOpen={!!error}
            trigger={
              <button className="btn btn-primary">
                <Icon name="plus" size={18} />
                Tambah Bahan
              </button>
            }
          >
            <form action={tambahBahan}>
              <FormBahan />
              <ModalActions>
                <SubmitButton pendingLabel="Menyimpan…">Simpan Bahan</SubmitButton>
              </ModalActions>
            </form>
          </Modal>
        }
      />

      <Tabs items={TABS.bahan} active="/bahan" />

      <FlashMessage ok={ok} error={error} />

      <Card padded={false} style={{ marginBottom: 18 }}>
        {materials.length === 0 ? (
          <Empty icon="layers" title="Belum ada bahan baku">
            Tambahkan kain, aksesoris, atau kemasan yang stoknya mau dicatat.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="data stack">
              <thead>
                <tr>
                  <th>Bahan</th>
                  <th>Jenis</th>
                  <th className="num">Stok</th>
                  <th className="num">Min.</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const stok = Number(m.stock_on_hand);
                  const min = Number(m.reorder_point);
                  return (
                    <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.55 }}>
                      <td className="cell-main" data-label="">
                        <div style={{ fontWeight: 600 }}>{m.name}</div>
                        <div className="muted mono" style={{ fontSize: 12.5 }}>
                          {m.code}
                          {m.is_active ? "" : " · nonaktif"}
                        </div>
                      </td>
                      <td data-label="Jenis" className="muted">
                        {LABEL_JENIS[m.type] ?? m.type}
                      </td>
                      <td data-label="Stok" className="num" style={{ fontWeight: 700 }}>
                        {angka(stok)}{" "}
                        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                          {m.unit}
                        </span>
                      </td>
                      <td data-label="Batas min." className="num muted">
                        {angka(min)}
                      </td>
                      <td data-label="Status">
                        {stok <= 0 ? (
                          <span className="pill pill-bad">Habis</span>
                        ) : stok <= min ? (
                          <span className="pill pill-warn">Menipis</span>
                        ) : (
                          <span className="pill pill-ok">Aman</span>
                        )}
                      </td>
                      <td data-label="" className="num">
                        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <Modal
                            title="Catat Pemakaian"
                            description={`${m.name} · stok ${angka(stok)} ${m.unit}`}
                            width={400}
                            trigger={<button className="btn btn-sm">Pakai</button>}
                          >
                            <form action={catatPemakaian}>
                              <input type="hidden" name="material_id" value={m.id} />
                              <div className="field">
                                <label className="label" htmlFor={`qty-${m.id}`}>
                                  Jumlah dipakai ({m.unit})
                                </label>
                                <input
                                  id={`qty-${m.id}`}
                                  name="quantity"
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  required
                                  className="input"
                                  style={{ fontSize: 19, fontWeight: 600, minHeight: 50 }}
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor={`po-${m.id}`}>
                                  Untuk order produksi
                                </label>
                                <select
                                  id={`po-${m.id}`}
                                  name="production_order_id"
                                  className="select"
                                >
                                  <option value="">— tanpa order —</option>
                                  {produksi.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.reference_no}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="field">
                                <label className="label" htmlFor={`tgl-${m.id}`}>
                                  Tanggal
                                </label>
                                <input
                                  id={`tgl-${m.id}`}
                                  name="date"
                                  type="date"
                                  className="input"
                                  defaultValue={tanggalISO()}
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor={`cat-${m.id}`}>
                                  Catatan
                                </label>
                                <input
                                  id={`cat-${m.id}`}
                                  name="notes"
                                  className="input"
                                  maxLength={255}
                                />
                              </div>
                              <ModalActions>
                                <SubmitButton pendingLabel="Mencatat…">
                                  Catat Pemakaian
                                </SubmitButton>
                              </ModalActions>
                            </form>
                          </Modal>

                          <Modal
                            title="Edit Bahan"
                            description={m.code}
                            trigger={<button className="btn btn-sm">Edit</button>}
                          >
                            <form action={ubahBahan}>
                              <FormBahan bahan={m} />
                              <ModalActions>
                                <SubmitButton pendingLabel="Menyimpan…">
                                  Simpan Perubahan
                                </SubmitButton>
                              </ModalActions>
                            </form>
                          </Modal>

                          <Modal
                            title="Hapus bahan ini?"
                            description={`${m.code} — ${m.name}`}
                            width={400}
                            trigger={<button className="btn btn-sm btn-danger">Hapus</button>}
                          >
                            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                              {Number(m.movement_count) > 0 ? (
                                <>
                                  Bahan ini punya{" "}
                                  <strong>{Number(m.movement_count)} mutasi</strong> tercatat,
                                  jadi akan <strong>diarsipkan</strong>, bukan dihapus.
                                </>
                              ) : (
                                <>Bahan ini belum pernah dipakai, jadi akan dihapus permanen.</>
                              )}
                            </p>
                            <form action={hapusBahan}>
                              <input type="hidden" name="id" value={m.id} />
                              <ModalActions>
                                <SubmitButton className="btn btn-danger" pendingLabel="Memproses…">
                                  Ya, lanjutkan
                                </SubmitButton>
                              </ModalActions>
                            </form>
                          </Modal>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Mutasi bahan terakhir</h2>
      <Card padded={false}>
        {mutasi.length === 0 ? (
          <Empty icon="clipboard" title="Belum ada mutasi bahan">
            Pembelian dan pemakaian bahan akan muncul di sini.
          </Empty>
        ) : (
          <table className="data">
            <tbody>
              {mutasi.map((m) => {
                const q = Number(m.quantity);
                return (
                  <tr key={m.id}>
                    <td>
                      <div style={{ fontSize: 13.8, fontWeight: 550 }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {m.notes ?? LABEL_MUTASI[m.movement_type] ?? m.movement_type} ·{" "}
                        {m.user_name ?? "—"}
                      </div>
                    </td>
                    <td
                      className="num"
                      style={{ fontWeight: 650, color: q > 0 ? "var(--ok)" : "var(--bad)" }}
                    >
                      {q > 0 ? "+" : ""}
                      {angka(q)} {m.unit}
                    </td>
                    <td className="num muted" style={{ fontSize: 13 }}>
                      sisa {angka(m.balance_after)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
