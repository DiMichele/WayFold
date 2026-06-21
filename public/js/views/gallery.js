/**
 * views/gallery.js — Picker viaggi + griglia foto reali
 */

import { state, getTrip, visibleTrips } from '../state.js';
import { joinParts, monthYear, photoDisplayDate, esc, tripDest, PHOTO_EMPTY_SVG, mountPhotoEmptyThumb } from '../utils.js';
import * as api from '../api.js';
import { unlockTripKeyFromShare } from '../crypto/tripKeyVault.js';
import { openLightbox } from '../ui/lightbox.js';
import { showToast } from '../ui/toast.js';
import { reloadTrips, suppressNewPhotoToast, refreshPollBaseline } from '../data.js';
import { confirmDeleteTrip } from '../ui/tripDelete.js';
import { openTripForm, openModal, closeModal } from '../ui/modal.js';
import { openShareModal } from '../ui/shareModal.js';
import { downloadAlbumAsZip, shareAlbum, isMobileShareDevice } from '../ui/sharePhotos.js';
import { setTip } from '../ui/tooltip.js';
import { refreshJourneyScroll } from '../ui/journeyScroll.js';
import { mountImage, mountCover } from '../ui/photoDisplay.js';
import { t, formatPhotos } from '../i18n.js';
import { goToGallery, historyBack } from '../historyNav.js';

const el = id => document.getElementById(id);

const UPLOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
const SHARE_SVG = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const INVITE_SVG = '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const DOWNLOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

function tripIsOwner(trip) {
  return !trip.shared;
}

function tripCanUpload(trip) {
  return !trip.shared || trip.sharedPermission === 'upload';
}

function photosToLightboxItems(trip, photos) {
  return photos.map(p => ({
    id: p.id,
    tripId: trip.id,
    label: p.caption || p.note || photoDisplayDate(p),
    sub: joinParts(trip.dest, photoDisplayDate(p)),
    url: p.url,
    encrypted: p.encrypted,
    mime: p.originalMime,
    caption: p.caption,
    note: p.note,
    date: p.date,
    takenAt: p.takenAt,
    canDelete: p.canDelete !== false,
  }));
}

/** Apre il lightbox direttamente (es. dalla mappa) senza passare dal picker galleria. */
export async function openTripPhotosFromMap(trip, { idx = 0, onClose = null, fromHistory = false } = {}) {
  if (!trip?.photoCount) return false;
  let photos;
  try {
    photos = await api.fetchPhotos(trip.id);
  } catch {
    return false;
  }
  if (!photos.length) return false;

  openLightbox(trip, photosToLightboxItems(trip, photos), idx, {
    onChanged: () => reloadTrips({ silent: true, render: false }),
    canWrite: tripCanUpload(trip),
    onClose,
    fromHistory,
  });
  return true;
}

function sharedBadgeHtml() {
  return `<span class="trip-shared-badge">${esc(t('gal.sharedBadge'))}</span>`;
}

let galleryDragDepth = 0;
let uploadUi = null;
let albumExportBusy = false;
let activeGalleryPhotos = null;

function galleryPhotosForTrip(tripId) {
  if (!activeGalleryPhotos?.length) return null;
  if (Number(activeGalleryPhotos[0]?.tripId) !== Number(tripId)) return null;
  return activeGalleryPhotos;
}

function setGalleryExportButtons(toolbar, enabled) {
  if (!toolbar) return;
  toolbar.querySelectorAll('[data-gal-export]').forEach(btn => {
    btn.disabled = !enabled;
  });
}

