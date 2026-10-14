export function rupiah(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function angka(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("id-ID").format(n);
}

export function tanggal(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function tanggalJam(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** "sejak 5 menit lalu" untuk penanda waktu rekap terakhir. */
export function sejak(value: Date | string | null | undefined): string {
  if (!value) return "belum ada data";
  const d = value instanceof Date ? value : new Date(value);
  const detik = Math.floor((Date.now() - d.getTime()) / 1000);
  if (detik < 60) return "baru saja";
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  return `${hari} hari lalu`;
}

/** Input <input type="date"> -> string YYYY-MM-DD, atau hari ini kalau kosong. */
export function tanggalISO(value?: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Apa pun -> "YYYY-MM-DD" yang aman dikirim balik ke kolom DATE.
 *
 * Driver mengembalikan kolom DATE sebagai objek Date, dan `String(date)`
 * menghasilkan "Wed Oct 14 2026 …" — bukan format yang bisa diterima MySQL.
 * Memotongnya dengan slice(0, 10) menghasilkan "Wed Oct 14" dan membuat
 * query gagal dengan ER_TRUNCATED_WRONG_VALUE. Jadi tanggal dari database
 * harus selalu lewat sini sebelum dipakai lagi sebagai parameter.
 */
export function tanggalSQL(value: Date | string | null | undefined): string {
  if (!value) return tanggalISO();
  if (typeof value === "string") {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? tanggalISO() : tanggalSQL(d);
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}

export const LABEL_MUTASI: Record<string, string> = {
  in: "Masuk",
  out: "Keluar",
  return: "Retur",
  damage: "Rusak",
  count_adjustment: "Opname",
  correction: "Koreksi",
  usage: "Pemakaian",
};

export const LABEL_STATUS_PESANAN: Record<string, string> = {
  pending: "Belum diproses",
  processing: "Diproses",
  shipped: "Dikirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export const LABEL_SUMBER_PESANAN: Record<string, string> = {
  live: "Live",
  video: "Video",
  product_card: "Etalase",
  other: "Lainnya",
};

export const LABEL_PERAN: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse: "Gudang",
  host: "Host Live",
};
