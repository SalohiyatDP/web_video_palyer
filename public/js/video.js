/** Video sahifasi: player + videoga havola QR-kodi. */
import { apiRequest, escapeHtml, formatBytes, formatDate, formatDuration, videoPageUrl } from './util.js';
import { drawOnCanvas } from './qr.js';
import { icon } from './icons.js';

const notice = document.getElementById('notice');
const layout = document.getElementById('layout');
const player = document.getElementById('player');
const titleEl = document.getElementById('video-title');
const chipsEl = document.getElementById('video-chips');
const descEl = document.getElementById('video-description');
const detailsEl = document.getElementById('details');
const qrCanvas = document.getElementById('qr-canvas');
const qrLinkEl = document.getElementById('qr-link');
const qrStatus = document.getElementById('qr-status');
const footerId = document.getElementById('footer-id');

/** ID `/v/<id>` yoki `?id=<id>` shaklida keladi. */
function readId() {
  const fromPath = /^\/v\/([a-f0-9]{10})$/.exec(window.location.pathname);
  if (fromPath) return fromPath[1];
  const fromQuery = new URLSearchParams(window.location.search).get('id');
  return fromQuery && /^[a-f0-9]{10}$/.test(fromQuery) ? fromQuery : null;
}

function detailRow(label, value) {
  if (!value) return '';
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function setQrStatus(message, kind = '') {
  qrStatus.className = `status${kind ? ` status--${kind}` : ''}`;
  qrStatus.innerHTML = message ? `${kind === 'ok' ? icon('check') : ''} ${escapeHtml(message)}` : '';
  if (message) setTimeout(() => { qrStatus.innerHTML = ''; }, 2500);
}

async function main() {
  const id = readId();
  if (!id) {
    notice.textContent = 'Havola noto‘g‘ri — video aniqlanmadi.';
    return;
  }

  let video;
  try {
    ({ video } = await apiRequest(`/api/videos/${id}`));
  } catch (error) {
    notice.innerHTML = `${escapeHtml(error.message)} — <a href="/">ro‘yxatga qaytish</a>`;
    return;
  }

  // QR-kod tashqi manzilga ishora qilishi uchun server sozlamasi (ixtiyoriy).
  let publicBaseUrl = '';
  try {
    ({ publicBaseUrl } = await apiRequest('/api/config'));
  } catch { /* sozlama bo‘lmasa — joriy manzil ishlatiladi */ }

  document.title = `${video.title} — video arxiv`;
  notice.hidden = true;
  layout.hidden = false;
  footerId.textContent = `Video ID: ${video.id}`;

  // ------------------------------- Player -------------------------------
  player.src = `/media/${video.id}`;
  if (video.posterFile) player.poster = `/poster/${video.id}`;

  titleEl.textContent = video.title;
  descEl.textContent = video.description || 'Tasnif kiritilmagan.';
  if (!video.description) descEl.classList.add('muted');

  chipsEl.innerHTML = [
    video.district ? `<span class="chip">${icon('pin')} ${escapeHtml(video.district)}</span>` : '',
    video.area ? `<span class="chip">${icon('area')} ${escapeHtml(video.area)}</span>` : '',
    video.cadastre ? `<span class="chip chip--plain">${icon('hash')} ${escapeHtml(video.cadastre)}</span>` : '',
    video.durationSeconds ? `<span class="chip chip--plain">${icon('clock')} ${formatDuration(video.durationSeconds)}</span>` : '',
  ].join('');

  detailsEl.innerHTML = [
    detailRow('Tuman / shahar', video.district),
    detailRow('Maydoni', video.area),
    detailRow('Kadastr raqami', video.cadastre),
    detailRow('Joylashuvi / koordinata', video.location),
    detailRow('Davomiyligi', formatDuration(video.durationSeconds)),
    detailRow('Fayl hajmi', formatBytes(video.sizeBytes)),
    detailRow('Fayl nomi', video.originalName),
    detailRow('Yuklangan vaqti', formatDate(video.createdAt)),
  ].join('');

  // --------------------------------- QR ---------------------------------
  const link = videoPageUrl(video.id, publicBaseUrl);
  qrLinkEl.textContent = link;
  try {
    const info = drawOnCanvas(qrCanvas, link, { size: 264, margin: 4 });
    qrCanvas.title = `QR versiya ${info.version} (${info.size}×${info.size} modul)`;
    qrCanvas.dataset.qrVersion = String(info.version);
    qrCanvas.dataset.qrSize = String(info.size);
    qrCanvas.dataset.qrMargin = '4';
    qrCanvas.dataset.qrLink = link;
  } catch (error) {
    qrLinkEl.textContent = `QR-kod yaratilmadi: ${error.message}`;
  }

  document.getElementById('copy-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      setQrStatus('Havola nusxalandi', 'ok');
    } catch {
      window.prompt('Havolani nusxalab oling:', link);
    }
  });

  document.getElementById('download-btn').addEventListener('click', () => {
    // Chop etish uchun kattaroq QR tayyorlaymiz.
    const exportCanvas = document.createElement('canvas');
    drawOnCanvas(exportCanvas, link, { minSize: 1024, margin: 4 });
    exportCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeName = video.title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 60);
      anchor.href = url;
      anchor.download = `QR-${safeName || video.id}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
      setQrStatus('QR-kod yuklab olindi', 'ok');
    }, 'image/png');
  });

  document.getElementById('print-btn').addEventListener('click', () => window.print());
}

main();