function openAlbumShareSheet(trip, onShareAlbum) {
  const body = document.createElement('div');
  body.className = 'modal-body gal-share-sheet';
  body.innerHTML = `
    <div class="gal-share-sheet-actions">
      <button type="button" class="modal-btn s gal-share-sheet-btn" id="galShareInvite">${esc(t('gal.shareTabInvite'))}</button>
      <button type="button" class="modal-btn s gal-share-sheet-btn" id="galSharePhotos">${esc(t('gal.shareAlbum'))}</button>
    </div>`;
  body.querySelector('#galShareInvite').addEventListener('click', () => {
    closeModal(false, { skipHistory: true });
    openShareModal(trip);
  });
  body.querySelector('#galSharePhotos').addEventListener('click', () => {
    closeModal(false, { skipHistory: true });
    onShareAlbum();
  });
  openModal({ title: t('gal.share'), body });
}

async function runAlbumExport(trip, btn, mode) {
  if (albumExportBusy) return;
  albumExportBusy = true;
  if (btn) btn.disabled = true;
  const exportFn = mode === 'share' ? shareAlbum : downloadAlbumAsZip;
  try {
    await exportFn(trip, {
      photos: galleryPhotosForTrip(trip.id) || undefined,
    });
  } catch (e) {
    if (e.message !== 'cancel') {
      showToast(e.message || t('sharePhotos.err'), 'error');
    }
  } finally {
    albumExportBusy = false;
    if (btn) btn.disabled = false;
  }
}

function getUploadUi() {
  const view = el('view-gallery');
  if (!view) return null;
  if (!uploadUi || !uploadUi.isConnected) {
    uploadUi = document.createElement('div');
    uploadUi.id = 'galUploadProgress';
    uploadUi.className = 'gal-upload-progress';
    uploadUi.setAttribute('aria-live', 'polite');
    uploadUi.innerHTML = `
      <div class="gal-upload-progress-inner">
        <div class="gal-upload-progress-head">
          <span class="gal-upload-progress-txt"></span>
          <span class="gal-upload-progress-pct"></span>
        </div>
        <div class="gal-upload-progress-track">
          <div class="gal-upload-progress-bar"></div>
        </div>
      </div>`;
    view.insertBefore(uploadUi, el('galContent'));
  }
  return uploadUi;
}

function setUploadUi({ text, pct, indeterminate = false }) {
  const ui = getUploadUi();
  if (!ui) return;
  ui.querySelector('.gal-upload-progress-txt').textContent = text || '';
  const pctEl = ui.querySelector('.gal-upload-progress-pct');
  const bar = ui.querySelector('.gal-upload-progress-bar');
  if (indeterminate) {
    bar.classList.add('indeterminate');
    bar.style.width = '';
    pctEl.textContent = '';
  } else {
    bar.classList.remove('indeterminate');
    const p = Math.round(Math.max(0, Math.min(100, pct ?? 0)));
    bar.style.width = `${p}%`;
    pctEl.textContent = `${p}%`;
  }
}

function showUploadUi(on) {
  const ui = getUploadUi();
  const view = el('view-gallery');
  ui?.classList.toggle('on', on);
  view?.classList.toggle('uploading', on);
}

function uploadLabel(total, done, processing) {
  if (total <= 1) {
    return processing ? t('gal.processing') : t('gal.uploading', { n: 1 });
  }
  const d = Math.min(Math.max(1, done), total);
  return processing
    ? t('gal.processingBatch', { done: d, total })
    : t('gal.uploadingBatch', { done: d, total });
}

/** iOS/PWA spesso non imposta file.type: accetta anche per estensione. */
function isImageFile(f) {
  if (f.type?.startsWith('image/')) return true;
  const ext = (f.name || '').split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext);
}

