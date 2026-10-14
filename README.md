# Nerva — Sistem Pencatatan Stok

Aplikasi web untuk mencatat stok barang jadi dan bahan baku, menggantikan pencatatan
di buku/papan tulis. Penjualan diimpor dari file export marketplace, bukan diketik ulang.

**Prinsip dasarnya:** angka stok tidak pernah diketik langsung. Yang dicatat adalah
kejadiannya — barang masuk, barang keluar, hasil opname — dan stok akhir dihitung
sistem dari buku besar `stock_movements`. Itu yang membuat setiap angka bisa
ditelusuri asal-usulnya, sesuatu yang tidak mungkin dilakukan papan tulis.

---

## Menjalankan

Prasyarat: Node 20+ dan MySQL 8 / MariaDB 10.5+ yang sudah jalan.

```bash
# 1. dependensi
npm install

# 2. atur koneksi database
cp .env.example .env     # lalu sesuaikan DATABASE_URL dan AUTH_SECRET

# 3. buat tabel
mysql -u root < database/schema.sql

# 4. isi data awal (akun, kategori, channel)
npm run seed

# 5. jalankan
npm run dev              # http://localhost:3000
```

Akun bawaan dari `npm run seed` — **ganti passwordnya setelah login pertama**:

| Username | Password | Peran |
|---|---|---|
| `admin` | `admin123` | Owner — semua akses |
| `gudang` | `gudang123` | Gudang — mencatat stok |
| `host` | `host123` | Host Live — hanya melihat stok |

### Perintah lain

```bash
npm run build        # build produksi
npm run start        # jalankan hasil build
npm run lint         # cek gaya kode
npm run test:stock   # uji buku besar stok (16 pemeriksaan)
npm run test:import  # uji import pakai file export asli (19 pemeriksaan)
```

Kedua skrip uji membuat data sementara di database lalu menghapusnya sendiri.

---

## Alur Pemakaian

```
Konveksi kirim barang
   └─ Order Produksi → Penerimaan Barang ........... stok BERTAMBAH

Penjualan di marketplace
   └─ Import file export ......................... stok BERKURANG
        ├─ pesanan dikirim/selesai      → stok keluar
        ├─ batal sebelum dikirim        → stok tidak disentuh
        └─ batal setelah dikirim        → stok keluar + masuk daftar Konfirmasi Retur
   └─ Konfirmasi Retur (saat paket sampai) ......... stok BERTAMBAH

Barang keluar lain (endorse, giveaway, rusak)
   └─ Catat Barang Keluar .......................... stok BERKURANG

Berkala
   └─ Stok Opname → disetujui Owner ................ stok DISESUAIKAN
```

Langkah pertama setelah instalasi:

1. **Produk & Varian** — buat produk (`T014`) lalu variannya per ukuran/warna.
   Stok menempel pada varian, bukan produk.
2. **Opname pertama** — pakai hasil hitung fisik sebagai saldo pembuka, jangan
   menyalin angka dari papan tulis.
3. **Import** file export pertama — SKU yang belum dikenal akan ditawarkan untuk
   dipetakan di halaman itu juga.

---

## Hal yang Perlu Diketahui

**Stok boleh minus, dan itu disengaja.** Penjualan dicatat sebagai rekap setelah
kejadian. Kalau jumlah keluar melebihi stok tercatat, yang salah adalah catatannya —
barangnya memang sudah laku. Input tetap diterima, stok jadi minus, dan sistem
menerbitkan peringatan selisih yang diselesaikan lewat opname. Menolak input hanya
akan membuat petugas mengarang angka supaya bisa lanjut.

**Angka stok di halaman utama adalah angka per rekap terakhir**, bukan real-time.
Waktunya ditampilkan di atas tabel. Sistem ini tidak bisa mencegah oversell saat
live sedang berlangsung — yang bisa dijamin adalah angka yang akurat *sebelum*
live dimulai.

**Satu file export boleh diupload berkali-kali.** Satu pesanan hanya mengurangi stok
sekali seumur hidupnya, dijaga di `lib/order-sync.ts`.

**Pencatatan tidak bisa dihapus.** Kesalahan dikoreksi dengan mutasi lawan yang
menunjuk ke mutasi aslinya, sehingga riwayatnya tetap utuh.

---

## Struktur

```
app/
  login/              halaman masuk
  (app)/              semua halaman yang butuh login
    page.tsx          dashboard
    stok/             daftar stok, kartu stok, catat keluar, konfirmasi retur
    produk/           master produk & varian
    produksi/         order ke konveksi
    penerimaan/       barang jadi masuk dari konveksi
    pesanan/          hasil import marketplace
    import/           upload file export + pemetaan SKU
    mapping/          daftar pemetaan SKU marketplace → varian
    opname/           sesi stok opname
    bahan/            bahan baku & pembelian
    peringatan/       stok menipis, habis, selisih
    laporan/          ringkasan mutasi & penjualan
    pengguna/         akun & log aktivitas
lib/
  db.ts               koneksi MySQL, helper query, withTransaction
  stock.ts            buku besar stok — SATU-SATUNYA tempat stok berubah
  auth.ts             sesi, peran, hak akses
  tiktok-import.ts    pembaca file export TikTok
  order-sync.ts       menulis pesanan + mutasi stok, menjaga idempotensi
components/           komponen UI bersama
database/schema.sql   skema database (24 tabel + 2 view)
docs/                 rencana, penjelasan skema, spesifikasi import
scripts/              seed dan skrip uji
```

### Aturan yang tidak boleh dilanggar

Jangan pernah meng-`UPDATE product_variants.stock_on_hand` dari mana pun selain
`recordMovement()` di `lib/stock.ts`. Kolom itu hanya cache; kebenarannya ada di
`stock_movements`. View `v_stock_balance_check` dibuat untuk mendeteksi pelanggaran —
idealnya selalu mengembalikan 0 baris:

```sql
SELECT * FROM v_stock_balance_check;
```

---

## Dokumentasi

- [`docs/PLANNING.md`](docs/PLANNING.md) — ruang lingkup, peran, tahapan
- [`docs/SKEMA-DATABASE.md`](docs/SKEMA-DATABASE.md) — konvensi penamaan, alasan tiap tabel, alur transaksi
- [`docs/IMPORT-TIKTOK.md`](docs/IMPORT-TIKTOK.md) — bentuk file export, pemetaan kolom, jebakan teknis

## Teknologi

Next.js 15 (App Router) · TypeScript · MySQL/MariaDB lewat `mysql2` · ExcelJS ·
sesi JWT di cookie httpOnly (`jose` + `bcryptjs`).

Tanpa ORM: kueri ditulis sebagai SQL langsung supaya `SELECT … FOR UPDATE` dan
transaksi stok terlihat apa adanya, dan supaya `database/schema.sql` tetap jadi
satu-satunya sumber kebenaran skema.
