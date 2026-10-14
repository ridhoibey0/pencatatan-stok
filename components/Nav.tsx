"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import Icon from "./Icon";
import { isActive, type NavItem } from "@/lib/nav";

export function NavLinks({
  groups,
  alertCount,
  onNavigate,
}: {
  groups: { group: string; items: NavItem[] }[];
  alertCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav>
      {groups.map((g) => (
        <div key={g.group}>
          <div className="nav-group-label">{g.group}</div>
          {g.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              data-active={isActive(item, pathname)}
              onClick={onNavigate}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.href === "/stok/retur" && alertCount > 0 ? null : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <div className="bottom-nav">
      {items.map((item) => (
        <Link key={item.href} href={item.href} data-active={isActive(item, pathname)}>
          <Icon name={item.icon} size={21} />
          <span>{item.label}</span>
        </Link>
      ))}
    </div>
  );
}

export function MobileDrawer({
  groups,
  alertCount,
}: {
  groups: { group: string; items: NavItem[] }[];
  alertCount: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost drawer-toggle"
        onClick={() => setOpen(true)}
        aria-label="Buka menu"
        style={{ minHeight: 40, padding: "6px 10px" }}
      >
        <Icon name="menu" size={21} />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 12, 20, 0.5)",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 262,
              maxWidth: "84vw",
              height: "100%",
              background: "var(--surface)",
              borderRight: "1px solid var(--border)",
              padding: "14px 10px",
              overflowY: "auto",
              boxShadow: "var(--shadow-3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 6px 10px",
              }}
            >
              <Brand />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
                aria-label="Tutup menu"
                style={{ minHeight: 36, padding: "5px 8px" }}
              >
                <Icon name="close" size={19} />
              </button>
            </div>
            <NavLinks groups={groups} alertCount={alertCount} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <style jsx global>{`
        .drawer-toggle {
          display: none;
        }
        @media (max-width: 860px) {
          .drawer-toggle {
            display: inline-flex;
          }
          .sidebar-desktop {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}

export function Brand() {
  return (
    <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: "var(--brand)",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
          fontSize: 15,
          flexShrink: 0,
        }}
      >
        N
      </span>
      <span style={{ lineHeight: 1.15 }}>
        <span style={{ display: "block", fontWeight: 700, fontSize: 15.5 }}>Nerva</span>
        <span className="muted" style={{ display: "block", fontSize: 11.5 }}>
          Pencatatan Stok
        </span>
      </span>
    </Link>
  );
}

/** Lonceng peringatan di header — menggantikan menu "Peringatan" yang dulu terpisah. */
export function AlertBell({ count }: { count: number }) {
  return (
    <Link
      href="/peringatan"
      className="btn btn-ghost"
      aria-label={count > 0 ? `${count} peringatan stok` : "Peringatan stok"}
      style={{ minHeight: 40, padding: "6px 10px", position: "relative" }}
    >
      <Icon name="bell" size={20} />
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            minWidth: 17,
            height: 17,
            padding: "0 4px",
            borderRadius: 999,
            background: "var(--bad)",
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
            lineHeight: 1,
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
