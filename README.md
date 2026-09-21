# Yer maydonlari video arxivi

O‘zbekiston Respublikasi Prezidentining **2026 yil 11 iyundagi PQ-220-son** qarorining
**7-ilovasiga** muvofiq **«Namangan turistik-rekreatsion hududlarini rivojlantirish direksiyasi»**ga
doimiy foydalanish huquqi asosida biriktirilgan yer maydonlari haqida tayyorlangan
videolar uchun veb-sayt.

Sayt uch vazifani bajaradi:

1. **Video yuklash** — video fayl tanlanadi, nomi va tasnifi (hamda tuman, maydoni,
   kadastr raqami, koordinata) kiritiladi;
2. **Ko‘rish** — video sahifasida player orqali ijro etiladi (oldinga/orqaga o‘tish qo‘llanadi);
3. **QR-kod** — har bir video uchun unga olib boradigan havola QR-kod shaklida
   avtomatik yaratiladi, uni PNG sifatida yuklab olish yoki chop etish mumkin.

## Ikki variant mavjud

| Variant | Fayl | Qanday ishlatiladi | Qachon qulay |
| ------- | ---- | ------------------ | ------------ |
| **Oddiy (serversiz)** | `oddiy.html` | Faylni brauzerda ochish kifoya | Tez sinab ko‘rish, bitta kompyuterda ishlash |
| **Server bilan** | `server.js` + `public/` | `node server.js` va `http://localhost:3000` | Haqiqiy sayt: videolar serverda turadi, QR havolasi hammada ishlaydi |

### Oddiy variant: `oddiy.html`

Bitta HTML fayl — **hech qanday o‘rnatish, server yoki internet talab qilinmaydi**.
Faylni brauzerda ochasiz, videoni tanlaysiz, nomi va tasnifini kiritasiz, so‘ng
player va QR-kod paydo bo‘ladi.

- Videolar **shu brauzerning xotirasida** (IndexedDB) saqlanadi — sahifani yopib qayta
  ochsangiz ham joyida turadi.
- Videoni boshqa kompyuterga o‘tkazish uchun saqlangan faylni «Video faylni yuklab olish»
  tugmasi orqali qaytarib olish mumkin.
- **QR-kod haqida muhim jihat:** QR-kod havolaga ishlaydi, shuning uchun telefonda
  ochilishi kerak bo‘lsa videoning internetdagi havolasi zarur. Uni «QR-kod uchun tashqi
  havola» maydoniga kiritsangiz (yoki QR panelidagi havola maydonini tahrirlasangiz),
  QR-kod aynan shu havolaga yaratiladi. Fayl brauzer xotirasida tursa, QR faqat shu
  kompyuterdagi sahifani ochadi.
- Brauzer xotirasi tozalansa, videolar ham o‘chadi.
- **Hostingga joylash uchun bu variant mos emas:** unda «kim video joylashi mumkin»
  degan cheklovni qo‘yish imkoni yo‘q (hamma o‘z brauzerida o‘zi uchun ishlaydi).
  Saytni internetga chiqarish uchun quyidagi server variantini ishlating — unda
  yuklash parol bilan himoyalangan, ko‘rish esa hammaga ochiq.

## Asosiy xususiyatlari

- **Tashqi kutubxonalar yo‘q** — faqat Node.js standart modullari va vanilla JS
  (`npm install` talab qilinmaydi). QR generator ham loyiha ichida yozilgan.
- **HTTP Range** qo‘llab-quvvatlanadi — videoni istalgan joydan ko‘rish (seek) ishlaydi.
- **Muqova rasmi** brauzerda videoning birinchi kadridan avtomatik olinadi.
- **Qidiruv** — nomi, tumani, kadastr raqami va tasnif bo‘yicha.
- Videolar `data/uploads/` papkasida, ma’lumotlar `data/videos.json` faylida saqlanadi
  (ma’lumotlar bazasi kerak emas).

## Server variantini ishga tushirish

Node.js 18 yoki undan yuqori versiyasi kerak.

```bash
node server.js
# yoki
npm start
```

So‘ng brauzerda: <http://localhost:3000>

## Kim nima qila oladi

Sayt ochiq ko‘rish uchun mo‘ljallangan, lekin video joylash huquqi faqat
administratorga beriladi:

| Amal                                   | Mehmon (hamma) | Administrator (parol bilan) |
| -------------------------------------- | :------------: | :-------------------------: |
| Videolar ro‘yxatini ko‘rish            | ✔ | ✔ |
| Videoni ijro etish, QR-kodni olish     | ✔ | ✔ |
| Yangi video yuklash                    | ✘ | ✔ |
| Video ma’lumotlarini tahrirlash        | ✘ | ✔ |
| Videoni o‘chirish                      | ✘ | ✔ |

Administrator saytning o‘ng yuqorisidagi **«Administrator kirishi»** tugmasi orqali
parol kiritadi. Shundan keyin yuklash formasi va o‘chirish tugmalari paydo bo‘ladi.
Mehmonlarga bu elementlar umuman ko‘rsatilmaydi va server tomonida ham
ruxsatsiz so‘rovlar `401` bilan rad etiladi.

