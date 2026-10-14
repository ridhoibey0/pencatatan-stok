import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole, hashPassword } from "@/lib/auth";
import { query, execute } from "@/lib/db";
import { tanggalJam, LABEL_PERAN } from "@/lib/format";
import { PageHeader, Card, Empty, FlashMessage } from "@/components/ui";
import Modal, { ModalActions } from "@/components/Modal";
import SubmitButton from "@/components/SubmitButton";
import Icon from "@/components/Icon";

export const metadata = { title: "Pengguna — Nerva" };
export const dynamic = "force-dynamic";

interface User {
  id: number;
  name: string;
  username: string;
  role: string;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

const PERAN: { value: string; label: string; ket: string }[] = [
  { value: "owner", label: "Owner", ket: "semua akses, termasuk menyetujui opname" },
  { value: "admin", label: "Admin", ket: "sama seperti owner untuk operasional harian" },
  { value: "warehouse", label: "Gudang", ket: "mencatat stok, tidak bisa kelola pengguna" },
  { value: "host", label: "Host Live", ket: "hanya melihat stok" },
];

function isRedirect(e: unknown) {
  return (e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT");
}

async function tambahPengguna(formData: FormData) {
  "use server";
  await requireRole("owner", "admin");
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "warehouse");

  if (!name || !username) redirect("/pengguna?error=Nama+dan+username+wajib+diisi");
  if (password.length < 8) redirect("/pengguna?error=Password+minimal+8+karakter");

  try {
    await execute(`INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)`, [
      name,
      username,
      await hashPassword(password),
      role,
    ]);
    revalidatePath("/pengguna");
    redirect("/pengguna?ok=Pengguna+ditambahkan");
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect("/pengguna?error=Username+sudah+dipakai");
    }
    throw e;
  }
}

async function ubahPengguna(formData: FormData) {
  "use server";
  const me = await requireRole("owner", "admin");
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "warehouse");
  const isActive = formData.get("is_active") ? 1 : 0;
  const password = String(formData.get("password") ?? "");

  if (!name || !username) redirect("/pengguna?error=Nama+dan+username+wajib+diisi");
  if (password && password.length < 8) {
    redirect("/pengguna?error=Password+baru+minimal+8+karakter");
  }
  // Mencegah admin mengunci dirinya sendiri di luar sistem.
  if (id === me.id && !isActive) {
    redirect("/pengguna?error=Tidak+bisa+menonaktifkan+akun+sendiri");
  }

  try {
    await execute(
      `UPDATE users SET name = ?, username = ?, role = ?, is_active = ? WHERE id = ?`,
      [name, username, role, isActive, id],
    );
    if (password) {
      await execute(`UPDATE users SET password = ? WHERE id = ?`, [
        await hashPassword(password),
        id,
      ]);
    }
    revalidatePath("/pengguna");
    redirect(
      `/pengguna?ok=${encodeURIComponent(
        password ? "Pengguna diperbarui dan password diganti" : "Pengguna diperbarui",
      )}`,
    );
  } catch (e) {
    if (isRedirect(e)) throw e;
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") {
      redirect("/pengguna?error=Username+sudah+dipakai");
    }
    throw e;
  }
}

function FormPengguna({ user, meId }: { user?: User; meId?: number }) {
  const k = user?.id ?? "new";
  return (
    <>
      {user && <input type="hidden" name="id" value={user.id} />}

      <div className="field">
        <label className="label" htmlFor={`name-${k}`}>
          Nama lengkap
        </label>
        <input
          id={`name-${k}`}
          name="name"
          className="input"
          defaultValue={user?.name}
          required
          maxLength={100}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`user-${k}`}>
          Username
        </label>
        <input
          id={`user-${k}`}
          name="username"
          className="input mono"
          defaultValue={user?.username}
          autoCapitalize="none"
          required
          maxLength={50}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`pass-${k}`}>
          Password {user && <span className="muted">(kosongkan kalau tidak diganti)</span>}
        </label>
        <input
          id={`pass-${k}`}
          name="password"
          type="password"
          className="input"
          minLength={8}
          required={!user}
          autoComplete="new-password"
        />
        <div className="hint">Minimal 8 karakter.</div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`role-${k}`}>
          Peran
        </label>
        <select
          id={`role-${k}`}
          name="role"
          className="select"
          defaultValue={user?.role ?? "warehouse"}
        >
          {PERAN.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} — {p.ket}
            </option>
          ))}
        </select>
      </div>

      {user && user.id !== meId && (
        <label className="check">
          <input type="checkbox" name="is_active" defaultChecked={!!user.is_active} />
          Akun aktif (bisa login)
        </label>
      )}
      {user && user.id === meId && (
        <input type="hidden" name="is_active" value="1" />
      )}
    </>
  );
}

