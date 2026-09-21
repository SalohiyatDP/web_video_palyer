/** Bosh sahifa: video yuklash + yuklangan videolar ro‘yxati. */
import { apiRequest, escapeHtml, formatBytes, formatDate, formatDuration } from './util.js';
import { icon } from './icons.js';

const form = document.getElementById('upload-form');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('video-file');
const previewVideo = document.getElementById('preview-video');
const previewName = document.getElementById('preview-name');
const previewMeta = document.getElementById('preview-meta');
const submitBtn = document.getElementById('submit-btn');
const resetBtn = document.getElementById('reset-btn');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');
const grid = document.getElementById('video-grid');
const uploaderSection = document.getElementById('yuklash');
const publicNote = document.getElementById('public-note');
const addLink = document.getElementById('add-link');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginDialog = document.getElementById('login-dialog');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const loginSubmit = document.getElementById('login-submit');
const passwordInput = document.getElementById('password');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const searchInput = document.getElementById('search');
const refreshBtn = document.getElementById('refresh-btn');

let selectedFile = null;
let previewUrl = null;
let videos = [];
/** Administrator sifatida kirilganmi? Yuklash/o‘chirish faqat shunda ko‘rinadi. */
let isAdmin = false;

/* ---------------------------------------------------------------- *
 * Administrator kirishi
 * ---------------------------------------------------------------- */
function applyAdminState(admin) {
  isAdmin = admin;
  uploaderSection.hidden = !admin;
  addLink.hidden = !admin;
  logoutBtn.hidden = !admin;
  loginBtn.hidden = admin;
  publicNote.hidden = admin;
  render();
}

async function checkSession() {
  try {
    const { admin } = await apiRequest('/api/session');
    applyAdminState(Boolean(admin));
  } catch {
    applyAdminState(false);
  }
}

loginBtn.addEventListener('click', () => {
  loginStatus.textContent = '';
  passwordInput.value = '';
  loginDialog.showModal();
  passwordInput.focus();
});

document.getElementById('login-cancel').addEventListener('click', () => loginDialog.close());

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  if (!password) {
    loginStatus.className = 'status status--error';
    loginStatus.textContent = 'Parolni kiriting.';
    return;
  }
  loginSubmit.disabled = true;
  loginStatus.className = 'status';
  loginStatus.textContent = 'Tekshirilmoqda…';
  try {
    await apiRequest('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    loginDialog.close();
    applyAdminState(true);
    setStatus('Administrator sifatida kirdingiz — endi video yuklashingiz mumkin.', 'ok');
    uploaderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    loginStatus.className = 'status status--error';
    loginStatus.textContent = error.message;
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch { /* ahamiyatsiz */ }
  applyAdminState(false);
  setStatus('');
});

/* ---------------------------------------------------------------- *
 * Fayl tanlash
 * ---------------------------------------------------------------- */
function setStatus(message, kind = '') {
  statusEl.className = `status${kind ? ` status--${kind}` : ''}`;
  if (!message) {
    statusEl.textContent = '';
    return;
  }
  const mark = kind === 'ok' ? icon('check') : '';
  statusEl.innerHTML = `${mark} ${escapeHtml(message)}`;
}

function selectFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|webm|ogv|ogg|mov|mkv|m4v|avi|mpe?g|3gp)$/i.test(file.name)) {
    setStatus('Faqat video fayl yuklash mumkin.', 'error');
    return;
  }
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);

  previewVideo.src = previewUrl;
  previewName.textContent = file.name;
  previewMeta.textContent = formatBytes(file.size);
  dropzone.classList.add('has-file');
  setStatus('');

  previewVideo.onloadedmetadata = () => {
    const duration = formatDuration(previewVideo.duration);
    previewMeta.textContent = duration ? `${formatBytes(file.size)} · ${duration}` : formatBytes(file.size);
  };

  // Nom bo‘sh bo‘lsa — fayl nomidan taklif qilamiz.
  const titleInput = document.getElementById('title');
  if (!titleInput.value.trim()) {
    titleInput.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 200);
  }
}

fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
});
['dragleave', 'drop'].forEach((type) => {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-over');
  });
});
dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    // fileInput.files ni ham yangilaymiz (forma holati izchil bo‘lishi uchun)
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    selectFile(file);
  }
});

resetBtn.addEventListener('click', () => {
  selectedFile = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  previewVideo.removeAttribute('src');
  dropzone.classList.remove('has-file');
  setStatus('');
  progress.classList.remove('is-active');
  progressBar.style.width = '0';
});

/* ---------------------------------------------------------------- *
 * Poster (birinchi kadr) — brauzerda tayyorlanadi
 * ---------------------------------------------------------------- */
function captureFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), 12000);

    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;

    video.onloadeddata = () => {
      const target = Number.isFinite(video.duration) && video.duration > 2 ? 1 : 0;
      try {
        video.currentTime = target;
      } catch {
        /* seek qo‘llanmasa — hozirgi kadr olinadi */
      }
    };
    video.onseeked = draw;
    video.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };

    function draw() {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
          clearTimeout(timer);
          return finish(null);
        }
        const scale = Math.min(1, 640 / width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          clearTimeout(timer);
          finish(blob);
        }, 'image/jpeg', 0.72);
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    }
  });
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

/* ---------------------------------------------------------------- *
 * Yuklash
 *
 * Server sozlamasiga qarab ikki usul:
 *  - `single`  (Node serveri) — fayl bitta so‘rovda yuboriladi;
 *  - `chunked` (PHP varianti) — fayl bo‘laklab yuboriladi, chunki oddiy
 *    hostinglarda bitta so‘rov hajmi 8 MB atrofida cheklangan bo‘ladi.
 * ---------------------------------------------------------------- */
let serverConfig = { uploadMode: 'single', chunkBytes: 4 * 1024 * 1024 };
let configPromise = null;

/** Server sozlamasini bir marta o‘qiydi (keyingi chaqiruvlar shu natijani kutadi). */
function ensureServerConfig() {
  configPromise ??= (async () => {
    try {
      serverConfig = { ...serverConfig, ...(await apiRequest('/api/config')) };
    } catch { /* sozlama olinmasa — standart usul */ }
  })();
  return configPromise;
}

function showProgress(loaded, total) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  progressBar.style.width = `${percent}%`;
  setStatus(`Yuklanmoqda… ${percent}%`);
}

/** Bo‘laklab yuklash: har bir bo‘lak alohida so‘rovda yuboriladi. */
async function uploadInChunks(file, meta) {
  const { uploadId } = await apiRequest('/api/uploads', { method: 'POST' });
  const chunkSize = Math.max(256 * 1024, Number(serverConfig.chunkBytes) || 4 * 1024 * 1024);
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + chunkSize);
    let response;
    let lastError;
    // Tarmoq uzilishlariga chidamli bo‘lishi uchun 3 martagacha qayta urinamiz
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(`/api/uploads/${uploadId}?offset=${offset}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: chunk,
        });
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
    if (!response) throw new Error(`Tarmoq xatosi: ${lastError?.message || 'yuklash uzildi'}`);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      // Server qayerdan davom etish kerakligini aytsa — shu joydan davom etamiz
      if (response.status === 409 && Number.isFinite(payload.expectedOffset)) {
        offset = payload.expectedOffset;
        continue;
      }
      throw new Error(payload.error || `Yuklashda xatolik (${response.status})`);
    }

    const { received } = await response.json().catch(() => ({}));
    offset = Number.isFinite(received) ? received : offset + chunk.size;
    showProgress(offset, file.size);
  }

  const { video } = await apiRequest(`/api/uploads/${uploadId}/finish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...meta, mimeType: file.type || '' }),
  });
  return video;
}

function uploadVideo(file, meta) {
  if (serverConfig.uploadMode === 'chunked') return uploadInChunks(file, meta);
  return uploadInOneRequest(file, meta);
}

