/**
 * ui/lightbox.js — Visualizzatore foto a schermo intero + note
 */

import { scene, dc } from '../scenes.js';
import { joinParts, photoDisplayDate, esc } from '../utils.js';
import * as api from '../api.js';
import { showToast } from './toast.js';
import { setTip } from './tooltip.js';
import { openConfirm } from './modal.js';
import { reloadTrips } from '../data.js';
import { shareSinglePhoto, downloadSinglePhoto, isMobileShareDevice } from './sharePhotos.js';
import { mountImage } from './photoDisplay.js';
import { t } from '../i18n.js';

let _trip = null;
let _photos = [];
let _idx = 0;
let _saving = false;
let _onChanged = null;
let _onClose = null;
let _canWrite = true;

const el = id => document.getElementById(id);

const STORY_NAV_MQ = window.matchMedia('(hover: none), (max-width: 900px)');

function isStoryNavDevice() {
  return STORY_NAV_MQ.matches;
}

let _touchStartX = 0;
let _touchStartY = 0;
let _touchStartT = 0;
let _suppressStoryClick = false;

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
let _zoom = { scale: 1, x: 0, y: 0 };
let _pinchStartDist = 0;
let _pinchStartScale = 1;
let _panStart = null;
let _isPinching = false;

function isZoomed() {
  return _zoom.scale > 1.02;
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function clampPan() {
  if (!isZoomed()) {
    _zoom.x = 0;
    _zoom.y = 0;
    return;
  }
  const img = el('lbImg');
  const box = el('lbBox');
  if (!img?.offsetWidth || !box) return;
  const maxX = Math.max(0, (img.offsetWidth * _zoom.scale - box.clientWidth) / 2);
  const maxY = Math.max(0, (img.offsetHeight * _zoom.scale - box.clientHeight) / 2);
  _zoom.x = Math.min(maxX, Math.max(-maxX, _zoom.x));
  _zoom.y = Math.min(maxY, Math.max(-maxY, _zoom.y));
}

function applyZoom() {
  const img = el('lbImg');
  const box = el('lbBox');
  const stage = el('lbStage');
  if (!img) return;
  if (_zoom.scale <= ZOOM_MIN) {
    _zoom.scale = ZOOM_MIN;
    _zoom.x = 0;
    _zoom.y = 0;
  }
  img.style.transform = _zoom.scale > ZOOM_MIN
    ? `translate(${_zoom.x}px, ${_zoom.y}px) scale(${_zoom.scale})`
    : '';
  const active = isZoomed() || _isPinching;
  img.classList.toggle('lb-zoomed', isZoomed());
  box?.classList.toggle('lb-zoomed', isZoomed());
  stage?.classList.toggle('lb-zoom-active', active);
}

function resetZoom() {
  _zoom = { scale: 1, x: 0, y: 0 };
  _panStart = null;
  _isPinching = false;
  applyZoom();
}
const SHARE_SVG = '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>';
const DOWNLOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

let _photoExportBusy = false;

function updateLbExportButton() {
  const btn = el('lbShare');
  if (!btn) return;
  const mobile = isMobileShareDevice();
  btn.innerHTML = mobile ? SHARE_SVG : DOWNLOAD_SVG;
  setTip(btn, mobile ? t('lb.sharePhoto') : t('lb.downloadPhoto'), { position: 'top' });
}

async function exportCurrentPhoto() {
  if (_photoExportBusy) return;
  const ph = currentPhoto();
  if (!ph?.url || !_trip) return;

  const btn = el('lbShare');
  const mobile = isMobileShareDevice();
  _photoExportBusy = true;
  if (btn) btn.disabled = true;

  try {
    if (mobile) {
      await shareSinglePhoto(_trip, ph);
    } else {
      await downloadSinglePhoto(_trip, ph);
      showToast(t('sharePhotos.downloaded', { n: 1 }), 'neutral');
    }
  } catch (err) {
    showToast(err.message || t('sharePhotos.err'), 'error');
  } finally {
    _photoExportBusy = false;
    if (btn) btn.disabled = false;
  }
}

function flashStoryTap(side) {
  const stage = el('lbStage');
  stage.classList.remove('flash-prev', 'flash-next');
  void stage.offsetWidth;
  stage.classList.add(side === 'prev' ? 'flash-prev' : 'flash-next');
  setTimeout(() => stage.classList.remove('flash-prev', 'flash-next'), 220);
}

function handleStoryTap(clientX, target) {
  if (isZoomed()) return;
  if (!isStoryNavDevice() || _photos.length <= 1) return;
  if (target?.closest?.('button, textarea, input, a, .lb-meta, .lb-note-wrap, .lb-top, .lb-toolbar, .lb-tool, .lb-side, #lbToolbar, #lbActions')) return;

  const box = el('lbBox');
  const rect = box.getBoundingClientRect();
  const x = clientX - rect.left;
  if (x < 0 || x > rect.width) return;

  if (x / rect.width < 0.35) {
    flashStoryTap('prev');
    prev();
  } else {
    flashStoryTap('next');
    next();
  }
}

export function initLightbox() {
  el('lbX').addEventListener('click', closeLightbox);
  el('lb').addEventListener('click', e => { if (e.target === e.currentTarget) closeLightbox(); });
  document.querySelectorAll('[data-lb-prev]').forEach(b => b.addEventListener('click', prev));
  document.querySelectorAll('[data-lb-next]').forEach(b => b.addEventListener('click', next));
  el('lbNoteSave').addEventListener('click', saveNote);
  el('lbCover').addEventListener('click', e => { e.stopPropagation(); makeCover(); });
  el('lbDelete').addEventListener('click', e => { e.stopPropagation(); removePhoto(); });
  el('lbShare')?.addEventListener('click', e => {
    e.stopPropagation();
    exportCurrentPhoto();
  });
  el('lbToolbar')?.addEventListener('click', e => e.stopPropagation());

  el('lbNote').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveNote();
  });

  document.addEventListener('keydown', e => {
    if (!el('lb').classList.contains('open')) return;
    if (e.target === el('lbNote')) return;
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'Escape' && !document.getElementById('modal').classList.contains('open')) {
      closeLightbox();
    }
  });

  window.addEventListener('wf:langchange', () => {
    if (el('lb').classList.contains('open')) {
      updateLbExportButton();
      render();
    }
  });

  const stage = el('lbStage');

  stage.addEventListener('click', e => {
    if (!el('lb').classList.contains('open') || _suppressStoryClick) return;
    handleStoryTap(e.clientX, e.target);
  });

  stage.addEventListener('touchstart', e => {
    if (!el('lb').classList.contains('open')) return;
    if (e.touches.length === 2) {
      _isPinching = true;
      _panStart = null;
      _pinchStartDist = touchDist(e.touches);
      _pinchStartScale = _zoom.scale;
      applyZoom();
      return;
    }
    if (isZoomed()) {
      _panStart = { x: e.touches[0].clientX - _zoom.x, y: e.touches[0].clientY - _zoom.y };
    } else {
      _panStart = null;
    }
    _touchStartX = e.touches[0].clientX;
    _touchStartY = e.touches[0].clientY;
    _touchStartT = Date.now();
  }, { passive: true });

  stage.addEventListener('touchmove', e => {
    if (!el('lb').classList.contains('open')) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      _isPinching = true;
      const dist = touchDist(e.touches);
      if (_pinchStartDist > 0) {
        _zoom.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, _pinchStartScale * (dist / _pinchStartDist)));
        clampPan();
        applyZoom();
      }
      return;
    }
    if (isZoomed() && _panStart && e.touches.length === 1) {
      e.preventDefault();
      _zoom.x = e.touches[0].clientX - _panStart.x;
      _zoom.y = e.touches[0].clientY - _panStart.y;
      clampPan();
      applyZoom();
    }
  }, { passive: false });

  stage.addEventListener('touchend', e => {
    if (!el('lb').classList.contains('open')) return;
    const wasPinching = _isPinching;
    if (e.touches.length < 2) {
      if (_isPinching && _zoom.scale < 1.05) resetZoom();
      _isPinching = false;
      _pinchStartDist = 0;
    }
    if (e.touches.length === 0) _panStart = null;
    applyZoom();

    if (wasPinching || isZoomed()) return;

    const dx = e.changedTouches[0].clientX - _touchStartX;
    const dy = e.changedTouches[0].clientY - _touchStartY;
    const dt = Date.now() - _touchStartT;

    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (_photos.length > 1) (dx > 0 ? prev : next)();
      return;
    }

    if (Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 400) {
      _suppressStoryClick = true;
      handleStoryTap(e.changedTouches[0].clientX, e.target);
      setTimeout(() => { _suppressStoryClick = false; }, 350);
    }
  }, { passive: true });
}

