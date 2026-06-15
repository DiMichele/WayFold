/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { esc, tripDest } from '../utils.js';
import { showToast } from './toast.js';
import { closeModal } from './modal.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

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

/** Album: un file ZIP per il foglio di condivisione; singola foto: immagine diretta. */
async function prepareShareBundle(files, trip) {
  if (files.length <= 1) {
    return { shareFiles: files, downloadFiles: files };
  }
  const zipFile = await buildZipFile(files, trip);
  return { shareFiles: [zipFile], downloadFiles: files };
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

function openNativeShare(shareFiles, downloadFiles) {
  if (!navigator.share) return false;

  const payload = { files: shareFiles };
  const sharePromise = navigator.share(payload);
  closeModal();
  sharePromise.catch(err => {
    if (err?.name === 'AbortError') return;
    downloadFiles(downloadFiles);
    showToast(t('sharePhotos.downloadFallback'), 'neutral');
  });
  return true;
}

function handleShareClick(targetId, bundle) {
  const { shareFiles, downloadFiles: dlFiles } = bundle;

  if (targetId === 'download') {
    closeModal();
    downloadFiles(dlFiles);
    showToast(t('sharePhotos.downloaded', { n: dlFiles.length }), 'neutral');
    return;
  }

  if (!openNativeShare(shareFiles, dlFiles)) {
    closeModal();
    downloadFiles(dlFiles);
    showToast(t('sharePhotos.downloadFallback'), 'neutral');
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

function renderTargets(root, bundle) {
  const grid = root.querySelector('#sharePhotosGrid');
  grid.innerHTML = '';
  TARGETS.forEach(target => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `share-photos-target share-photos-target--${target.id}`;
    btn.innerHTML = `
      <span class="share-photos-target-ico" aria-hidden="true">${target.icon}</span>
      <span class="share-photos-target-lbl">${esc(t(target.labelKey))}</span>`;
    btn.addEventListener('click', () => handleShareClick(target.id, bundle));
    grid.appendChild(btn);
  });
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
