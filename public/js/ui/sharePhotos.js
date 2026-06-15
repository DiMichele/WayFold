/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import * as api from '../api.js';
import { esc, tripDest } from '../utils.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';
import { t } from '../i18n.js';

const MAX_NATIVE_FILES = 10;

function extFromUrl(url) {
  const m = String(url || '').match(/\.([a-z0-9]+)(?:\?|$)/i);
  const ext = m?.[1]?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext.replace('jpeg', 'jpg') : 'jpg';
}

function safeBaseName(trip) {
  return String(tripDest(trip) || 'wayfold')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'wayfold';
}

async function fetchPhotoBlob(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(t('sharePhotos.fetchFail'));
  return res.blob();
}

async function photoToFile(photo, trip, index) {
  const blob = await fetchPhotoBlob(photo.url);
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const ext = extFromUrl(photo.url);
  const name = `${safeBaseName(trip)}_${String(index + 1).padStart(2, '0')}.${ext}`;
  return new File([blob], name, { type });
}

export async function buildPhotoFiles(photos, trip, { onProgress } = {}) {
  const list = photos.filter(p => p.url);
  const files = [];
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i + 1, list.length);
    files.push(await photoToFile(list[i], trip, i));
  }
  return files;
}

export function canShareFiles(files) {
  if (!navigator.share || !files?.length) return false;
  try {
    return !navigator.canShare || navigator.canShare({ files });
  } catch {
    return false;
  }
}

function shareText(trip, count) {
  const dest = tripDest(trip);
  return count > 1
    ? t('sharePhotos.textAlbum', { dest, n: count })
    : t('sharePhotos.textSingle', { dest });
}

async function nativeShare(files, trip) {
  await navigator.share({
    files,
    title: tripDest(trip),
    text: shareText(trip, files.length),
  });
}

function downloadFiles(files) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

async function shareViaEmail(files, trip) {
  const subject = encodeURIComponent(t('sharePhotos.emailSubject', { dest: tripDest(trip) }));
  const body = encodeURIComponent(shareText(trip, files.length));
  if (canShareFiles(files)) {
    try {
      await nativeShare(files, trip);
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  downloadFiles(files);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function targetAction(id, files, trip) {
  switch (id) {
    case 'download':
      downloadFiles(files);
      showToast(t('sharePhotos.downloaded', { n: files.length }), 'neutral');
      return;
    case 'email':
      return shareViaEmail(files, trip);
    default:
      if (!canShareFiles(files)) {
        downloadFiles(files);
        showToast(t('sharePhotos.downloadFallback'), 'neutral');
        return;
      }
      return nativeShare(files, trip);
  }
}

const TARGETS = [
  {
    id: 'native',
    labelKey: 'sharePhotos.system',
    icon: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  },
  {
    id: 'instagram',
    labelKey: 'sharePhotos.instagram',
    icon: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  },
  {
    id: 'whatsapp',
    labelKey: 'sharePhotos.whatsapp',
    icon: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.9 7.1L3 21l2.6-5A8.4 8.4 0 1 1 21 11.5z"/></svg>',
  },
  {
    id: 'telegram',
    labelKey: 'sharePhotos.telegram',
    icon: '<svg viewBox="0 0 24 24"><path d="M22 3 2 11l7 3 2 7 4-5 5 5 2-18z"/></svg>',
  },
  {
    id: 'email',
    labelKey: 'sharePhotos.email',
    icon: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>',
  },
  {
    id: 'download',
    labelKey: 'sharePhotos.save',
    icon: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  },
];

function renderTargets(root, files, trip) {
  const grid = root.querySelector('#sharePhotosGrid');
  grid.innerHTML = '';
  TARGETS.forEach(target => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `share-photos-target share-photos-target--${target.id}`;
    btn.innerHTML = `
      <span class="share-photos-target-ico" aria-hidden="true">${target.icon}</span>
      <span class="share-photos-target-lbl">${esc(t(target.labelKey))}</span>`;
    btn.addEventListener('click', async () => {
      try {
        await targetAction(target.id, files, trip);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        showToast(err.message || t('sharePhotos.err'), 'error');
      }
    });
    grid.appendChild(btn);
  });
}

/**
 * @param {{ trip: object, photos: object[] }} opts
 */
export function openSharePhotosModal({ trip, photos }) {
  const list = (photos || []).filter(p => p.url);
  if (!list.length) {
    showToast(t('gal.noPhotos'), 'neutral');
    return;
  }

  const body = document.createElement('div');
  body.className = 'share-photos';
  body.innerHTML = `
    <p class="share-photos-hint" id="sharePhotosHint">${esc(t('sharePhotos.hint'))}</p>
    <div class="share-photos-status" id="sharePhotosStatus">${esc(t('sharePhotos.preparing'))}</div>
    <div class="share-photos-grid" id="sharePhotosGrid" hidden></div>
    <p class="share-photos-note" id="sharePhotosNote" hidden></p>`;

  openModal({
    title: list.length > 1
      ? t('sharePhotos.titleAlbum', { n: list.length })
      : t('sharePhotos.titleSingle'),
    body,
  });

  const status = body.querySelector('#sharePhotosStatus');
  const grid = body.querySelector('#sharePhotosGrid');
  const note = body.querySelector('#sharePhotosNote');

  (async () => {
    try {
      const toShare = list.slice(0, MAX_NATIVE_FILES);
      const files = await buildPhotoFiles(toShare, trip, (done, total) => {
        status.textContent = t('sharePhotos.preparingN', { done, total });
      });

      status.hidden = true;
      grid.hidden = false;
      renderTargets(body, files, trip);

      if (list.length > MAX_NATIVE_FILES) {
        note.hidden = false;
        note.textContent = t('sharePhotos.limitNote', { n: MAX_NATIVE_FILES, total: list.length });
      }
    } catch (err) {
      status.textContent = err.message || t('sharePhotos.err');
      status.classList.add('share-photos-status--err');
    }
  })();
}

/** Condividi tutte le foto di un album. */
export async function shareTripPhotos(trip) {
  let photos;
  try {
    photos = await api.fetchPhotos(trip.id, { fresh: true });
  } catch {
    showToast(t('sharePhotos.err'), 'error');
    return;
  }
  openSharePhotosModal({ trip, photos });
}

/** Condividi la foto corrente dal lightbox. */
export function shareLightboxPhoto(trip, photo) {
  openSharePhotosModal({ trip, photos: [photo] });
}