Himoya qanday ishlaydi:

- parol `ADMIN_PASSWORD` muhit o‘zgaruvchisida saqlanadi (kodda emas);
- kirishdan so‘ng imzolangan (HMAC-SHA256) sessiya cookie’si beriladi —
  `HttpOnly`, `SameSite=Strict`, HTTPS ortida `Secure`, muddati 12 soat;
- sessiya kaliti `data/session.key` faylida saqlanadi, shuning uchun server
  qayta ishga tushganda ham kirgan administrator chiqib ketmaydi;
- parolni topishga urinishlar cheklangan: bitta IP’dan 15 daqiqada 10 marta
  xato kiritilsa, `429` javobi qaytariladi;
- parol vaqt bo‘yicha barqaror (`timingSafeEqual`) usulda solishtiriladi.

## Sozlamalar (muhit o‘zgaruvchilari)

| O‘zgaruvchi         | Standart qiymat     | Vazifasi                                                        |
| ------------------- | ------------------- | --------------------------------------------------------------- |
| `ADMIN_PASSWORD`    | tasodifiy yaratiladi| Video yuklash/o‘chirish uchun parol. Berilmasa — ishga tushganda konsolga chiqariladi |
| `PORT`              | `3000`              | Server porti                                                    |
| `HOST`              | `0.0.0.0`           | Tinglanadigan manzil                                            |
| `DATA_DIR`          | `./data`            | Videolar va metama’lumotlar papkasi                             |
| `MAX_UPLOAD_BYTES`  | `536870912` (512 MB)| Bitta videoning maksimal hajmi                                  |
| `PUBLIC_BASE_URL`   | bo‘sh               | QR-kodlar uchun tashqi manzil, masalan `https://video.namangan.uz` |

> **Muhim:** QR-kodni telefon bilan skaner qilib ochish uchun sayt tashqaridan
> ochiladigan manzilda turishi kerak. Reverse proxy (nginx) ortida ishlatilganda
> `PUBLIC_BASE_URL` ni haqiqiy domenga sozlang — aks holda QR-kodga brauzerdagi
> joriy manzil (masalan `http://localhost:3000`) yoziladi.

Misol:

```bash
PORT=8080 PUBLIC_BASE_URL=https://video.namangan.uz DATA_DIR=/var/lib/video-arxiv node server.js
```

## Hostingga joylash

Quyida Linux serverda nginx orqali joylashning to‘liq tartibi keltirilgan.

**1. Fayllarni serverga qo‘yish va xizmat yaratish** (`/etc/systemd/system/video-arxiv.service`):

```ini
[Unit]
Description=Yer maydonlari video arxivi
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/video-arxiv
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=DATA_DIR=/var/lib/video-arxiv
Environment=PUBLIC_BASE_URL=https://video.namangan.uz
Environment=ADMIN_PASSWORD=BU_YERGA_KUCHLI_PAROL
Environment=MAX_UPLOAD_BYTES=1073741824

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/video-arxiv && sudo chown www-data:www-data /var/lib/video-arxiv
sudo systemctl enable --now video-arxiv
sudo systemctl status video-arxiv
```

`HOST=127.0.0.1` qo‘yilgani muhim: server tashqaridan to‘g‘ridan-to‘g‘ri emas,
faqat nginx orqali ochiladi.

**2. nginx sozlamasi** (`/etc/nginx/sites-available/video-arxiv`):

```nginx
server {
    listen 80;
    server_name video.namangan.uz;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name video.namangan.uz;

    ssl_certificate     /etc/letsencrypt/live/video.namangan.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/video.namangan.uz/privkey.pem;

    # Video yuklash uchun hajm chegarasi (MAX_UPLOAD_BYTES bilan mos bo‘lsin)
    client_max_body_size 1024M;
    # Katta fayl yuklanayotganda uzilib qolmasligi uchun
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-Proto` sarlavhasi uzatilishi shart — server shu orqali HTTPS’ni
aniqlab, sessiya cookie’siga `Secure` bayrog‘ini qo‘yadi. `X-Forwarded-For` esa
parol urinishlarini IP bo‘yicha cheklash uchun ishlatiladi.

```bash
sudo ln -s /etc/nginx/sites-available/video-arxiv /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d video.namangan.uz   # HTTPS sertifikati
```

**3. Zaxira nusxa.** Barcha ma’lumot `DATA_DIR` ichida (`uploads/`, `posters/`,
`videos.json`). Muntazam zaxiralash uchun, masalan:

```bash
tar czf /backup/video-arxiv-$(date +%F).tar.gz -C /var/lib/video-arxiv .
```

**4. Tekshirish.** Saytni oching, «Administrator kirishi» orqali parolni kiriting,
bitta video yuklang va QR-kodni telefon kamerasi bilan skaner qilib ko‘ring —
QR videoning `https://video.namangan.uz/v/<id>` sahifasini ochishi kerak.

## Loyiha tuzilishi

