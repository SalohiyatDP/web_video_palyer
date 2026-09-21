#!/usr/bin/env node
/**
 * «Наманган туристик-рекреацион ҳудудларини ривожлантириш дирекцияси» —
 * yer maydonlari videolari uchun oddiy video-player sayti.
 *
 * Tashqi kutubxonalarsiz (faqat Node.js standart modullari) ishlaydi.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { createAuth } from './lib/auth.js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const POSTER_DIR = path.join(DATA_DIR, 'posters');
const CATALOG_FILE = path.join(DATA_DIR, 'videos.json');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 512 * 1024 * 1024); // 512 MB
/**
 * QR-kodlar uchun tashqi manzil (masalan: https://video.namangan.uz).
 * Berilmasa — brauzerdagi manzil ishlatiladi.
 */
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const MAX_POSTER_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Administrator paroli. Videolarni yuklash va o‘chirish faqat shu parol bilan
 * kirgan foydalanuvchiga ruxsat etiladi; videolarni ko‘rish hammaga ochiq.
 * Parol berilmasa — tasodifiy parol yaratiladi va konsolga chiqariladi.
 */
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim()
  || crypto.randomBytes(6).toString('base64url');
const PASSWORD_WAS_GENERATED = !String(process.env.ADMIN_PASSWORD || '').trim();

const store = createStore(CATALOG_FILE);
let auth;

/* ------------------------------------------------------------------ *
 * Yordamchi funksiyalar
 * ------------------------------------------------------------------ */
const STATIC_MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const VIDEO_MIME_EXT = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/ogg', '.ogv'],
  ['video/quicktime', '.mov'],
  ['video/x-matroska', '.mkv'],
  ['video/x-m4v', '.m4v'],
  ['video/mpeg', '.mpeg'],
  ['video/3gpp', '.3gp'],
  ['video/x-msvideo', '.avi'],
]);

const EXT_VIDEO_MIME = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/x-m4v'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.ogg', 'video/ogg'],
  ['.mov', 'video/quicktime'],
  ['.mkv', 'video/x-matroska'],
  ['.mpeg', 'video/mpeg'],
  ['.mpg', 'video/mpeg'],
  ['.3gp', 'video/3gpp'],
  ['.avi', 'video/x-msvideo'],
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

function newId() {
  return crypto.randomBytes(5).toString('hex'); // 10 belgi — QR uchun qisqa
}

function clampText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function clampMultiline(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

/** `x-video-meta` sarlavhasi: base64(JSON) — kirill/lotin matnlar uchun xavfsiz. */
function parseMetaHeader(header) {
  if (!header) throw new Error('Video maʼlumotlari (x-video-meta) yuborilmadi');
  let json;
  try {
    json = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
  } catch {
    throw new Error('Video maʼlumotlarini oʻqish imkoni boʻlmadi');
  }
  const title = clampText(json.title, 200);
  if (!title) throw new Error('Video nomi kiritilishi shart');
  return {
    title,
    description: clampMultiline(json.description, 4000),
    district: clampText(json.district, 120),
    cadastre: clampText(json.cadastre, 120),
    area: clampText(json.area, 60),
    location: clampText(json.location, 200),
    originalName: clampText(json.originalName, 260),
    durationSeconds: Number.isFinite(json.durationSeconds) ? Math.round(json.durationSeconds) : null,
  };
}

function pickExtension(contentType, originalName) {
  const fromName = path.extname(String(originalName || '')).toLowerCase();
  if (EXT_VIDEO_MIME.has(fromName)) return fromName;
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  return VIDEO_MIME_EXT.get(base) || '.mp4';
}

/* ------------------------------------------------------------------ *
 * Statik fayllar
 * ------------------------------------------------------------------ */
async function serveFile(req, res, filePath, { cacheControl = 'no-cache', contentType } = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendText(res, 404, '404 — fayl topilmadi');
  }
  if (!stat.isFile()) return sendText(res, 404, '404 — fayl topilmadi');

  const type = contentType || STATIC_MIME.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': cacheControl });
    return res.end();
  }

  const headers = {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': cacheControl,
    etag,
    'last-modified': stat.mtime.toUTCString(),
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** Range-ni qoʻllab-quvvatlaydigan video oqimi (seek/ixtiyoriy joydan koʻrish uchun). */
async function serveMedia(req, res, filePath, contentType) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendText(res, 404, '404 — video fayl topilmadi');
  }

  const range = req.headers.range;
  const baseHeaders = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
    'last-modified': stat.mtime.toUTCString(),
  };

  if (!range) {
    const headers = { ...baseHeaders, 'content-length': stat.size };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
    return res.end();
  }

  let start;
  let end;
  if (match[1] === '') {
    // oxiridan N bayt
    const suffixLength = Number(match[2]);
    start = Math.max(0, stat.size - suffixLength);
    end = stat.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
    res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
    return res.end();
  }

  const headers = {
    ...baseHeaders,
    'content-range': `bytes ${start}-${end}/${stat.size}`,
    'content-length': end - start + 1,
  };
  if (req.method === 'HEAD') {
    res.writeHead(206, headers);
    return res.end();
  }
  res.writeHead(206, headers);
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/* ------------------------------------------------------------------ *
 * Yuklash (upload)
 * ------------------------------------------------------------------ */
