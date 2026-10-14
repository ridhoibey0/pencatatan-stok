/**
 * Ikon garis, ditulis inline supaya tidak menambah dependensi dan tidak ada
 * permintaan jaringan tambahan. Semua memakai viewBox 24 dan currentColor.
 */

export type IconName =
  | "home"
  | "box"
  | "cart"
  | "truck-in"
  | "truck-out"
  | "undo"
  | "clipboard"
  | "tag"
  | "layers"
  | "chart"
  | "users"
  | "bell"
  | "menu"
  | "close"
  | "plus"
  | "search"
  | "upload"
  | "arrow-left"
  | "check"
  | "alert"
  | "info"
  | "logout"
  | "link";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" />,
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12m0 0 8.5-4.5M12 12v9" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2.2l2.1 10.4a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20.5 7H6" />
      <circle cx="9.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </>
  ),
  "truck-in": (
    <>
      <path d="M3 16V6h11v10M14 9h4l3 3.5V16h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17.5" cy="18" r="1.8" />
      <path d="M8.5 11.5 10.75 9 13 11.5" />
    </>
  ),
  "truck-out": (
    <>
      <path d="M3 16V6h11v10M14 9h4l3 3.5V16h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17.5" cy="18" r="1.8" />
      <path d="M8.5 9 10.75 11.5 13 9" />
    </>
  ),
  undo: <path d="M4 9h11a5 5 0 0 1 0 10H9M4 9l4-4M4 9l4 4" />,
  clipboard: (
    <>
      <path d="M9 4.5h6M8 4.5h8a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 16 20.5H8A1.5 1.5 0 0 1 6.5 19V6A1.5 1.5 0 0 1 8 4.5z" />
      <path d="M9.5 11.5h5M9.5 15h3" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 11.2V4.5h6.7l9.3 9.3-6.7 6.7z" />
      <circle cx="7.5" cy="8.5" r="1.2" />
    </>
  ),
  layers: <path d="M12 3.5 3.5 8 12 12.5 20.5 8zM3.5 13 12 17.5 20.5 13" />,
  chart: <path d="M4 20V4m0 16h16M8 17v-5m4 5V8m4 9v-7" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8M17.5 14.8c2 .6 3.5 2.3 3.5 4.7" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z" />
      <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />,
  "arrow-left": <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3.5 21 19H3z" />
      <path d="M12 9.5v4M12 16.3v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8.2v.2" />
    </>
  ),
  logout: <path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-7A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h7a1.5 1.5 0 0 0 1.5-1.5V17M9 12h11m0 0-3.5-3.5M20 12l-3.5 3.5" />,
  link: <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />,
};

export default function Icon({
  name,
  size = 19,
  strokeWidth = 1.7,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
