import { redirect } from "next/navigation";
import { getSession, login } from "@/lib/auth";
import Icon from "@/components/Icon";
import SubmitButton from "@/components/SubmitButton";

export const metadata = { title: "Masuk — Nerva" };

async function masuk(formData: FormData) {
  "use server";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) redirect("/login?error=Lengkapi+username+dan+password");

  const res = await login(username, password);
  if (!res.ok) redirect(`/login?error=${encodeURIComponent(res.error)}`);
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect("/");
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 18,
        background:
          "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--brand) 9%, var(--bg)) 0%, var(--bg) 62%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 384 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 50,
              height: 50,
              margin: "0 auto 13px",
              borderRadius: 14,
              background: "var(--brand)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              fontSize: 23,
              boxShadow: "var(--shadow-2)",
            }}
          >
            N
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Nerva</h1>
          <p className="muted" style={{ margin: "5px 0 0", fontSize: 14 }}>
            Sistem Pencatatan Stok
          </p>
        </div>

        <div className="card" style={{ padding: 24, boxShadow: "var(--shadow-2)" }}>
          {error && (
            <div className="alert alert-bad" style={{ marginBottom: 18 }}>
              <Icon name="alert" size={18} />
              <div>{error}</div>
            </div>
          )}

          <form action={masuk}>
            <div className="field">
              <label className="label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                name="username"
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                required
              />
            </div>
            <div className="field" style={{ marginBottom: 20 }}>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="input"
                autoComplete="current-password"
                required
              />
            </div>
            <SubmitButton
              className="btn btn-primary btn-lg"
              pendingLabel="Memeriksa…"
              style={{ width: "100%" }}
            >
              Masuk
            </SubmitButton>
          </form>
        </div>

        <p
          className="muted"
          style={{ textAlign: "center", fontSize: 12.5, marginTop: 18 }}
        >
          Setiap pencatatan menyimpan siapa yang melakukannya.
          <br />
          Pakai akun masing-masing, jangan dipakai bersama.
        </p>
      </div>
    </main>
  );
}