async function runGalleryUpload(tripId, files) {
  const images = [...files].filter(isImageFile);
  if (!images.length) {
    showToast(t('gal.uploadFail'), 'error');
    return;
  }

  showUploadUi(true);
  setUploadUi({ text: uploadLabel(images.length, 1, false), pct: 0, indeterminate: true });
  suppressNewPhotoToast();

  try {
    const result = await api.uploadPhotos(tripId, images, {
      onBatchStart: (startIdx, _batchLen, total) => {
        setUploadUi({
          text: uploadLabel(total, startIdx + 1, false),
          indeterminate: true,
        });
      },
      onProgress: (frac, meta = {}) => {
        const total = meta.filesTotal ?? images.length;
        const done = meta.filesDone ?? Math.ceil(frac * total);
        setUploadUi({
          text: uploadLabel(total, done, meta.processing),
          pct: meta.processing ? 99 : frac * 100,
          indeterminate: meta.processing || frac <= 0,
        });
      },
    });
    const n = result.photos?.length || 0;
    showToast(t('gal.uploaded', { n }));
    if (result.errors?.length) showToast(result.errors[0], 'error');
    api.invalidatePhotoCache(tripId);
    await reloadTrips({ silent: true, render: false });
    await refreshPollBaseline();
    showUploadUi(false);
    renderGallery();
  } catch (e) {
    showToast(e.message || t('gal.uploadFail'), 'error');
    showUploadUi(false);
    api.invalidatePhotoCache(tripId);
    await reloadTrips({ silent: true, render: false });
    await refreshPollBaseline();
    renderGallery();
  }
}

function bindGalleryDrop(view, doUpload) {
  galleryDragDepth = 0;
  view.ondragenter = e => {
    e.preventDefault();
    galleryDragDepth++;
    view.classList.add('dropping');
    el('galDropHint')?.setAttribute('aria-hidden', 'false');
  };
  view.ondragover = e => e.preventDefault();
  view.ondragleave = e => {
    galleryDragDepth--;
    if (galleryDragDepth <= 0) {
      galleryDragDepth = 0;
      view.classList.remove('dropping');
      el('galDropHint')?.setAttribute('aria-hidden', 'true');
    }
  };
  view.ondrop = e => {
    e.preventDefault();
    galleryDragDepth = 0;
    view.classList.remove('dropping');
    el('galDropHint')?.setAttribute('aria-hidden', 'true');
    doUpload(e.dataTransfer.files);
  };
}

export function renderGallery() {
  const c = document.getElementById('galContent');
  c.innerHTML = '';

  const trip = getTrip(state.galTripId);
  if (!trip) {
    state.galTripId = null;
    buildPicker(c);
    return;
  }
  buildPhotos(c, trip);
}

// ─── Picker ────────────────────────────────────────────────────────────────