```
oddiy.html             serversiz variant: bitta faylda butun sayt (QR generator ham ichida)
server.js              HTTP server, yuklash va video oqimi (Range bilan)
lib/auth.js            administrator sessiyalari (imzolangan cookie, urinish chegarasi)
lib/store.js           videos.json ustida atomik yozuv (JSON «ombor»)
public/index.html      bosh sahifa: yuklash formasi + videolar ro‘yxati
public/video.html      video sahifasi: player + QR-kod
public/css/styles.css  saytning barcha uslublari
public/js/qr.js        QR-kod generatori (ISO/IEC 18004, bayt rejimi, M darajasi)
public/js/index.js     bosh sahifa mantiqi (yuklash, qidiruv, o‘chirish)
public/js/video.js     video sahifasi mantiqi (player, QR, nusxalash/chop etish)
public/js/util.js      umumiy yordamchi funksiyalar
public/js/icons.js     SVG ikonka yordamchisi
data/                  yuklangan videolar va videos.json (git’ga kirmaydi)
```

## API

| Metod    | Manzil                     | Vazifasi                                                         |
| -------- | -------------------------- | ---------------------------------------------------------------- |
| `GET`    | `/api/videos`              | Barcha videolar ro‘yxati (JSON) — ochiq                          |
| `POST`   | `/api/videos`              | 🔒 Video yuklash. Tanasi — fayl baytlari, `x-video-meta` sarlavhasida base64(JSON) ma’lumotlar |
| `GET`    | `/api/videos/:id`          | Bitta video ma’lumotlari — ochiq                                  |
| `PATCH`  | `/api/videos/:id`          | 🔒 Nomi/tasnifini va boshqa maydonlarni tahrirlash (JSON)          |
| `DELETE` | `/api/videos/:id`          | 🔒 Videoni va fayllarini o‘chirish                                 |
| `POST`   | `/api/videos/:id/poster`   | 🔒 Muqova rasmi (JPEG baytlari)                                    |
| `POST`   | `/api/login`               | Administrator kirishi: `{"password":"…"}`                         |
| `POST`   | `/api/logout`              | Sessiyani yopish                                                  |
| `GET`    | `/api/session`             | `{"admin": true|false}` — joriy holat                             |
| `GET`    | `/api/config`              | `publicBaseUrl`, `maxUploadBytes`                                 |
| `GET`    | `/media/:id`               | Video oqimi (HTTP Range qo‘llanadi) — ochiq                       |
| `GET`    | `/poster/:id`              | Muqova rasmi — ochiq                                              |
| `GET`    | `/v/:id`                   | Video sahifasi (QR-kodlarda ishlatiladigan qisqa havola) — ochiq   |

🔒 — administrator sessiyasi talab qilinadi (aks holda `401`).

Yuklash misoli (avval kirish, so‘ng cookie bilan yuklash):

```bash
# 1. Administrator sifatida kirish — cookie faylga saqlanadi
curl -c cookie.txt -X POST http://localhost:3000/api/login \
  -H "content-type: application/json" \
  -d '{"password":"BU_YERGA_PAROL"}'

# 2. Videoni yuklash
META=$(printf '%s' '{"title":"Chortoq tumani, 12-kontur","description":"Izoh","district":"Chortoq tumani"}' | base64 -w0)
curl -b cookie.txt -X POST http://localhost:3000/api/videos \
  -H "content-type: video/mp4" \
  -H "x-video-meta: $META" \
  --data-binary @video.mp4
```

## QR-kod haqida

QR generator (`public/js/qr.js`) standart talablariga muvofiq yozilgan:
bayt rejimi (UTF-8), xatolarni tuzatish darajasi **M** (taxminan 15% shikastlanishga
chidamli), 1–20 versiyalar (666 baytgacha ma’lumot). Maskalar 1–4 jarima qoidalari
bo‘yicha avtomatik tanlanadi.

QR-kodga videoning qisqa havolasi (`<manzil>/v/<id>`) yoziladi, shuning uchun kod
ixcham (odatda 29×29 modul) va telefon kamerasi bilan oson o‘qiladi. Chop etish uchun
kod 1024 pikseldan kichik bo‘lmagan PNG sifatida yuklab olinadi.

## Xavfsizlik bo‘yicha eslatmalar

- **Parolni kuchli qilib tanlang** va faqat `ADMIN_PASSWORD` orqali bering
  (systemd faylida yoki `/etc/environment`da). Parolni almashtirish uchun
  o‘zgaruvchini yangilab, xizmatni qayta ishga tushirish kifoya.
- **HTTPS majburiy** — parol shifrlanmagan HTTP orqali uzatilmasligi kerak.
- `DATA_DIR` papkasiga faqat xizmat foydalanuvchisi (`www-data`) kira olsin;
  ichidagi `session.key` faylini nusxalab tarqatmang.
- Yuklangan video fayllar `/media/<id>` manzilida hamma uchun ochiq bo‘ladi —
  sayt mazmuni ommaviy deb hisoblanadi.
- Ichki foydalanish uchun qo‘shimcha himoya kerak bo‘lsa, nginx darajasida IP
  cheklash (`allow`/`deny`) yoki VPN qo‘shish mumkin.
- `data/` papkasini muntazam zaxiralab turing.