export default async function PenggunaPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const me = await requireRole("owner", "admin");
  const { ok, error } = await searchParams;

  const users = await query<User>(
    `SELECT id, name, username, role, is_active, last_login_at, created_at
       FROM users ORDER BY is_active DESC, name`,
  );

  const logs = await query<{
    id: number;
    user_name: string | null;
    action: string;
    auditable_type: string;
    auditable_id: string | null;
    created_at: string;
  }>(
    `SELECT al.id, u.name AS user_name, al.action, al.auditable_type,
            al.auditable_id, al.created_at
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.id DESC LIMIT 20`,
  );

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Setiap pencatatan stok menyimpan siapa yang melakukannya, jadi setiap orang perlu akun sendiri — jangan dipakai bersama."
        action={
          <Modal
            title="Tambah Pengguna"
            defaultOpen={!!error}
            trigger={
              <button className="btn btn-primary">
                <Icon name="plus" size={18} />
                Tambah Pengguna
              </button>
            }
          >
            <form action={tambahPengguna}>
              <FormPengguna />
              <ModalActions>
                <SubmitButton pendingLabel="Menyimpan…">Simpan Pengguna</SubmitButton>
              </ModalActions>
            </form>
          </Modal>
        }
      />

      <FlashMessage ok={ok} error={error} />

      <Card padded={false}>
        <div className="scroll-x">
          <table className="data stack">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Peran</th>
                <th>Terakhir masuk</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                  <td className="cell-main" data-label="">
                    <div style={{ fontWeight: 600 }}>
                      {u.name}
                      {u.id === me.id && (
                        <span className="pill pill-info pill-plain" style={{ marginLeft: 7 }}>
                          Anda
                        </span>
                      )}
                    </div>
                    <div className="muted mono" style={{ fontSize: 12.5 }}>
                      {u.username}
                    </div>
                  </td>
                  <td data-label="Peran">{LABEL_PERAN[u.role] ?? u.role}</td>
                  <td data-label="Terakhir masuk" className="muted" style={{ fontSize: 13 }}>
                    {u.last_login_at ? tanggalJam(u.last_login_at) : "belum pernah"}
                  </td>
                  <td data-label="Status">
                    {u.is_active ? (
                      <span className="pill pill-ok">Aktif</span>
                    ) : (
                      <span className="pill pill-muted">Nonaktif</span>
                    )}
                  </td>
                  <td data-label="" className="num">
                    <Modal
                      title="Edit Pengguna"
                      description={u.username}
                      trigger={<button className="btn btn-sm">Edit</button>}
                    >
                      <form action={ubahPengguna}>
                        <FormPengguna user={u} meId={me.id} />
                        <ModalActions>
                          <SubmitButton pendingLabel="Menyimpan…">
                            Simpan Perubahan
                          </SubmitButton>
                        </ModalActions>
                      </form>
                    </Modal>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <h2 style={{ fontSize: 15, margin: "22px 0 10px" }}>Log aktivitas</h2>
      <Card padded={false}>
        {logs.length === 0 ? (
          <Empty icon="clipboard" title="Belum ada log">
            Jejak pencatatan stok sendiri tersimpan di kartu stok tiap SKU, lengkap
            dengan nama pencatatnya.
          </Empty>
        ) : (
          <table className="data">
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.user_name ?? "sistem"}</td>
                  <td className="muted">{l.action}</td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {l.auditable_type}
                    {l.auditable_id ? ` #${l.auditable_id}` : ""}
                  </td>
                  <td className="muted num" style={{ fontSize: 13 }}>
                    {tanggalJam(l.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
