/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { esc, tripDest } from '../utils.js';
import { showToast } from './toast.js';
import { closeModal } from './modal.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';
import { fetchMe } from '../api.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** Limite conservativo per share nativo di un singolo file (Chrome/Android). */
const MAX_SINGLE_SHARE_BYTES = 15 * 1024 * 1024;
const MAX_ZIP_SHARE_BYTES = 50 * 1024 * 1024;

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

async function ensureSession() {
  try {
    await fetchMe();
  } catch (err) {
    if (err.status === 401) throw new Error(t('sharePhotos.sessionExpired'));
    throw new Error(t('sharePhotos.fetchFail'));
  }
}

function pathsMatch(a, b) {
  try {
    return new URL(a, window.location.origin).pathname
      === new URL(b, window.location.origin).pathname;
  } catch {
    return a === b;
  }
}

/** True se l'img è già decodificata con successo (niente attese: lazy load o 401 bloccherebbero la share). */
function imgReady(img) {
  return img.complete && img.naturalWidth > 0;
}

/** Riutilizza immagini già caricate in galleria/lightbox (evita un fetch quando possibile). */
async function blobFromGalleryImage(url) {
  const sel = '#lbImg, .gal-grid img, .gal-hthumb img';
  for (const img of document.querySelectorAll(sel)) {
    const src = img.currentSrc || img.src;
    if (!src || !pathsMatch(src, url)) continue;
    if (!imgReady(img)) continue;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (blob?.size) return blob;
    } catch {
      /* canvas tainted */
    }
  }
  return null;
}

function canProgrammaticDownload() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !ios;
}

/** Web Share con file ha senso solo su mobile; su desktop Windows spesso dà NotAllowedError. */
function isMobileShareDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function fetchPhotoBlobUrl(url) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status >= 500 && attempt < maxAttempts - 1) continue;
    if (res.status === 401) throw new Error(t('sharePhotos.sessionExpired'));
    if (res.status === 403) throw new Error(t('sharePhotos.emailRequired'));
    if (!res.ok) throw new Error(t('sharePhotos.fetchFail'));
    const blob = await res.blob();
    if (!blob.size) throw new Error(t('sharePhotos.fetchFail'));
    const ct = res.headers.get('content-type') || blob.type || '';
    if (ct.includes('application/json')) throw new Error(t('sharePhotos.fetchFail'));
    return blob;
  }
  throw new Error(t('sharePhotos.fetchFail'));
}

async function fetchPhotoBlob(photo) {
  const url = photo?.url;
  if (url) {
    const fromDom = await blobFromGalleryImage(url);
    if (fromDom) return fromDom;
  }

  const candidates = [];
  if (url) candidates.push(url);
  if (photo?.id) candidates.push(`/api/photos/${photo.id}/file`);

  let lastErr;
  for (const candidate of candidates) {
    try {
      return await fetchPhotoBlobUrl(candidate);
    } catch (err) {
      lastErr = err;
      if (err.message === t('sharePhotos.sessionExpired')) {
        try {
          await fetchMe();
          return await fetchPhotoBlobUrl(candidate);
        } catch {
          throw err;
        }
      }
    }
  }

  throw lastErr || new Error(t('sharePhotos.fetchFail'));
}