export function openLightbox(trip, photos, idx = 0, { onChanged = null, onClose = null, canWrite = true } = {}) {
  if (!photos.length) return;
  _trip = trip;
  _photos = photos;
  _onChanged = onChanged;
  _onClose = onClose;
  _canWrite = canWrite;
  _idx = Math.min(Math.max(0, idx), photos.length - 1);
  el('lb').classList.add('open');
  render();
}

export function closeLightbox() {
  el('lb').classList.remove('open');
  const img = el('lbImg');
  resetZoom();
  img.style.display = 'none';
  img.removeAttribute('src');
  delete img.dataset.photoId;
  el('lbCv').style.display = '';
  el('lbNote').value = '';
  el('lbNoteWrap').classList.remove('show');
  if (_onClose) {
    const fn = _onClose;
    _onClose = null;
    fn();
  }
}

function prev() { _idx = (_idx - 1 + _photos.length) % _photos.length; render(); }
function next() { _idx = (_idx + 1) % _photos.length; render(); }

function currentPhoto() {
  return _photos[_idx];
}

function render() {
  const ph = currentPhoto();
  const when = photoDisplayDate(ph);
  const title = ph.caption || ph.note || when || _trip.dest;
  el('lbTitle').textContent = title;
  el('lbSub').textContent = joinParts(_trip.dest, when);
  el('lbCount').textContent = `${_idx + 1} / ${_photos.length}`;
  const multi = _photos.length > 1;
  document.querySelectorAll('[data-lb-prev], [data-lb-next]').forEach(b => { b.disabled = !multi; });

  const img = el('lbImg');
  const cv = el('lbCv');
  const noteWrap = el('lbNoteWrap');

  if (ph.url) {
    cv.style.display = 'none';
    img.style.display = '';
    if (img.dataset.photoId !== String(ph.id)) {
      resetZoom();
      img.dataset.photoId = String(ph.id);
      mountImage(img, { tripId: ph.tripId, photoId: ph.id, url: ph.url, encrypted: ph.encrypted, mime: ph.mime });
    }
    updateLbExportButton();
    el('lbShare').hidden = false;
    if (ph.id && _canWrite) {
      noteWrap.classList.add('show');
      el('lbNote').value = ph.note || '';
      el('lbCaption').textContent = ph.caption ? `${t('lb.caption')}: ${ph.caption}` : '';
      el('lbCaption').style.display = ph.caption ? '' : 'none';

      const isCover = _trip.coverPhotoId === ph.id;
      const coverBtn = el('lbCover');
      coverBtn.classList.toggle('active', isCover);
      setTip(coverBtn, isCover ? t('lb.coverIs') : t('lb.coverSet'), { position: 'top' });
      el('lbActions').style.display = '';
      el('lbCover').style.display = '';
      el('lbDelete').style.display = ph.canDelete !== false ? '' : 'none';
    } else {
      noteWrap.classList.remove('show');
      el('lbActions').style.display = 'none';
    }
  } else {
    img.style.display = 'none';
    img.removeAttribute('src');
    cv.style.display = '';
    el('lbShare').hidden = true;
    const W = Math.min(window.innerWidth - 40, 900), H = Math.round(W * .62);
    dc(cv, W, H, (ctx, w, h) => {
      scene(ctx, w, h, _trip.scene);
      ctx.save(); ctx.globalAlpha = .04 + (_idx % 4) * .02; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.restore();
    });
    noteWrap.classList.remove('show');
    el('lbActions').style.display = 'none';
  }
}

