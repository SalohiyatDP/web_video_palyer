import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 soat
const MAX_FAILED_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 daqiqa

/** `Cookie` sarlavhasini oddiy obyektga aylantiradi. */
export function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name) result[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

/** Uzunliklari farq qilsa ham xavfsiz (vaqt bo‘yicha barqaror) solishtirish. */
function safeEqual(a, b) {
  const first = crypto.createHash('sha256').update(String(a)).digest();
  const second = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(first, second);
}

/**
 * Administrator sessiyalarini boshqaradi: parolni tekshirish, imzolangan
 * cookie yaratish va urinishlarni cheklash (brute-force’ga qarshi).
 */
export async function createAuth({ dataDir, password }) {
  const secretFile = path.join(dataDir, 'session.key');
  let secret;
  try {
    secret = (await fs.readFile(secretFile, 'utf8')).trim();
    if (secret.length < 32) throw new Error('kalit juda qisqa');
  } catch {
    secret = crypto.randomBytes(32).toString('hex');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(secretFile, secret, { mode: 0o600 });
  }

  /** IP bo‘yicha muvaffaqiyatsiz urinishlar hisobi. */
  const attempts = new Map();

  function attemptKey(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
  }

  function tooManyAttempts(req) {
    const entry = attempts.get(attemptKey(req));
    if (!entry) return false;
    if (Date.now() > entry.resetAt) {
      attempts.delete(attemptKey(req));
      return false;
    }
    return entry.count >= MAX_FAILED_ATTEMPTS;
  }

  function registerFailure(req) {
    const key = attemptKey(req);
    const entry = attempts.get(key);
    if (!entry || Date.now() > entry.resetAt) {
      attempts.set(key, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    } else {
      entry.count++;
    }
    // Eski yozuvlarni tozalab turamiz
    if (attempts.size > 500) {
      for (const [key2, value] of attempts) {
        if (Date.now() > value.resetAt) attempts.delete(key2);
      }
    }
  }

  function sign(expiresAt) {
    return crypto.createHmac('sha256', secret).update(String(expiresAt)).digest('hex');
  }

  function createToken() {
    const expiresAt = Date.now() + SESSION_TTL_MS;
    return `${expiresAt}.${sign(expiresAt)}`;
  }

  function isValidToken(token) {
    const [rawExpiry, signature] = String(token || '').split('.');
    const expiresAt = Number(rawExpiry);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
    const expected = sign(expiresAt);
    if (!signature || signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  /** Reverse proxy ortida HTTPS ishlatilsa — cookie `Secure` bo‘ladi. */
  function isSecureRequest(req) {
    if (req.socket.encrypted) return true;
    return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  }

  function cookieHeader(value, req, maxAgeSeconds) {
    const parts = [
      `${COOKIE_NAME}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
    ];
    if (isSecureRequest(req)) parts.push('Secure');
    return parts.join('; ');
  }

  return {
    cookieName: COOKIE_NAME,

    /** So‘rov administrator sessiyasi bilan kelganini tekshiradi. */
    isAdmin(req) {
      return isValidToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
    },

    /**
     * Parolni tekshirib, sessiya cookie’sini qaytaradi.
     * @returns {{ok: true, setCookie: string} | {ok: false, status: number, error: string}}
     */
    login(req, candidate) {
      if (tooManyAttempts(req)) {
        return { ok: false, status: 429, error: 'Juda ko‘p urinish. 15 daqiqadan so‘ng qayta harakat qiling.' };
      }
      if (!candidate || !safeEqual(candidate, password)) {
        registerFailure(req);
        return { ok: false, status: 401, error: 'Parol noto‘g‘ri.' };
      }
      attempts.delete(attemptKey(req));
      return { ok: true, setCookie: cookieHeader(createToken(), req, Math.floor(SESSION_TTL_MS / 1000)) };
    },

    logoutCookie(req) {
      return cookieHeader('', req, 0);
    },
  };
}
