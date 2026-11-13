# WhatApp Public Web / PWA

WhatApp adalah aplikasi chat web/PWA berbahasa Indonesia yang memakai akun Supabase nyata; tidak ada mode demo. Situs publik: <https://nana99-alt.github.io/whatapp-pages/>. Push ke branch `main` akan memperbarui GitHub Pages.

## Akun dan ID kontak

Pengguna baru pilih **Buat akun baru**, daftarkan email dan kata sandi minimal 6 karakter, lalu buka tautan verifikasi di email sebelum masuk. Setelah masuk, aplikasi membuat profil dan memberikan **ID WhatApp acak** dalam format `WA-1234-5678`. Buka tombol avatar di kanan atas untuk melihat email, ID kontak, atau mengubah nama tampilan. ID disimpan pada `public.profiles.virtual_number`, yang harus tetap memiliki constraint `UNIQUE`; database menjadi pemeriksa akhir bila dua pendaftaran kebetulan menghasilkan ID yang sama. Setiap akun mempertahankan ID yang sama saat masuk kembali. Pengguna lain yang masuk dapat mengetik ID itu melalui tombol `+` untuk membuka obrolan.

ID tersebut adalah **alamat kontak internal aplikasi**, bukan nomor seluler/SIM, bukan nomor PSTN, dan tidak bisa menerima SMS/OTP telepon. Chat dan panggilan memerlukan koneksi internet serta dua akun WhatApp. Panggilan suara/video memakai WebRTC dan signaling Supabase; pengguna harus mengizinkan mikrofon/kamera dan lawan bicara harus online untuk menerima panggilan. Saat aplikasi terbuka, panggilan masuk memainkan ringtone dan getar bila didukung perangkat. Push panggilan latar memakai service worker dan Supabase Edge Function; setiap perangkat penerima harus mengaktifkannya lewat **Profil → Aktifkan panggilan latar**. Android/Chrome menampilkan pemberitahuan dan mengikuti bunyi/getar notifikasi sistem. Notifikasi latar tetap dapat ditunda/diblokir oleh izin situs, Jangan Ganggu, penghemat baterai, atau force-stop Chrome/PWA. STUN tersedia untuk koneksi langsung, tetapi TURN relay belum disiapkan sehingga jaringan kantor, firewall, atau NAT tertentu dapat menggagalkan koneksi. Panggilan ini lewat internet, bukan jaringan telepon seluler/PSTN.

## Integrasi Supabase

`config.js` memuat Supabase URL dan publishable/anon key yang aman untuk dipakai di browser. Jangan pernah menaruh `service_role` key di sana. Tabel yang dipakai aplikasi adalah:

- `profiles`: `id` UUID yang merujuk ke `auth.users`, `display_name`, `avatar_url`, dan `virtual_number` unik.
- `messages`: `sender_id`, `receiver_id`, `body`, metadata lampiran, waktu kirim, dan status baca.

Aktifkan RLS dengan kebijakan yang membatasi perubahan profil ke pemilik akun dan membaca/mengirim pesan hanya bagi peserta percakapan. Untuk attachment, buat bucket `chat-media` dan atur kebijakannya sebelum mengaktifkan upload. Tambahkan `https://nana99-alt.github.io/whatapp-pages/` ke daftar URL redirect Supabase Auth (redirect email aplikasi kini kembali ke subfolder tersebut). Email perlu diverifikasi sebelum pengguna dapat masuk dan memperoleh ID.

Buka melalui HTTPS lalu pilih **Pasang** atau **Add to Home screen** untuk memasang PWA.

## Push panggilan latar

Tabel `call_push_subscriptions` menyimpan langganan push per akun/perangkat dengan RLS pemilik. Trigger pada insert `offer` ke `call_signals` memanggil Edge Function `send-call-push` melalui `pg_net`; function mengirim Web Push dan membersihkan endpoint yang kedaluwarsa. VAPID private key berada di Supabase Edge Function Secrets, bukan di repository. Setiap perangkat penerima perlu membuka WhatApp, masuk, membuka Profil, dan mengaktifkan panggilan latar satu kali. Setelah itu uji panggilan dari akun/perangkat lain. Push menampilkan notifikasi; mengetuk notifikasi membuka panggilan. Layanan web tidak dapat menjamin dering terus-menerus seperti aplikasi Android native saat Chrome dihentikan paksa atau dibatasi OS. Rujukan teknis ada di [PUSH_RESEARCH.md](PUSH_RESEARCH.md).