function buildPicker(c) {
  const shell = document.createElement('div');
  shell.className = 'gal-shell gal-pick-shell view-shell';

  const redeem = document.createElement('div');
  redeem.className = 'gal-redeem';
  redeem.innerHTML = `
    <div class="gal-redeem-title">${esc(t('gal.redeemTitle'))}</div>
    <p class="gal-redeem-hint">${esc(t('gal.redeemHint'))}</p>
    <div class="gal-redeem-row">
      <input type="text" class="gal-redeem-input" id="galRedeemInput" maxlength="12" autocomplete="off" spellcheck="false" placeholder="${esc(t('gal.redeemPh'))}">
      <button type="button" class="gal-redeem-btn" id="galRedeemBtn">${esc(t('gal.redeemBtn'))}</button>
    </div>`;

  const main = document.createElement('div');
  main.className = 'gal-pick-main';
  main.innerHTML = `
    <div class="gal-pick-label">${t('gal.pick')}</div>
    <div class="journey-scroll gal-pick-scroll">
      <div class="journey-scroll-edge journey-scroll-edge--top" aria-hidden="true"></div>
      <div class="journey-scroll-track">
        <div class="gal-pick-list" id="pickList"></div>
      </div>
      <div class="journey-scroll-edge journey-scroll-edge--bottom" aria-hidden="true"></div>
      <div class="journey-scroll-affordance" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        <span>${esc(t('gal.pickScrollMore'))}</span>
      </div>
    </div>`;

  const layout = document.createElement('div');
  layout.className = 'gal-pick-layout';
  layout.appendChild(redeem);
  layout.appendChild(main);
  shell.appendChild(layout);
  c.appendChild(shell);

  const redeemBtn = redeem.querySelector('#galRedeemBtn');
  const redeemInput = redeem.querySelector('#galRedeemInput');
  redeemBtn.addEventListener('click', () => redeemCode(redeemInput.value));
  redeemInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') redeemCode(redeemInput.value);
  });

  const trips = visibleTrips();
  const list = main.querySelector('#pickList');

  if (!state.trips.length) {
    list.innerHTML = `
      <div class="gal-empty gal-empty--inline">
        <div class="gal-empty-title">${t('gal.noTrips')}</div>
        <div class="gal-empty-sub">${t('gal.noTripsUser')}</div>
      </div>`;
    refreshJourneyScroll(list);
    return;
  }
  if (!trips.length) {
    const q = esc(state.search);
    list.innerHTML = `<div class="search-noresults">${t('search.none', { q }).replace(q, `<b>${q}</b>`)}</div>`;
    refreshJourneyScroll(list);
    return;
  }

  trips.forEach(rowTrip => {
    const row = document.createElement('div');
    row.className = 'gal-pick-row';

    const cvWrap = document.createElement('div');
    cvWrap.className = 'gal-pick-cv';
    if (rowTrip.coverUrl) {
      const img = document.createElement('img');
      img.alt = rowTrip.dest; img.loading = 'lazy';
      mountCover(img, rowTrip);
      cvWrap.appendChild(img);
    } else {
      mountPhotoEmptyThumb(cvWrap);
    }
    row.appendChild(cvWrap);

    row.insertAdjacentHTML('beforeend', `
      <div>
        <div class="gal-pick-dest">${esc(tripDest(rowTrip))}${rowTrip.shared ? sharedBadgeHtml() : ''}</div>
        <div class="gal-pick-meta">${esc(joinParts(rowTrip.country, monthYear(rowTrip), formatPhotos(rowTrip.photoCount || 0)))}</div>
      </div>
      <span class="gal-pick-flag">${rowTrip.flag || ''}</span>`);

    row.onclick = () => goToGallery(rowTrip.id);
    list.appendChild(row);
  });

  refreshJourneyScroll(list);
}