async function makeCover() {
  const ph = currentPhoto();
  if (!ph?.id || _trip.coverPhotoId === ph.id) return;
  try {
    const updated = await api.setCover(_trip.id, ph.id);
    _trip = { ..._trip, coverPhotoId: updated.coverPhotoId, coverUrl: updated.coverUrl };
    showToast(t('toast.coverUpdated'));
    render();
    await reloadTrips({ silent: true });
    _onChanged?.();
  } catch (e) {
    showToast(e.message || t('toast.coverErr'), 'error');
  }
}

function removePhoto() {
  const ph = currentPhoto();
  if (!ph?.id) {
    showToast(t('sharePhotos.err'), 'error');
    return;
  }
  if (ph.canDelete === false) {
    showToast(t('toast.err'), 'error');
    return;
  }
  openConfirm({
    title: t('modal.deletePhoto'),
    message: t('modal.deletePhotoMsg', { dest: esc(_trip.dest) }) + t('modal.irreversible'),
    onConfirm: async () => {
      await api.deletePhoto(ph.id);
      api.invalidatePhotoCache(_trip.id);
      showToast(t('toast.photoDeleted'));
      _photos.splice(_idx, 1);
      if (!_photos.length) {
        closeLightbox();
      } else {
        _idx = Math.min(_idx, _photos.length - 1);
        render();
      }
      await reloadTrips({ silent: true });
      _onChanged?.();
    },
  });
}

async function saveNote() {
  const ph = currentPhoto();
  if (!ph?.id || _saving) return;

  const note = el('lbNote').value.trim();
  if (note === (ph.note || '')) {
    showToast(t('toast.noChange'), 'neutral');
    return;
  }

  const btn = el('lbNoteSave');
  _saving = true;
  btn.disabled = true;
  btn.textContent = t('modal.saving');

  try {
    const updated = await api.updatePhoto(ph.id, { note });
    ph.note = updated.note;
    _photos[_idx] = { ...ph, ...updated };
    api.invalidatePhotoCache(_trip.id);
    showToast(t('toast.noteSaved'));
    render();
  } catch (e) {
    showToast(e.message || t('toast.saveErr'), 'error');
  } finally {
    _saving = false;
    btn.disabled = false;
    btn.textContent = t('lb.saveNote');
  }
}
