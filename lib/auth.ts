import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { query, queryOne, execute } from "./db";

export type Role = "owner" | "warehouse" | "host" | "admin";

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
}

const COOKIE = "nerva_session";
const MAX_AGE = 60 * 60 * 12; // 12 jam

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET belum diisi atau kurang dari 32 karakter");
  }
  return new TextEncoder().encode(s);
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await queryOne<{
    id: number;
    name: string;
    username: string;
    password: string;
    role: Role;
    is_active: number;
  }>(
    `SELECT id, name, username, password, role, is_active
       FROM users WHERE username = ? LIMIT 1`,
    [username],
  );

  // Pesan error sengaja sama untuk username salah dan password salah,
  // supaya tidak bisa dipakai menebak username mana yang ada.
  const invalid = { ok: false as const, error: "Username atau password salah" };
  if (!user) return invalid;
  if (!(await bcrypt.compare(password, user.password))) return invalid;
  if (!user.is_active) return { ok: false, error: "Akun ini dinonaktifkan" };

  const token = await new SignJWT({
    uid: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });

  await execute(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      id: Number(payload.uid),
      name: String(payload.name),
      username: String(payload.username),
      role: payload.role as Role,
    };
  } catch {
    return null;
  }
}

/** Dipakai di setiap halaman dalam grup (app). Melempar ke /login kalau belum masuk. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/?forbidden=1");
  return user;
}

export function can(role: Role, action: Permission): boolean {
  return PERMISSIONS[action].includes(role);
}

export type Permission =
  | "view_stock"
  | "record_stock"
  | "manage_products"
  | "manage_orders"
  | "manage_production"
  | "manage_materials"
  | "approve_count"
  | "manage_users";

const PERMISSIONS: Record<Permission, Role[]> = {
  view_stock: ["owner", "admin", "warehouse", "host"],
  record_stock: ["owner", "admin", "warehouse"],
  manage_products: ["owner", "admin"],
  manage_orders: ["owner", "admin", "warehouse"],
  manage_production: ["owner", "admin", "warehouse"],
  manage_materials: ["owner", "admin", "warehouse"],
  approve_count: ["owner", "admin"],
  manage_users: ["owner", "admin"],
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Dipakai halaman pengguna untuk menampilkan daftar peran. */
export async function listUsers() {
  return query(
    `SELECT id, name, username, role, is_active, last_login_at, created_at
       FROM users ORDER BY name`,
  );
}
