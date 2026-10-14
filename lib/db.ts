import mysql from "mysql2/promise";

declare global {
  var __nervaPool: mysql.Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi di .env");
  return mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: 10,
    // Angka 18 digit seperti Order ID TikTok tidak muat di Number.
    // Kolom DECIMAL juga dikembalikan sebagai string agar tidak kehilangan presisi.
    decimalNumbers: false,
    dateStrings: false,
    timezone: "local",
  });
}

// Next.js me-reload modul saat dev; tanpa cache global, pool-nya menumpuk.
export const pool: mysql.Pool = global.__nervaPool ?? createPool();
if (process.env.NODE_ENV !== "production") global.__nervaPool = pool;

/** Nilai yang boleh jadi parameter prepared statement. */
export type Param = string | number | boolean | Date | Buffer | null;
type Params = readonly (Param | undefined)[];

/** mysql2 menolak undefined; perlakukan sebagai NULL. */
function norm(params: Params): Param[] {
  return params.map((p) => (p === undefined ? null : p));
}

/** SELECT yang mengembalikan banyak baris. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: Params = [],
): Promise<T[]> {
  const [rows] = await pool.query(sql, norm(params));
  return rows as T[];
}

/** SELECT yang mengembalikan satu baris atau null. */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: Params = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE. Mengembalikan insertId dan jumlah baris terpengaruh. */
export async function execute(
  sql: string,
  params: Params = [],
): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute(sql, norm(params));
  const r = result as mysql.ResultSetHeader;
  return { insertId: Number(r.insertId), affectedRows: r.affectedRows };
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T | null>;
  execute(sql: string, params?: Params): Promise<{ insertId: number; affectedRows: number }>;
}

/**
 * Menjalankan fn di dalam satu transaksi. Commit kalau fn selesai,
 * rollback kalau melempar error.
 *
 * Semua perubahan stok WAJIB lewat sini -- lihat docs/SKEMA-DATABASE.md bagian 6.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx: Tx = {
      async query<R = Record<string, unknown>>(sql: string, params: Params = []) {
        const [rows] = await conn.query(sql, norm(params));
        return rows as R[];
      },
      async queryOne<R = Record<string, unknown>>(sql: string, params: Params = []) {
        const [rows] = await conn.query(sql, norm(params));
        return ((rows as R[])[0] ?? null) as R | null;
      },
      async execute(sql: string, params: Params = []) {
        const [result] = await conn.execute(sql, norm(params));
        const r = result as mysql.ResultSetHeader;
        return { insertId: Number(r.insertId), affectedRows: r.affectedRows };
      },
    };
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