async function redeemCode(raw) {
  const code = String(raw || '').trim();
  if (!code) return;
  const btn = el('galRedeemBtn');
  if (btn) btn.disabled = true;
  try {
    const result = await api.redeemShareCode(code);
    if (result.keyWrap && result.wrapSalt) {
      await unlockTripKeyFromShare(result.trip.id, code, result.keyWrap, result.wrapSalt);
    }
    await reloadTrips({ silent: true, render: false });
    showToast(result.alreadyMember ? t('gal.redeemAlready') : t('gal.redeemOk'));
    goToGallery(result.trip.id);
  } catch (e) {
    if (e.status === 400) showToast(t('gal.redeemOwn'), 'error');
    else showToast(e.message || t('gal.redeemFail'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Griglia foto ──────────────────────────────────────────────────────────

async function buildPhotos(c, trip) {
  activeGalleryPhotos = null;

  const shell = document.createElement('div');
  shell.className = 'gal-shell view-shell';
  const panel = document.createElement('div');
  panel.className = 'gal-panel';
  const body = document.createElement('div');
  body.className = 'gal-body';

  const hd = document.createElement('header');
  hd.className = 'gal-header';

  const headMain = document.createElement('div');
  headMain.className = 'gal-header-main';

  const back = document.createElement('button');
  back.className = 'gal-back';
  back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
  back.onclick = () => historyBack();
  headMain.appendChild(back);

  const tw = document.createElement('div');
  tw.className = 'gal-hthumb';
  if (trip.coverUrl) {
    const img = document.createElement('img');
    img.alt = trip.dest;
    mountCover(img, trip);
    tw.appendChild(img);
  } else {
    mountPhotoEmptyThumb(tw);
  }
  headMain.appendChild(tw);

  headMain.insertAdjacentHTML('beforeend', `
    <div class="gal-hinfo">
      <div class="gal-hdest"><span class="gal-hdest-txt">${esc(tripDest(trip))}</span>${trip.shared ? sharedBadgeHtml() : ''}</div>
      <div class="gal-hmeta">${esc(joinParts(trip.country, monthYear(trip), formatPhotos(trip.photoCount || 0)))}</div>
    </div>`);
  hd.appendChild(headMain);

  const canUpload = tripCanUpload(trip);
  const isOwner = tripIsOwner(trip);

  // Upload: input nascosto + azioni
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  hd.appendChild(fileInput);

  const actions = document.createElement('div');
  actions.className = 'gal-actions';
  const toolbar = document.createElement('div');
  toolbar.className = 'gal-actions-toolbar';

  const mobile = isMobileShareDevice();
  const hasPhotos = trip.photoCount > 0;
  const mergedMobileShare = mobile && isOwner && hasPhotos;

  if (canUpload) {
    const upBtn = document.createElement('button');
    upBtn.className = 'gal-upload';
    upBtn.innerHTML = `${UPLOAD_SVG}<span>${t('gal.upload')}</span>`;
    upBtn.onclick = () => fileInput.click();
    toolbar.appendChild(upBtn);
  }

  if (mergedMobileShare) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'gal-share';
    shareBtn.dataset.galExport = '1';
    shareBtn.disabled = true;
    setTip(shareBtn, t('gal.share'), { position: 'top' });
    shareBtn.innerHTML = `${SHARE_SVG}<span>${t('gal.share')}</span>`;
    shareBtn.onclick = () => openAlbumShareSheet(trip, () => runAlbumExport(trip, shareBtn, 'share'));
    toolbar.appendChild(shareBtn);
  } else {
    if (isOwner) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'gal-share';
      setTip(shareBtn, t('gal.shareTabInvite'), { position: 'top' });
      shareBtn.innerHTML = `${mobile ? SHARE_SVG : INVITE_SVG}<span>${t('gal.share')}</span>`;
      shareBtn.onclick = () => openShareModal(trip);
      toolbar.appendChild(shareBtn);
    }

    if (hasPhotos) {
      const exportBtn = document.createElement('button');
      exportBtn.dataset.galExport = '1';
      exportBtn.disabled = true;
      if (mobile) {
        exportBtn.className = 'gal-share';
        setTip(exportBtn, t('gal.shareAlbum'), { position: 'top' });
        exportBtn.innerHTML = `${SHARE_SVG}<span>${t('gal.shareAlbum')}</span>`;
        exportBtn.onclick = () => runAlbumExport(trip, exportBtn, 'share');
      } else {
        exportBtn.className = 'gal-download';
        setTip(exportBtn, t('gal.downloadAlbum'), { position: 'top' });
        exportBtn.innerHTML = `${DOWNLOAD_SVG}<span>${t('gal.downloadAlbum')}</span>`;
        exportBtn.onclick = () => runAlbumExport(trip, exportBtn, 'download');
      }
      toolbar.appendChild(exportBtn);
    }
  }

  if (canUpload) {
    const editBtn = document.createElement('button');
    editBtn.className = 'gal-edit';
    setTip(editBtn, t('trip.edit'), { position: 'top' });
    editBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>${t('trip.edit')}</span>`;
    editBtn.onclick = () => {
      openTripForm({
        trip,
        onSaved: async () => {
          await reloadTrips({ silent: true, render: false });
          renderGallery();
        },
      });
    };
    toolbar.appendChild(editBtn);
  }

  if (isOwner) {
    const delBtn = document.createElement('button');
    delBtn.className = 'gal-delete';
    setTip(delBtn, t('trip.delete'), { position: 'top' });
    delBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg><span>${t('trip.delete')}</span>`;
    delBtn.onclick = () => confirmDeleteTrip(trip, {
      onDeleted: () => goToGallery(null),
    });
    toolbar.appendChild(delBtn);
  }
  if (toolbar.childElementCount) actions.appendChild(toolbar);
  hd.appendChild(actions);

  panel.appendChild(hd);
  panel.appendChild(body);
  shell.appendChild(panel);
  c.appendChild(shell);

  const doUpload = canUpload ? (files => runGalleryUpload(trip.id, files)) : () => {};

  if (canUpload) {
    fileInput.addEventListener('change', () => {
      doUpload(fileInput.files);
      fileInput.value = '';
    });
  }

  const view = document.getElementById('view-gallery');
  if (canUpload) bindGalleryDrop(view, doUpload);

  // Nessuna foto: zona upload
  if (!trip.photoCount) {
    if (!canUpload) {
      const empty = document.createElement('div');
      empty.className = 'gal-dropzone gal-dropzone--readonly';
      empty.innerHTML = `
        <div class="gal-dropzone-card">
          <div class="gal-dropzone-icon">${PHOTO_EMPTY_SVG}</div>
          <div class="gal-dropzone-title">${esc(t('gal.noPhotos'))}</div>
        </div>`;
      body.appendChild(empty);
      return;
    }
    const zone = document.createElement('div');
    zone.className = 'gal-dropzone';
    zone.innerHTML = `
      <div class="gal-dropzone-card">
        <div class="gal-dropzone-icon">${PHOTO_EMPTY_SVG}</div>
        <div class="gal-dropzone-title">${esc(t('gal.noPhotos'))}</div>
        <p class="gal-dropzone-hint">${t('gal.noPhotosUser')}</p>
        <button type="button" class="gal-dropzone-btn">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>${esc(t('gal.upload'))}</span>
        </button>
      </div>`;

    const card = zone.querySelector('.gal-dropzone-card');
    const zoneBtn = zone.querySelector('.gal-dropzone-btn');
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      fileInput.click();
    });
    zoneBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileInput.click();
    });

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag');
      doUpload(e.dataTransfer.files);
    });

    body.appendChild(zone);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'gal-grid';
  body.appendChild(grid);

  const slots = Math.min(trip.photoCount, 30);
  for (let idx = 0; idx < slots; idx++) {
    const cell = document.createElement('div');
    cell.className = 'gcell gcell--loading' + (idx === 0 ? ' big' : '');
    grid.appendChild(cell);
  }

  let photos;
  try {
    photos = await api.fetchPhotos(trip.id, { fresh: true });
  } catch {
    if (state.galTripId === trip.id && grid.isConnected) {
      grid.innerHTML = `<div class="gal-fetch-err">${esc(t('gal.uploadFail'))}</div>`;
    }
    return;
  }

  if (state.galTripId !== trip.id || !grid.isConnected) return;

  activeGalleryPhotos = photos;
  setGalleryExportButtons(toolbar, true);

  const lbPhotos = photosToLightboxItems(trip, photos);

  grid.innerHTML = '';
  photos.forEach((p, idx) => {
    const cell = document.createElement('div');
    cell.className = 'gcell' + (idx === 0 ? ' big' : '');

    const img = document.createElement('img');
    img.alt = p.caption || trip.dest;
    img.loading = idx < 4 ? 'eager' : 'lazy';
    img.decoding = 'async';
    mountImage(img, { tripId: trip.id, photoId: p.id, url: p.url, encrypted: p.encrypted, mime: p.originalMime });
    cell.appendChild(img);

    if (p.id === trip.coverPhotoId) {
      cell.insertAdjacentHTML('beforeend',
        `<div class="gcell-cover" title="${esc(t('gal.coverBadge'))}"><svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>`);
    }

    const label = p.note || p.caption || photoDisplayDate(p);
    cell.insertAdjacentHTML('beforeend',
      `<div class="gcell-lbl"><span>${esc(label)}</span>${p.note ? '<span class="gcell-note-dot"></span>' : ''}</div>`);

    cell.onclick = () => openLightbox(trip, lbPhotos, idx, {
      onChanged: () => renderGallery(),
      canWrite: tripCanUpload(trip),
    });
    grid.appendChild(cell);
  });
}
