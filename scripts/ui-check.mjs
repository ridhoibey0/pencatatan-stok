/**
 * Pemeriksa tampilan: membuka aplikasi di Chrome headless, menekan tombol
 * modal, lalu memeriksa posisi dan gaya yang benar-benar dihitung browser.
 *
 * Dipakai karena memeriksa HTML saja tidak cukup — masalah seperti gaya
 * warisan dari sel tabel baru kelihatan setelah CSS dihitung.
 *
 *   node --env-file=.env scripts/ui-check.mjs [--shot]
 */
import puppeteer from "puppeteer-core";
import { SignJWT } from "jose";
import { readFileSync, mkdirSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.UI_BASE ?? "http://localhost:3000";
const SHOT = process.argv.includes("--shot");
const OUT = "ui-shots";

let lolos = 0;
let gagal = 0;
function cek(nama, syarat, detail) {
  if (syarat) {
    lolos++;
    console.log(`  OK    ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` — ${detail}` : ""}`);
  }
}

const secret = readFileSync(".env", "utf8").match(/AUTH_SECRET="([^"]+)"/)[1];
const token = await new SignJWT({
  uid: 1,
  name: "Administrator",
  username: "admin",
  role: "owner",
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));

if (SHOT) mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});

async function buka(path, viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setCookie({
    name: "nerva_session",
    value: token,
    domain: "localhost",
    path: "/",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const res = await page.goto(BASE + path, { waitUntil: "networkidle0" });
  return { page, errors, status: res?.status() };
}

try {
  // ---------------------------------------------------------------- modal
  console.log("\n=== 1. Modal di halaman Produk");
  {
    const { page, errors, status } = await buka("/produk");
    cek("halaman terbuka", status === 200, `status ${status}`);

    const tombolEdit = await page.$$('button.btn-sm');
    cek("tombol aksi ada di baris tabel", tombolEdit.length > 0);

    // Dialog harus menempel langsung di <body>, bukan di dalam <td>.
    const indukDialog = await page.$$eval("dialog.nerva-dialog", (ds) =>
      ds.map((d) => d.parentElement?.tagName ?? "?"),
    );
    cek(
      `semua dialog dipasang ke <body> (${indukDialog.length} dialog)`,
      indukDialog.length > 0 && indukDialog.every((t) => t === "BODY"),
      indukDialog.join(","),
    );

    // Buka modal Edit baris pertama.
    const dibuka = await page.evaluate(() => {
      const b = [...document.querySelectorAll("td button")].find(
        (x) => x.textContent.trim() === "Edit",
      );
      if (!b) return false;
      b.click();
      return true;
    });
    cek("tombol Edit bisa diklik", dibuka);
    await new Promise((r) => setTimeout(r, 350));

    const info = await page.evaluate(() => {
      const d = [...document.querySelectorAll("dialog.nerva-dialog")].find((x) => x.open);
      if (!d) return null;
      const cs = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      const label = d.querySelector(".label");
      const input = d.querySelector("input[name='name']");
      return {
        textAlign: cs.textAlign,
        display: cs.display,
        position: cs.position,
        width: Math.round(r.width),
        left: Math.round(r.left),
        top: Math.round(r.top),
        viewportW: window.innerWidth,
        labelAlign: label ? getComputedStyle(label).textAlign : null,
        inputW: input ? Math.round(input.getBoundingClientRect().width) : null,
        judul: d.querySelector("h2")?.textContent ?? null,
        nilaiNama: input?.value ?? null,
      };
    });

    cek("dialog terbuka", info !== null);
    if (info) {
      cek("isi dialog rata kiri", info.textAlign === "left", `dapat ${info.textAlign}`);
      cek("label form rata kiri", info.labelAlign === "left", `dapat ${info.labelAlign}`);
      cek(
        "dialog berada di tengah layar",
        Math.abs(info.left + info.width / 2 - info.viewportW / 2) < 4,
        `kiri ${info.left}, lebar ${info.width}, viewport ${info.viewportW}`,
      );
      cek("lebar dialog wajar", info.width > 380 && info.width <= 460, `${info.width}px`);
      cek("input mengisi lebar dialog", info.inputW > 300, `${info.inputW}px`);
      cek("judul benar", info.judul === "Edit Produk", info.judul);
      cek("form terisi data baris", !!info.nilaiNama, info.nilaiNama);
      console.log(`        (judul "${info.judul}", nama terisi "${info.nilaiNama}")`);
    }

    if (SHOT) await page.screenshot({ path: `${OUT}/produk-modal.png` });

    // Esc menutup
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 250));
    const masihTerbuka = await page.$$eval("dialog.nerva-dialog", (ds) =>
      ds.some((d) => d.open),
    );
    cek("Esc menutup dialog", !masihTerbuka);

    cek("tidak ada error javascript", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---------------------------------------------------------------- HP
  console.log("\n=== 2. Tampilan HP (390x844)");
  {
    const { page, errors } = await buka("/produk", { width: 390, height: 844 });

    const geser = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    cek("tidak ada geser menyamping", !geser);

    const bottomNav = await page.evaluate(() => {
      const n = document.querySelector(".bottom-nav");
      return n ? getComputedStyle(n).display : null;
    });
    cek("bilah bawah muncul", bottomNav === "grid", `display ${bottomNav}`);

    const kartu = await page.evaluate(() => {
      const td = document.querySelector("table.stack tbody td[data-label='Kategori']");
      if (!td) return null;
      return {
        display: getComputedStyle(td).display,
        label: getComputedStyle(td, "::before").content,
      };
    });
    cek("sel tabel jadi baris berlabel", kartu?.display === "flex", JSON.stringify(kartu));

    await page.evaluate(() => {
      const b = [...document.querySelectorAll("td button")].find(
        (x) => x.textContent.trim() === "Edit",
      );
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 350));

    const m = await page.evaluate(() => {
      const d = [...document.querySelectorAll("dialog.nerva-dialog")].find((x) => x.open);
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        vw: window.innerWidth,
        align: getComputedStyle(d).textAlign,
        bawah: Math.round(window.innerHeight - r.bottom),
      };
    });
    cek("modal selebar layar di HP", m && Math.abs(m.w - m.vw) < 2, JSON.stringify(m));
    cek("modal rata kiri di HP", m?.align === "left", m?.align);

    if (SHOT) await page.screenshot({ path: `${OUT}/produk-modal-hp.png` });
    cek("tidak ada error javascript", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---------------------------------------------------------------- lain
  console.log("\n=== 3. Halaman lain terbuka tanpa error");
  for (const path of ["/", "/stok", "/bahan", "/pengguna", "/mapping", "/opname", "/laporan"]) {
    const { page, errors, status } = await buka(path);
    const jumlahDialog = await page.$$eval("dialog.nerva-dialog", (d) => d.length);
    const indukSalah = await page.$$eval("dialog.nerva-dialog", (ds) =>
      ds.filter((d) => d.parentElement?.tagName !== "BODY").length,
    );
    cek(
      `${path} (status ${status}, ${jumlahDialog} dialog)`,
      status === 200 && errors.length === 0 && indukSalah === 0,
      errors.slice(0, 1).join("") || (indukSalah ? `${indukSalah} dialog salah induk` : ""),
    );
    if (SHOT) {
      await page.screenshot({
        path: `${OUT}/${path === "/" ? "beranda" : path.slice(1).replace(/\//g, "-")}.png`,
        fullPage: true,
      });
    }
    await page.close();
  }

  // ---------------------------------------------------- opname lewat UI
  // Alur ini pernah gagal total: tanggal sesi dikirim balik ke kolom DATE
  // dalam bentuk "Wed Oct 14" sehingga MySQL menolaknya. Diuji dari ujung ke
  // ujung memakai varian sementara, lalu dibersihkan lagi.
  console.log("\n=== 4. Opname: buat sesi, isi hitungan, setujui");
  {
    const mysql = (await import("mysql2/promise")).default;
    const url = readFileSync(".env", "utf8").match(/DATABASE_URL="([^"]+)"/)[1];
    const db = await mysql.createConnection(url);

    const kode = `ZZUI${Date.now().toString().slice(-6)}`;
    const [katRows] = await db.query("SELECT id FROM categories ORDER BY id LIMIT 1");
    const [prod] = await db.execute(
      "INSERT INTO products (category_id, code, name, base_price) VALUES (?, ?, ?, 0)",
      [katRows[0].id, kode, "Produk Uji UI Opname"],
    );
    const [vr] = await db.execute(
      `INSERT INTO product_variants (product_id, sku, size, color, reorder_point, stock_on_hand)
       VALUES (?, ?, 'M', 'Uji', 0, 10)`,
      [prod.insertId, `${kode}-UJI-M`],
    );
    const variantId = vr.insertId;
    await db.execute(
      `INSERT INTO stock_movements (product_variant_id, movement_type, quantity,
         balance_after, reference_type, notes, movement_date)
       VALUES (?, 'in', 10, 10, 'manual', 'saldo awal uji ui', CURDATE())`,
      [variantId],
    );

    let sessionId = null;
    try {
      const { page, errors } = await buka("/opname");

      // Server action Next memakai navigasi sisi klien, jadi menunggu event
      // navigasi saja tidak cukup -- DOM bisa belum diperbarui. Ditunggu
      // sampai kondisi yang diharapkan benar-benar muncul.
      async function klik(teks, syarat, namaUji) {
        const ketemu = await page.evaluate((t) => {
          const b = [...document.querySelectorAll("button")].find((x) =>
            x.textContent.includes(t),
          );
          if (!b) return false;
          b.click();
          return true;
        }, teks);
        cek(`tombol "${teks}" ada dan diklik`, ketemu);
        if (!ketemu) return false;
        try {
          await page.waitForFunction(syarat, { timeout: 20000, polling: 200 });
          cek(namaUji, true);
          return true;
        } catch {
          cek(namaUji, false, `menunggu lebih dari 20 detik — URL ${page.url()}`);
          return false;
        }
      }

      await klik(
        "Mulai Sesi Opname",
        "/\\/opname\\/\\d+/.test(location.pathname)",
        "sesi opname terbuat",
      );
      sessionId = Number(page.url().match(/\/opname\/(\d+)/)?.[1]);

      const terisi = await page.evaluate((sku) => {
        const baris = [...document.querySelectorAll("tbody tr")].find((tr) =>
          tr.textContent.includes(sku),
        );
        if (!baris) return false;
        const input = baris.querySelector("input[name='counted_quantity']");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set;
        setter.call(input, "7");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }, `${kode}-UJI-M`);
      cek("baris varian uji ditemukan dan diisi", terisi);

      await klik(
        "Simpan Hitungan",
        "document.body.innerText.includes('Menunggu persetujuan')",
        "hitungan tersimpan",
      );

      const setuju = await klik(
        "Setujui",
        "document.body.innerText.includes('Disetujui') || location.search.includes('error=')",
        "halaman merespon penyetujuan",
      );

      if (setuju) {
        const teks = await page.evaluate(() => document.body.innerText);
        cek(
          "penyetujuan berhasil, bukan error",
          /Disetujui/.test(teks) && !page.url().includes("error="),
          page.url(),
        );
        cek("pesan menyebut jumlah penyesuaian", /1 SKU disesuaikan/.test(teks));

        const [cekStok] = await db.query(
          "SELECT stock_on_hand FROM product_variants WHERE id = ?",
          [variantId],
        );
        cek(
          "stok disesuaikan jadi 7",
          Number(cekStok[0]?.stock_on_hand) === 7,
          String(cekStok[0]?.stock_on_hand),
        );

        const [cekMut] = await db.query(
          `SELECT quantity, movement_date FROM stock_movements
            WHERE reference_type='stock_count' AND product_variant_id = ?`,
          [variantId],
        );
        cek("mutasi penyesuaian -3 tercatat", Number(cekMut[0]?.quantity) === -3);
        cek(
          "tanggal mutasi tersimpan sebagai tanggal sah",
          cekMut[0]?.movement_date instanceof Date,
          String(cekMut[0]?.movement_date),
        );
      }

      if (SHOT) await page.screenshot({ path: `${OUT}/opname-disetujui.png` });
      cek("tidak ada error javascript", errors.length === 0, errors.slice(0, 2).join(" | "));
      await page.close();
    } finally {
      if (sessionId) {
        await db.execute("DELETE FROM stock_count_items WHERE stock_count_id = ?", [sessionId]);
        await db.execute("DELETE FROM stock_counts WHERE id = ?", [sessionId]);
      }
      await db.execute("DELETE FROM stock_alerts WHERE product_variant_id = ?", [variantId]);
      await db.execute("DELETE FROM stock_movements WHERE product_variant_id = ?", [variantId]);
      await db.execute("DELETE FROM product_variants WHERE id = ?", [variantId]);
      await db.execute("DELETE FROM products WHERE id = ?", [prod.insertId]);
      await db.end();
      console.log("        (data uji dibersihkan)");
    }
  }

  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  if (SHOT) console.log(`Tangkapan layar tersimpan di ${OUT}/`);
} finally {
  await browser.close();
}

process.exit(gagal === 0 ? 0 : 1);
