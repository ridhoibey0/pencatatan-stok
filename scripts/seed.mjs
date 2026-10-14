/**
 * Mengisi data awal: akun pengguna + kategori + channel.
 * Aman dijalankan berkali-kali (pakai INSERT ... ON DUPLICATE KEY UPDATE).
 *
 *   node scripts/seed.mjs
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* .env opsional kalau variabel sudah diset di shell */
  }
}
loadEnv();

const USERS = [
  { name: "Administrator", username: "admin", password: "admin123", role: "owner" },
  { name: "Staf Gudang", username: "gudang", password: "gudang123", role: "warehouse" },
  { name: "Host Live", username: "host", password: "host123", role: "host" },
];

const CATEGORIES = ["T-Shirt", "Polo Shirt", "Hoodie", "Kemasan", "Aksesoris"];
const CHANNELS = ["TikTok Shop", "Shopee", "Tokopedia", "Offline"];

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await conn.execute(
      `INSERT INTO users (name, username, password, role)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), password = VALUES(password),
                               role = VALUES(role), is_active = 1`,
      [u.name, u.username, hash, u.role],
    );
    console.log(`user  : ${u.username} / ${u.password}  (${u.role})`);
  }

  for (const c of CATEGORIES) {
    await conn.execute(
      `INSERT INTO categories (name) VALUES (?)
       ON DUPLICATE KEY UPDATE is_active = 1`,
      [c],
    );
  }
  console.log(`kategori: ${CATEGORIES.length} baris`);

  for (const c of CHANNELS) {
    await conn.execute(
      `INSERT INTO sales_channels (name) VALUES (?)
       ON DUPLICATE KEY UPDATE is_active = 1`,
      [c],
    );
  }
  console.log(`channel : ${CHANNELS.length} baris`);

  console.log("\nSelesai. GANTI password default setelah login pertama.");
} finally {
  await conn.end();
}