async function photoToFile(photo, trip, index) {
  const blob = await fetchPhotoBlob(photo);
  const ext = extFromUrl(photo.url);
  const type = blob.type?.startsWith('image/') ? blob.type : (MIME_BY_EXT[ext] || 'image/jpeg');
  const name = `${safeBaseName(trip)}_${String(index + 1).padStart(2, '0')}.${ext}`;
  return new File([blob], name, { type, lastModified: Date.now() });
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

async function buildZipFile(files, trip) {
  const entries = {};
  for (const file of files) {
    entries[file.name] = new Uint8Array(await file.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  const zipName = `${safeBaseName(trip)}.zip`;
  return new File([zipped], zipName, { type: 'application/zip', lastModified: Date.now() });
}

/** True se il dispositivo può condividere nativamente questi file. */
function canShareFiles(files) {
  if (!navigator.share || !files?.length) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Sceglie il formato migliore: singola immagine o ZIP (mai multi-immagine nativo).
 * canShare() su più file è inaffidabile: spesso accetta e poi share() fallisce con "too large".
 * @returns {Promise<{ shareFiles: File[], downloadFiles: File[], mode: 'single'|'zip'|'download-only' }>}
 */
async function prepareShareBundle(files, trip) {
  if (!files.length) {
    return { shareFiles: [], downloadFiles: [], mode: 'download-only' };
  }

  if (files.length === 1) {
    const file = files[0];
    const shareFiles = (file.size <= MAX_SINGLE_SHARE_BYTES && canShareFiles([file])) ? [file] : [];
    return { shareFiles, downloadFiles: [file], mode: 'single' };
  }

  const zipFile = await buildZipFile(files, trip);
  const zipShareOk = zipFile.size <= MAX_ZIP_SHARE_BYTES && canShareFiles([zipFile]);

  if (zipShareOk) {
    return { shareFiles: [zipFile], downloadFiles: [zipFile], mode: 'zip' };
  }

  return { shareFiles: [], downloadFiles: [zipFile], mode: 'download-only' };
}

function downloadFiles(files) {
  const file = files[0];
  if (!file) return;
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

function shareErrorMessage(err) {
  const raw = String(err?.message || err?.name || 'Error');
  if (/too large/i.test(raw)) return t('sharePhotos.tooLarge');
  return `${t('sharePhotos.err')} (${err?.name || raw})`;
}

/**
 * Apre il foglio di condivisione nativo (Windows / iOS / Android).
 * Nessun fallback al download: per salvare si usa il pulsante «Salva».
 */
function shareNatively(shareFiles) {
  if (!navigator.share) {
    showToast(t('sharePhotos.noWebShare'), 'error');
    return;
  }
  if (navigator.canShare && !navigator.canShare({ files: shareFiles })) {
    showToast(t('sharePhotos.cantShareFiles', { n: shareFiles.length }), 'error');
    return;
  }

  let result;
  try {
    result = navigator.share({ files: shareFiles });
  } catch (err) {
    showToast(shareErrorMessage(err), 'error');
    return;
  }

  Promise.resolve(result)
    .then(() => closeModal())
    .catch(err => {
      if (err?.name === 'AbortError') return;
      showToast(shareErrorMessage(err), 'error');
    });
}

function handleShareClick(targetId, bundle) {
  const { shareFiles, downloadFiles: dlFiles, mode } = bundle;

  if (targetId === 'download') {
    const filesToSave = dlFiles.length ? dlFiles : shareFiles;
    if (!canProgrammaticDownload() && filesToSave.length && navigator.share) {
      shareNatively(filesToSave);
      return;
    }
    closeModal();
    downloadFiles(dlFiles);
    if (mode === 'zip' || dlFiles[0]?.name?.endsWith('.zip')) {
      showToast(t('sharePhotos.downloadedZip'), 'neutral');
    } else {
      showToast(t('sharePhotos.downloaded', { n: dlFiles.length }), 'neutral');
    }
    return;
  }

  if (!shareFiles.length) {
    showToast(t('sharePhotos.noWebShare'), 'error');
    return;
  }

  shareNatively(shareFiles);
}

const TARGETS = [
  {
    id: 'download',
    labelKey: 'sharePhotos.save',
    icon: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  },
  {
    id: 'native',
    labelKey: 'sharePhotos.system',
    icon: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  },
];

function renderTargets(root, bundle) {
  const grid = root.querySelector('#sharePhotosGrid');
  grid.innerHTML = '';

  const shareOk = bundle.shareFiles.length > 0 && navigator.share;
  const mobile = isMobileShareDevice();

  TARGETS.forEach(target => {
    const isDownload = target.id === 'download';
    if (!isDownload && !shareOk) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    const primary = isDownload && bundle.mode === 'zip';
    btn.className = `share-photos-target share-photos-target--${target.id}${primary ? ' share-photos-target--primary' : ''}`;
    btn.innerHTML = `
      <span class="share-photos-target-ico" aria-hidden="true">${target.icon}</span>
      <span class="share-photos-target-lbl">${esc(t(target.labelKey))}</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleShareClick(target.id, bundle);
    });
    grid.appendChild(btn);
  });

  const existingNote = root.querySelector('.share-photos-note');
  existingNote?.remove();

  const note = document.createElement('p');
  note.className = 'share-photos-note';
  if (bundle.mode === 'zip' && shareOk) {
    note.textContent = t('sharePhotos.zipShareHint');
  } else if (bundle.mode === 'zip') {
    note.textContent = t('sharePhotos.desktopZipHint');
  } else if (!shareOk && mobile) {
    note.textContent = t('sharePhotos.noWebShare');
  } else if (!shareOk) {
    note.textContent = t('sharePhotos.desktopHint');
  }
  if (note.textContent) root.appendChild(note);
}

/**
 * Monta il pannello export foto dentro un contenitore esistente.
 * @param {HTMLElement} root
 * @param {{ trip: object, photos: object[] }} opts
 */
export function mountSharePhotosPanel(root, { trip, photos }) {
  const list = (photos || []).filter(p => p.url);
  if (!list.length) {
    root.innerHTML = `<p class="share-empty">${esc(t('gal.noPhotos'))}</p>`;
    return;
  }

  root.className = 'share-photos';
  root.innerHTML = `
    <div class="share-photos-status" id="sharePhotosStatus">${esc(t('sharePhotos.preparing'))}</div>
    <div class="share-photos-grid" id="sharePhotosGrid" hidden></div>`;

  const status = root.querySelector('#sharePhotosStatus');
  const grid = root.querySelector('#sharePhotosGrid');

  (async () => {
    try {
      status.textContent = t('sharePhotos.preparingN', { done: 0, total: list.length });
      await ensureSession();
      const files = await buildPhotoFiles(list, trip, (done, total) => {
        status.textContent = t('sharePhotos.preparingN', { done, total });
      });

      if (files.length > 1) {
        status.textContent = t('sharePhotos.packing');
      }

      const bundle = await prepareShareBundle(files, trip);

      status.hidden = true;
      grid.hidden = false;
      renderTargets(root, bundle);
    } catch (err) {
      status.textContent = err.message || t('sharePhotos.err');
      status.classList.add('share-photos-status--err');
    }
  })();
}
