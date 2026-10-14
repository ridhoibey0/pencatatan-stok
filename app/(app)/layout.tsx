import { redirect } from "next/navigation";
import { requireUser, logout, can } from "@/lib/auth";
import { query } from "@/lib/db";
import { LABEL_PERAN } from "@/lib/format";
import { NAV, BOTTOM_NAV } from "@/lib/nav";
import { NavLinks, BottomNav, MobileDrawer, Brand, AlertBell } from "@/components/Nav";
import Icon from "@/components/Icon";

async function keluar() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => can(user.role, i.perm)),
  })).filter((g) => g.items.length > 0);

  const bottom = BOTTOM_NAV.filter((i) => can(user.role, i.perm));

  const [alerts] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM stock_alerts WHERE status <> 'resolved'`,
  );
  const alertCount = Number(alerts?.n ?? 0);

  return (
    <div style={{ display: "flex", minHeight: "100dvh" }}>
      <aside
        className="sidebar-desktop"
        style={{
          width: "var(--nav-w)",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "16px 10px",
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "0 6px 18px" }}>
          <Brand />
        </div>
        <NavLinks groups={groups} alertCount={alertCount} />
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <MobileDrawer groups={groups} alertCount={alertCount} />

          <div className="brand-mobile" style={{ display: "none" }}>
            <Brand />
          </div>

          <div style={{ flex: 1 }} />

          <AlertBell count={alertCount} />

          <div
            className="user-chip"
            style={{ textAlign: "right", lineHeight: 1.2, marginLeft: 4 }}
          >
            <div style={{ fontSize: 13, fontWeight: 650 }}>{user.name}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              {LABEL_PERAN[user.role] ?? user.role}
            </div>
          </div>

          <form action={keluar}>
            <button
              type="submit"
              className="btn btn-ghost"
              aria-label="Keluar"
              style={{ minHeight: 40, padding: "6px 10px" }}
            >
              <Icon name="logout" size={19} />
              <span className="logout-label">Keluar</span>
            </button>
          </form>
        </header>

        <main
          style={{
            padding: "20px 18px calc(20px + var(--bottom-nav-h))",
            flex: 1,
            minWidth: 0,
            maxWidth: 1180,
            width: "100%",
          }}
        >
          {children}
        </main>
      </div>

      {bottom.length >= 2 && <BottomNav items={bottom} />}

      <style>{`
        @media (max-width: 860px) {
          .brand-mobile { display: block !important; }
          .user-chip { display: none; }
          .logout-label { display: none; }
        }
        @media (max-width: 560px) {
          main { padding-left: 13px !important; padding-right: 13px !important; }
        }
      `}</style>
    </div>
  );
}
