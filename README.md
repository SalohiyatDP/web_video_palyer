# Yer maydonlari video arxivi

Ўзбекистон Республикаси Президентининг **2026 йил 11 июндаги ПҚ-220-сон** қарорининг
**7-иловасига** мувофиқ **«Наманган туристик-рекреацион ҳудудларини ривожлантириш дирекцияси»**га
доимий фойдаланиш ҳуқуқи асосида бириктирилган ер майдонлари ҳақида тайёрланган
видеолар учун оддий веб-сайт.

Sayt uch vazifani bajaradi:

1. **Video yuklash** — video fayl tanlanadi, nomi va tasnifi (hamda tuman, maydoni,
   kadastr raqami, koordinata) kiritiladi;
2. **Ko‘rish** — video sahifasida player orqali ijro etiladi (oldinga/orqaga o‘tish qo‘llanadi);
3. **QR-kod** — har bir video uchun unga olib boradigan havola QR-kod shaklida
   avtomatik yaratiladi, uni PNG sifatida yuklab olish yoki chop etish mumkin.

## Asosiy xususiyatlari

- **Tashqi kutubxonalar yo‘q** — faqat Node.js standart modullari va vanilla JS
  (`npm install` talab qilinmaydi). QR generator ham loyiha ichida yozilgan.
- **HTTP Range** qo‘llab-quvvatlanadi — videoni istalgan joydan ko‘rish (seek) ishlaydi.
- **Muqova rasmi** brauzerda videoning birinchi kadridan avtomatik olinadi.
- **Qidiruv** — nomi, tumani, kadastr raqami va tasnif bo‘yicha.
- Videolar `data/uploads/` papkasida, ma’lumotlar `data/videos.json` faylida saqlanadi
  (ma’lumotlar bazasi kerak emas).

## Ishga tushirish

Node.js 18 yoki undan yuqori versiyasi kerak.

```bash
node server.js
# yoki
npm start
```

So‘ng brauzerda: <http://localhost:3000>

## Sozlamalar (muhit o‘zgaruvchilari)

| O‘zgaruvchi         | Standart qiymat     | Vazifasi                                                        |
| ------------------- | ------------------- | --------------------------------------------------------------- |
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

## Loyiha tuzilishi

```
server.js              HTTP server, yuklash va video oqimi (Range bilan)
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
| `GET`    | `/api/videos`              | Barcha videolar ro‘yxati (JSON)                                  |
| `POST`   | `/api/videos`              | Video yuklash. Tanasi — fayl baytlari, `x-video-meta` sarlavhasida base64(JSON) ma’lumotlar |
| `GET`    | `/api/videos/:id`          | Bitta video ma’lumotlari                                         |
| `PATCH`  | `/api/videos/:id`          | Nomi/tasnifini va boshqa maydonlarni tahrirlash (JSON)            |
| `DELETE` | `/api/videos/:id`          | Videoni va fayllarini o‘chirish                                   |
| `POST`   | `/api/videos/:id/poster`   | Muqova rasmi (JPEG baytlari)                                      |
| `GET`    | `/api/config`              | `publicBaseUrl`, `maxUploadBytes`                                 |
| `GET`    | `/media/:id`               | Video oqimi (HTTP Range qo‘llanadi)                               |
| `GET`    | `/poster/:id`              | Muqova rasmi                                                      |
| `GET`    | `/v/:id`                   | Video sahifasi (QR-kodlarda ishlatiladigan qisqa havola)           |

Yuklash misoli:

```bash
META=$(printf '%s' '{"title":"Chortoq tumani, 12-kontur","description":"Izoh","district":"Chortoq tumani"}' | base64 -w0)
curl -X POST http://localhost:3000/api/videos \
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

## Xavfsizlik bo‘yicha eslatma

Saytda hozircha **avtorizatsiya yo‘q** — video yuklash va o‘chirish sahifaga kirgan
har bir foydalanuvchi uchun ochiq. Ommaviy tarmoqqa chiqarishdan oldin:

- yuklash/o‘chirish amallarini nginx darajasida parol (Basic Auth) yoki ichki tarmoq
  bilan cheklash;
- HTTPS o‘rnatish;
- `data/` papkasini muntazam zaxiralash tavsiya etiladi.
