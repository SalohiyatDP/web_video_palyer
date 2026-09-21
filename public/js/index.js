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
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const searchInput = document.getElementById('search');
const refreshBtn = document.getElementById('refresh-btn');

let selectedFile = null;
let previewUrl = null;
let videos = [];

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
 * Yuklash (XHR — progress ko‘rsatish uchun)
 * ---------------------------------------------------------------- */
function uploadVideo(file, meta) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    // Kirill/lotin matnlar sarlavhada xavfsiz uzatilishi uchun base64
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(meta))));
    xhr.setRequestHeader('x-video-meta', encoded);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = `${percent}%`;
      setStatus(`Yuklanmoqda… ${percent}%`);
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
          <button class="btn btn--danger btn--sm btn--icon" type="button" data-delete="${video.id}"
                  title="Videoni o‘chirish" aria-label="Videoni o‘chirish">${icon('trash')}</button>
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
  }
});

searchInput.addEventListener('input', render);
refreshBtn.addEventListener('click', loadVideos);

loadVideos();