function uploadInOneRequest(file, meta) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    // Kirill/lotin matnlar sarlavhada xavfsiz uzatilishi uchun base64
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(meta))));
    xhr.setRequestHeader('x-video-meta', encoded);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) showProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch { /* bo‘sh javob */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload.video);
      else reject(new Error(payload?.error || `Yuklashda xatolik (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Tarmoq xatosi — yuklash bajarilmadi'));
    xhr.send(file);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.getElementById('title').value.trim();

  if (!selectedFile) return setStatus('Avval video faylni tanlang.', 'error');
  if (!title) return setStatus('Video nomini kiriting.', 'error');

  submitBtn.disabled = true;
  progress.classList.add('is-active');
  progressBar.style.width = '0';
  setStatus('Video tahlil qilinmoqda…');

  try {
    await ensureServerConfig();
    const durationSeconds = await probeDuration(selectedFile);
    const meta = {
      title,
      description: document.getElementById('description').value.trim(),
      district: document.getElementById('district').value.trim(),
      area: document.getElementById('area').value.trim(),
      cadastre: document.getElementById('cadastre').value.trim(),
      location: document.getElementById('location').value.trim(),
      originalName: selectedFile.name,
      durationSeconds,
    };

    const video = await uploadVideo(selectedFile, meta);

    setStatus('Muqova rasmi tayyorlanmoqda…');
    const poster = await captureFrame(selectedFile);
    if (poster) {
      try {
        await fetch(`/api/videos/${video.id}/poster`, {
          method: 'POST',
          headers: { 'content-type': 'image/jpeg' },
          body: poster,
        });
      } catch { /* muqova majburiy emas */ }
    }

    setStatus('Video saqlandi va QR-kod tayyor.', 'ok');
    progressBar.style.width = '100%';
    form.reset();
    resetBtn.click();
    setStatus('Video saqlandi. QR-kodni ko‘rish uchun videoni oching.', 'ok');
    await loadVideos();
  } catch (error) {
    setStatus(error.message, 'error');
    // Sessiya tugagan bo‘lsa — qaytadan kirish kerak
    if (/administrator/i.test(error.message)) applyAdminState(false);
  } finally {
    submitBtn.disabled = false;
    setTimeout(() => progress.classList.remove('is-active'), 1200);
  }
});

/* ---------------------------------------------------------------- *
 * Ro‘yxat
 * ---------------------------------------------------------------- */
function cardHtml(video) {
  const href = `/v/${video.id}`;
  const poster = video.posterFile
    ? `<img src="/poster/${video.id}" alt="" loading="lazy" />`
    : '';
  const duration = formatDuration(video.durationSeconds);
  const chips = [
    video.district ? `<span class="chip">${icon('pin')} ${escapeHtml(video.district)}</span>` : '',
    video.area ? `<span class="chip">${icon('area')} ${escapeHtml(video.area)}</span>` : '',
    video.cadastre ? `<span class="chip chip--plain">${icon('hash')} ${escapeHtml(video.cadastre)}</span>` : '',
  ].join('');

  return `
    <article class="video-card">
      <a class="video-card__thumb" href="${href}" aria-label="${escapeHtml(video.title)}">
        ${poster}
        <span class="video-card__play" aria-hidden="true">${icon('play-circle')}</span>
        ${duration ? `<span class="video-card__duration">${duration}</span>` : ''}
      </a>
      <div class="video-card__body">
        <h3 class="video-card__title"><a href="${href}">${escapeHtml(video.title)}</a></h3>
        ${video.description ? `<p class="video-card__desc">${escapeHtml(video.description)}</p>` : ''}
        <div class="video-card__tags">${chips}</div>
        <div class="muted" style="font-size:12.5px">
          ${formatDate(video.createdAt)} · ${formatBytes(video.sizeBytes)}
        </div>
        <div class="video-card__actions">
          <a class="btn btn--sm" href="${href}">${icon('play')} Ko‘rish</a>
          <a class="btn btn--outline btn--sm" href="${href}#qr">${icon('qr')} QR-kod</a>
          ${isAdmin ? `<button class="btn btn--danger btn--sm btn--icon" type="button" data-delete="${video.id}"
                  title="Videoni o‘chirish" aria-label="Videoni o‘chirish">${icon('trash')}</button>` : ''}
        </div>
      </div>
    </article>`;
}

function render() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = query
    ? videos.filter((video) =>
        [video.title, video.description, video.district, video.cadastre, video.location, video.area]
          .join(' ')
          .toLowerCase()
          .includes(query))
    : videos;

  grid.innerHTML = filtered.map(cardHtml).join('');
  const hasAny = videos.length > 0;
  emptyEl.hidden = hasAny;
  if (hasAny && filtered.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      ${icon('search', 'ico ico--xl')}
      <span>«${escapeHtml(searchInput.value.trim())}» bo‘yicha video topilmadi.</span></div>`;
  }
  countEl.textContent = hasAny
    ? `${filtered.length} ta video${filtered.length !== videos.length ? ` (jami ${videos.length})` : ''}`
    : '';
}

async function loadVideos() {
  try {
    const payload = await apiRequest('/api/videos');
    videos = payload.videos || [];
    render();
  } catch (error) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Ro‘yxatni yuklab bo‘lmadi: ${escapeHtml(error.message)}</div>`;
  }
}

grid.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  const id = button.dataset.delete;
  const video = videos.find((item) => item.id === id);
  if (!window.confirm(`«${video?.title ?? id}» videosi butunlay o‘chiriladi. Davom etamizmi?`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/videos/${id}`, { method: 'DELETE' });
    await loadVideos();
  } catch (error) {
    button.disabled = false;
    window.alert(`O‘chirishda xatolik: ${error.message}`);
    if (/administrator/i.test(error.message)) applyAdminState(false);
  }
});

searchInput.addEventListener('input', render);
refreshBtn.addEventListener('click', loadVideos);

ensureServerConfig();
checkSession();
loadVideos();