function receiveToFile(req, filePath, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let aborted = false;
    const out = fs.createWriteStream(filePath);

    const fail = (error) => {
      if (aborted) return;
      aborted = true;
      req.unpipe(out);
      out.destroy();
      fsp.rm(filePath, { force: true }).finally(() => reject(error));
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        const error = new Error(`Fayl hajmi chegaradan oshdi (${Math.round(maxBytes / 1024 / 1024)} MB)`);
        error.statusCode = 413;
        fail(error);
      }
    });
    req.on('aborted', () => fail(new Error('Yuklash uzildi')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (!aborted) resolve(received);
    });
    req.pipe(out);
  });
}

function receiveBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        const error = new Error('Fayl hajmi chegaradan oshdi');
        error.statusCode = 413;
        req.destroy();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleUpload(req, res) {
  const meta = parseMetaHeader(req.headers['x-video-meta']);
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    const error = new Error(`Fayl hajmi chegaradan oshdi (${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
    error.statusCode = 413;
    throw error;
  }

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const extension = pickExtension(contentType, meta.originalName);
  const id = newId();
  const fileName = `${id}${extension}`;
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = path.join(UPLOAD_DIR, fileName);

  const size = await receiveToFile(req, filePath, MAX_UPLOAD_BYTES);
  if (size === 0) {
    await fsp.rm(filePath, { force: true });
    const error = new Error('Bo\u2018sh fayl yuborildi');
    error.statusCode = 400;
    throw error;
  }

  const record = {
    id,
    ...meta,
    fileName,
    mimeType: EXT_VIDEO_MIME.get(extension) || contentType || 'video/mp4',
    sizeBytes: size,
    posterFile: null,
    createdAt: new Date().toISOString(),
  };
  await store.add(record);
  sendJson(res, 201, { video: record });
}

async function handlePosterUpload(req, res, id) {
  const video = await store.get(id);
  if (!video) return sendJson(res, 404, { error: 'Video topilmadi' });
  const buffer = await receiveBuffer(req, MAX_POSTER_BYTES);
  if (buffer.length === 0) return sendJson(res, 400, { error: 'Bo\u2018sh rasm' });

  await fsp.mkdir(POSTER_DIR, { recursive: true });
  const posterFile = `${id}.jpg`;
  await fsp.writeFile(path.join(POSTER_DIR, posterFile), buffer);
  const updated = await store.update(id, { posterFile });
  sendJson(res, 200, { video: updated });
}

async function handleDelete(res, id) {
  const removed = await store.remove(id);
  if (!removed) return sendJson(res, 404, { error: 'Video topilmadi' });
  await fsp.rm(path.join(UPLOAD_DIR, removed.fileName), { force: true });
  if (removed.posterFile) await fsp.rm(path.join(POSTER_DIR, removed.posterFile), { force: true });
  sendJson(res, 200, { deleted: removed.id });
}

async function handleMetaUpdate(req, res, id) {
  const existing = await store.get(id);
  if (!existing) return sendJson(res, 404, { error: 'Video topilmadi' });
  const raw = await receiveBuffer(req, 64 * 1024);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return sendJson(res, 400, { error: 'JSON noto\u2018g\u2018ri' });
  }
  const patch = {};
  if (payload.title !== undefined) {
    const title = clampText(payload.title, 200);
    if (!title) return sendJson(res, 400, { error: 'Video nomi bo\u2018sh bo\u2018lishi mumkin emas' });
    patch.title = title;
  }
  if (payload.description !== undefined) patch.description = clampMultiline(payload.description, 4000);
  if (payload.district !== undefined) patch.district = clampText(payload.district, 120);
  if (payload.cadastre !== undefined) patch.cadastre = clampText(payload.cadastre, 120);
  if (payload.area !== undefined) patch.area = clampText(payload.area, 60);
  if (payload.location !== undefined) patch.location = clampText(payload.location, 200);

  const updated = await store.update(id, patch);
  sendJson(res, 200, { video: updated });
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */
const ID_PATTERN = /^[a-f0-9]{10}$/;
const ADMIN_REQUIRED = 'Bu amal uchun administrator sifatida kirish kerak.';

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';

  // --- API: hammaga ochiq ---
  if (pathname === '/api/config' && method === 'GET') {
    return sendJson(res, 200, {
      publicBaseUrl: PUBLIC_BASE_URL,
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  }
  if (pathname === '/api/session' && method === 'GET') {
    return sendJson(res, 200, { admin: auth.isAdmin(req) });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const raw = await receiveBuffer(req, 4 * 1024);
    let payload = {};
    try {
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'JSON noto\u2018g\u2018ri' });
    }
    const result = auth.login(req, String(payload.password || ''));
    if (!result.ok) return sendJson(res, result.status, { error: result.error });
    res.setHeader('set-cookie', result.setCookie);
    return sendJson(res, 200, { admin: true });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    res.setHeader('set-cookie', auth.logoutCookie(req));
    return sendJson(res, 200, { admin: false });
  }
  if (pathname === '/api/videos' && method === 'GET') {
    return sendJson(res, 200, { videos: await store.list() });
  }

  // --- API: faqat administrator uchun ---
  if (pathname === '/api/videos' && method === 'POST') {
    if (!auth.isAdmin(req)) return sendJson(res, 401, { error: ADMIN_REQUIRED });
    return handleUpload(req, res);
  }

  const apiMatch = /^\/api\/videos\/([^/]+)(\/poster)?$/.exec(pathname);
  if (apiMatch) {
    const id = apiMatch[1];
    if (!ID_PATTERN.test(id)) return sendJson(res, 400, { error: 'ID noto\u2018g\u2018ri' });
    // O‘qish hammaga ochiq
    if (!apiMatch[2] && method === 'GET') {
      const video = await store.get(id);
      return video ? sendJson(res, 200, { video }) : sendJson(res, 404, { error: 'Video topilmadi' });
    }
    // O‘zgartiradigan amallar — faqat administrator
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && !auth.isAdmin(req)) {
      return sendJson(res, 401, { error: ADMIN_REQUIRED });
    }
    if (apiMatch[2] === '/poster' && method === 'POST') return handlePosterUpload(req, res, id);
    if (!apiMatch[2] && (method === 'PATCH' || method === 'PUT')) return handleMetaUpdate(req, res, id);
    if (!apiMatch[2] && method === 'DELETE') return handleDelete(res, id);
    return sendJson(res, 405, { error: 'Bu metod qo\u2018llanmaydi' });
  }

  // --- Media ---
  const mediaMatch = /^\/media\/([^/]+)$/.exec(pathname);
  if (mediaMatch && (method === 'GET' || method === 'HEAD')) {
    const id = mediaMatch[1].replace(/\.[a-z0-9]+$/i, '');
    if (!ID_PATTERN.test(id)) return sendText(res, 400, 'ID noto\u2018g\u2018ri');
    const video = await store.get(id);
    if (!video) return sendText(res, 404, '404 — video topilmadi');
    return serveMedia(req, res, path.join(UPLOAD_DIR, video.fileName), video.mimeType || 'video/mp4');
  }

  const posterMatch = /^\/poster\/([^/]+)$/.exec(pathname);
  if (posterMatch && (method === 'GET' || method === 'HEAD')) {
    const id = posterMatch[1].replace(/\.[a-z0-9]+$/i, '');
    if (!ID_PATTERN.test(id)) return sendText(res, 400, 'ID noto\u2018g\u2018ri');
    const video = await store.get(id);
    if (!video?.posterFile) return sendText(res, 404, '404 — rasm topilmadi');
    return serveFile(req, res, path.join(POSTER_DIR, video.posterFile), {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=3600',
    });
  }

  // --- Sahifalar ---
  if (method === 'GET' || method === 'HEAD') {
    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
    }
    // QR uchun qisqa havola: /v/<id>
    const shortMatch = /^\/v\/([^/]+)$/.exec(pathname);
    if (shortMatch) {
      return serveFile(req, res, path.join(PUBLIC_DIR, 'video.html'));
    }
    if (pathname === '/video.html') {
      return serveFile(req, res, path.join(PUBLIC_DIR, 'video.html'));
    }

    const requested = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!requested.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, '403 — ruxsat yo\u2018q');
    return serveFile(req, res, requested, {
      cacheControl: pathname.startsWith('/js/') || pathname.startsWith('/css/') ? 'no-cache' : 'public, max-age=600',
    });
  }

  return sendText(res, 404, '404 — sahifa topilmadi');
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[xato]', req.method, req.url, error);
    if (res.headersSent) return res.destroy();
    sendJson(res, status, { error: error.message || 'Serverda xatolik' });
  });
});

server.requestTimeout = 0; // katta video yuklashlar uzilib qolmasligi uchun
server.headersTimeout = 60_000;

async function main() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(POSTER_DIR, { recursive: true });
  auth = await createAuth({ dataDir: DATA_DIR, password: ADMIN_PASSWORD });

  server.listen(PORT, HOST, () => {
    console.log(`▶ Sayt ishga tushdi:  http://localhost:${PORT}`);
    console.log(`  Maʼlumotlar papkasi: ${DATA_DIR}`);
    console.log(`  Maksimal video hajmi: ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
    console.log(`  QR manzili: ${PUBLIC_BASE_URL || '(brauzerdagi joriy manzil)'}`);
    console.log('  Videolarni koʻrish — hammaga ochiq; yuklash va oʻchirish — parol bilan.');
    if (PASSWORD_WAS_GENERATED) {
      const line = '  ' + '─'.repeat(62);
      console.log('');
      console.log(line);
      console.log(`  Administrator paroli: ${ADMIN_PASSWORD}`);
      console.log('  (tasodifiy yaratildi — doimiy parol uchun ADMIN_PASSWORD');
      console.log('   muhit oʻzgaruvchisini sozlang)');
      console.log(line);
    }
  });
}

main();
