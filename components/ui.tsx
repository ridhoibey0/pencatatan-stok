import Link from "next/link";
import Icon, { type IconName } from "./Icon";

export function PageHeader({
  title,
  description,
  action,
  back,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  back?: { href: string; label?: string };
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      {back && (
        <Link
          href={back.href}
          className="muted"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13.5,
            marginBottom: 9,
            fontWeight: 550,
          }}
        >
          <Icon name="arrow-left" size={16} />
          {back.label ?? "Kembali"}
        </Link>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700 }}>{title}</h1>
          {description && (
            <p
              className="text-2"
              style={{ margin: "6px 0 0", fontSize: 14.5, maxWidth: "68ch" }}
            >
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

/** Tab di dalam halaman — pengganti item menu yang dulu berdiri sendiri. */
export function Tabs({
  items,
  active,
}: {
  items: { href: string; label: string }[];
  active: string;
}) {
  return (
    <div className="tabs">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className="tab" data-active={t.href === active}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Card({
  children,
  padded = true,
  title,
  action,
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  title?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {title && (
        <div className="card-head">
          <h2 className="card-title">{title}</h2>
          {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
        </div>
      )}
      <div style={{ padding: padded ? 16 : 0 }}>{children}</div>
    </div>
  );
}

/**
 * Keadaan kosong selalu memberi langkah berikutnya, bukan sekadar
 * memberitahu bahwa datanya tidak ada.
 */
export function Empty({
  icon = "box",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title?: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div style={{ padding: "44px 20px", textAlign: "center" }}>
      <div
        style={{
          width: 46,
          height: 46,
          margin: "0 auto 14px",
          borderRadius: 12,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
        }}
      >
        <Icon name={icon} size={23} />
      </div>
      {title && (
        <div style={{ fontWeight: 650, fontSize: 15.5, marginBottom: 5 }}>{title}</div>
      )}
      <div
        className="muted"
        style={{ fontSize: 14, maxWidth: "46ch", margin: "0 auto", lineHeight: 1.55 }}
      >
        {children}
      </div>
      {action && (
        <Link href={action.href} className="btn btn-primary" style={{ marginTop: 16 }}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
  href,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "ok" | "warn" | "bad";
  href?: string;
  hint?: string;
  icon?: IconName;
}) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "bad"
          ? "var(--bad)"
          : "var(--text)";

  const inner = (
    <div
      className="card"
      style={{
        padding: 15,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div
        className="muted"
        style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
      >
        {icon && <Icon name={icon} size={15} />}
        {label}
      </div>
      <div
        style={{
          fontSize: 27,
          fontWeight: 700,
          color,
          lineHeight: 1.15,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      {hint && (
        <div className="muted" style={{ fontSize: 12 }}>
          {hint}
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} style={{ display: "block", height: "100%" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function StockPill({
  stock,
  reorderPoint,
}: {
  stock: number;
  reorderPoint: number;
}) {
  if (stock < 0) return <span className="pill pill-bad">Minus {stock}</span>;
  if (stock === 0) return <span className="pill pill-bad">Habis</span>;
  if (stock <= reorderPoint) return <span className="pill pill-warn">Menipis</span>;
  return <span className="pill pill-ok">Aman</span>;
}

export function Grid({
  min = 180,
  gap = 12,
  children,
}: {
  min?: number;
  gap?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap,
      }}
    >
      {children}
    </div>
  );
}

export function FlashMessage({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div className={error ? "alert alert-bad" : "alert alert-ok"} style={{ marginBottom: 16 }}>
      <Icon name={error ? "alert" : "check"} size={18} />
      <div>{error ?? ok}</div>
    </div>
  );
}

export function Note({
  tone = "info",
  icon = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad" | "ok";
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <div className={`alert alert-${tone}`} style={{ marginBottom: 16 }}>
      <Icon name={icon} size={18} />
      <div>{children}</div>
    </div>
  );
}
