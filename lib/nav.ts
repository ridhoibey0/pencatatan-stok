import type { Permission } from "./auth";
import type { IconName } from "@/components/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  perm: Permission;
  /** Rute lain yang membuat item ini dianggap aktif (halaman anak / tab). */
  match?: string[];
}

/**
 * Menu disusun ulang dari 16 item / 5 grup menjadi 11 item / 3 grup.
 *
 * Yang dipindahkan ke dalam halaman lain sebagai tab, bukan item menu sendiri:
 *   Import & Pemetaan SKU  -> tab di halaman Pesanan
 *   Order Produksi         -> tab di halaman Barang Masuk
 *   Pembelian Bahan        -> tab di halaman Bahan Baku
 *   Peringatan             -> lonceng di header, bukan menu
 */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Utama",
    items: [
      { href: "/", label: "Beranda", icon: "home", perm: "view_stock" },
      {
        href: "/stok",
        label: "Stok",
        icon: "box",
        perm: "view_stock",
        match: ["/stok"],
      },
      {
        href: "/pesanan",
        label: "Pesanan",
        icon: "cart",
        perm: "manage_orders",
        match: ["/pesanan", "/import", "/mapping"],
      },
    ],
  },
  {
    group: "Gudang",
    items: [
      {
        href: "/penerimaan",
        label: "Barang Masuk",
        icon: "truck-in",
        perm: "record_stock",
        match: ["/penerimaan", "/produksi"],
      },
      {
        href: "/stok/keluar",
        label: "Barang Keluar",
        icon: "truck-out",
        perm: "record_stock",
      },
      { href: "/stok/retur", label: "Retur", icon: "undo", perm: "record_stock" },
      { href: "/opname", label: "Opname", icon: "clipboard", perm: "record_stock" },
    ],
  },
  {
    group: "Kelola",
    items: [
      { href: "/produk", label: "Produk", icon: "tag", perm: "manage_products" },
      {
        href: "/bahan",
        label: "Bahan Baku",
        icon: "layers",
        perm: "manage_materials",
        match: ["/bahan"],
      },
      { href: "/laporan", label: "Laporan", icon: "chart", perm: "view_stock" },
      { href: "/pengguna", label: "Pengguna", icon: "users", perm: "manage_users" },
    ],
  },
];

/** Pintasan di bilah bawah layar HP: yang paling sering dibuka orang gudang. */
export const BOTTOM_NAV: NavItem[] = [
  { href: "/stok", label: "Stok", icon: "box", perm: "view_stock" },
  { href: "/penerimaan", label: "Masuk", icon: "truck-in", perm: "record_stock" },
  { href: "/stok/keluar", label: "Keluar", icon: "truck-out", perm: "record_stock" },
  { href: "/opname", label: "Opname", icon: "clipboard", perm: "record_stock" },
];

/** Tab di dalam halaman, menggantikan item menu yang dulu terpisah. */
export const TABS: Record<string, { href: string; label: string }[]> = {
  pesanan: [
    { href: "/pesanan", label: "Daftar Pesanan" },
    { href: "/import", label: "Import Export" },
    { href: "/mapping", label: "Pemetaan SKU" },
  ],
  gudangMasuk: [
    { href: "/penerimaan", label: "Penerimaan Barang" },
    { href: "/produksi", label: "Order Produksi" },
  ],
  bahan: [
    { href: "/bahan", label: "Stok Bahan" },
    { href: "/bahan/pembelian", label: "Pembelian" },
  ],
  stok: [
    { href: "/stok", label: "Daftar Stok" },
    { href: "/stok/keluar", label: "Catat Keluar" },
    { href: "/stok/retur", label: "Retur" },
  ],
};

/**
 * Item menu dianggap aktif kalau rutenya sama persis, atau kalau path sekarang
 * berada di bawah salah satu prefix `match`. Pengecualian untuk "/stok" supaya
 * tidak ikut menyala saat membuka "/stok/keluar" yang punya menunya sendiri.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.href === "/stok") {
    return pathname === "/stok" || /^\/stok\/\d+$/.test(pathname);
  }
  if (item.match) {
    return item.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
