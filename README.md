# Block Blast Solver

PWA statis (tanpa backend) yang membaca kondisi papan 8x8 dari screenshot
game Block Blast, menerima hingga 3 piece dari tray, dan merekomendasikan
urutan + posisi penempatan yang menghasilkan skor maksimal.

## Menjalankan secara lokal

Tidak ada build step. Cukup serve direktori ini sebagai static file dan buka
`index.html` — misalnya:

```bash
npx serve .
```

atau server statis apa pun (Python `http.server`, dsb). Membuka `index.html`
langsung lewat `file://` tidak akan berfungsi karena ES modules dan Service
Worker butuh HTTP(S)/localhost.

## Menjalankan test

```bash
node --test
```

Menjalankan seluruh test di bawah `test/` (auto-discovery bawaan Node).
**Catatan:** pada Node v24.18 di Windows, memberi path direktori eksplisit
(`node --test test/`) memicu bug argumen CLI Node — path tersebut malah
diperlakukan sebagai entry-point skrip, bukan sebagai target penemuan test.
Sebagai gantinya gunakan salah satu dari:

```bash
node --test
node --test test/board.test.mjs test/solver.test.mjs
node --test "test/*.test.mjs"
```

Ketiganya sudah diverifikasi menjalankan seluruh 19 test dengan hasil sama.

## Deploy ke Hostinger

Upload seluruh isi folder ini apa adanya ke `public_html` (atau subfolder
tujuan). Tidak ada langkah build — semua file sudah siap pakai. Pastikan
domain berjalan di atas HTTPS agar Service Worker dan PWA install prompt
berfungsi (keduanya butuh secure context; `localhost` terkecuali untuk
development).

## Keputusan desain penting

- **Tanpa Tailwind CDN.** Tailwind CDN adalah compiler JIT berbasis JS yang
  butuh koneksi saat load pertama dan scan DOM di runtime — bertentangan
  dengan syarat "tanpa build step" + "harus berfungsi offline" + file scope
  yang hanya mengizinkan satu `css/styles.css`. CSS ditulis manual di
  `css/styles.css` memakai design token yang diberikan.
- **Piece library menghasilkan 37 piece** (bukan hard-coded ke angka
  tertentu) dari 15 bentuk dasar di `js/pieces.js`, hasil dedupe kanonik
  4-rotasi. `RECT23` (persegi panjang solid 2x3) punya simetri 180° seperti
  piece `LINE*`, sehingga menghasilkan 2 varian, bukan 4 — ini konsekuensi
  matematis yang benar dari aturan dedupe, bukan bug.
- **Solver tidak pernah merotasi piece** — exhaustive search atas semua
  permutasi urutan + posisi legal, dengan bounded top-K candidate pool agar
  tetap cepat pada kasus pathological (mis. 3 piece DOT di papan kosong)
  tanpa pernah membuang skor optimal yang sebenarnya.
- **Model skor adalah aproksimasi**, didefinisikan di satu tempat
  (`SCORING` di `js/solver.js`) supaya mudah dikalibrasi ulang; peringkat
  relatif antar-langkah tetap valid meski game asli punya rumus berbeda.
- **Deteksi screenshot pakai saturasi × value ("colorfulness"), bukan
  saturasi murni**, untuk klasifikasi sel terisi/kosong. Pengujian dengan
  screenshot asli (`test/fixtures/`) menunjukkan sel kosong di tema game
  yang diuji dirender dengan warna navy gelap yang justru punya saturasi
  cukup tinggi (S≈0.61) — lebih tinggi dari beberapa warna piece (mis.
  ungu, S≈0.56). Yang secara konsisten membedakan keduanya adalah
  brightness: sel kosong gelap (V≈0.3), semua warna piece terang (V≥0.5).
  Auto-detect crop tetap best-effort (lihat komentar di `js/detector.js`)
  dan koreksi manual (crop + tap sel) selalu tersedia sebagai fallback
  wajib, sesuai spesifikasi.

## Struktur file

Sesuai daftar Scope — lihat komentar di masing-masing file untuk detail
implementasi.
