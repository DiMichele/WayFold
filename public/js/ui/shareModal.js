/**
 * ui/shareModal.js — Condivisione album (invito Wayfold + export foto)
 */

import * as api from '../api.js';
import { esc } from '../utils.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';
import { mountSharePhotosPanel } from './sharePhotos.js';
import { t } from '../i18n.js';

let _tripId = null;
let _trip = null;

function canInvite(trip) {
  return !trip?.shared;
}

function canExportPhotos(trip) {
  return (trip?.photoCount || 0) > 0;
}

function invitePanelHtml() {
  return `
    <p class="share-modal-hint">${esc(t('gal.shareCodeHint'))}</p>
    <div class="share-perm-row">
      <label class="share-perm">
        <input type="radio" name="sharePerm" value="view" checked>
        <span>${esc(t('gal.sharePermView'))}</span>
      </label>
      <label class="share-perm">
        <input type="radio" name="sharePerm" value="upload">
        <span>${esc(t('gal.sharePermUpload'))}</span>
      </label>
    </div>
    <button type="button" class="share-gen-btn" id="shareGenBtn">${esc(t('gal.shareGenerate'))}</button>
    <div class="share-code-box" id="shareCodeBox" hidden>
      <div class="share-code-label">${esc(t('gal.shareCodeLabel'))}</div>
      <div class="share-code-row">
        <code class="share-code-val" id="shareCodeVal"></code>
        <button type="button" class="share-copy-btn" id="shareCopyBtn">${esc(t('gal.shareCopy'))}</button>
      </div>
    </div>
    <div class="share-section" id="shareCodesSection">
      <div class="share-section-title">${esc(t('gal.shareActiveCodes'))}</div>
      <div class="share-list" id="shareCodesList"></div>
    </div>
    <div class="share-section" id="shareMembersSection">
      <div class="share-section-title">${esc(t('gal.shareMembers'))}</div>
      <div class="share-list" id="shareMembersList"></div>
    </div>`;
}

function setActiveTab(body, tab) {
  body.querySelectorAll('.share-tab').forEach(btn => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const invite = body.querySelector('#sharePanelInvite');
  const photos = body.querySelector('#sharePanelPhotos');
  if (invite) invite.hidden = tab !== 'invite';
  if (photos) photos.hidden = tab !== 'photos';
}

async function ensurePhotosPanel(body, photos) {
  const panel = body.querySelector('#sharePanelPhotos');
  if (!panel || panel.dataset.ready === '1') return;

  let list = photos;
  if (!list) {
    try {
      list = await api.fetchPhotos(_trip.id, { fresh: true });
    } catch {
      panel.innerHTML = `<p class="share-empty share-photos-status--err">${esc(t('sharePhotos.err'))}</p>`;
      panel.dataset.ready = '1';
      return;
    }
  }

  mountSharePhotosPanel(panel, { trip: _trip, photos: list });
  panel.dataset.ready = '1';
}

function bindInvitePanel(body) {
  body.querySelector('#shareGenBtn')?.addEventListener('click', generateCode);
  body.querySelector('#shareCopyBtn')?.addEventListener('click', copyCode);
  loadLists(body);
}

/**
 * @param {object} trip
 * @param {{ tab?: 'invite'|'photos'|'auto', photos?: object[] }} [opts]
 */
export function openShareModal(trip, opts = {}) {
  _trip = trip;
  _tripId = trip.id;

  const showInvite = canInvite(trip);
  const showPhotos = canExportPhotos(trip);
  if (!showInvite && !showPhotos) return;

  let tab = opts.tab || 'auto';
  if (tab === 'auto') tab = showInvite ? 'invite' : 'photos';
  if (tab === 'invite' && !showInvite) tab = 'photos';
  if (tab === 'photos' && !showPhotos) tab = 'invite';

  const body = document.createElement('div');
  body.className = 'share-modal';

  if (showInvite && showPhotos) {
    body.innerHTML = `
      <div class="share-tabs" role="tablist">
        <button type="button" class="share-tab" role="tab" data-tab="invite">${esc(t('gal.shareTabInvite'))}</button>
        <button type="button" class="share-tab" role="tab" data-tab="photos">${esc(t('gal.shareTabPhotos'))}</button>
      </div>
      <div id="sharePanelInvite" role="tabpanel"></div>
      <div id="sharePanelPhotos" role="tabpanel" hidden></div>`;

    body.querySelector('#sharePanelInvite').innerHTML = invitePanelHtml();
    bindInvitePanel(body);

    body.querySelectorAll('.share-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.tab;
        setActiveTab(body, next);
        if (next === 'photos') ensurePhotosPanel(body, opts.photos);
      });
    });
  } else if (showInvite) {
    body.innerHTML = `<div id="sharePanelInvite">${invitePanelHtml()}</div>`;
    bindInvitePanel(body);
  } else {
    body.innerHTML = `<div id="sharePanelPhotos"></div>`;
  }

  openModal({ title: t('gal.shareTitle'), body });

  if (showInvite && showPhotos) {
    setActiveTab(body, tab);
  }

  if (tab === 'photos' && showPhotos) {
    ensurePhotosPanel(body, opts.photos);
  }
}

async function generateCode() {
  const perm = document.querySelector('input[name="sharePerm"]:checked')?.value || 'view';
  const btn = document.getElementById('shareGenBtn');
  btn.disabled = true;
  try {
    const sc = await api.createShareCode(_tripId, perm);
    const box = document.getElementById('shareCodeBox');
    const val = document.getElementById('shareCodeVal');
    box.hidden = false;
    val.textContent = sc.code;
    await loadLists(document.querySelector('.share-modal'));
  } catch (e) {
    showToast(e.message || t('toast.err'), 'error');
  } finally {
    btn.disabled = false;
  }
}

function copyCode() {
  const code = document.getElementById('shareCodeVal')?.textContent;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => showToast(t('gal.shareCopied'))).catch(() => {
    showToast(code, 'error');
  });
}

async function loadLists(root) {
  if (!_tripId || !root) return;
  try {
    const [codes, members] = await Promise.all([
      api.fetchShareCodes(_tripId),
      api.fetchTripMembers(_tripId),
    ]);
    renderCodes(root.querySelector('#shareCodesList'), codes);
    renderMembers(root.querySelector('#shareMembersList'), members);
  } catch {
    /* modale chiusa o errore rete */
  }
}

function renderCodes(list, codes) {
  if (!list) return;
  const active = codes.filter(c => c.active);
  if (!active.length) {
    list.innerHTML = `<div class="share-empty">${esc(t('gal.shareNoCodes'))}</div>`;
    return;
  }
  list.innerHTML = active.map(c => `
    <div class="share-row">
      <code class="share-row-code">${esc(c.code)}</code>
      <span class="share-row-meta">${esc(c.permission === 'upload' ? t('gal.sharePermUpload') : t('gal.sharePermView'))}</span>
      <button type="button" class="share-row-btn" data-revoke="${c.id}">${esc(t('gal.shareRevoke'))}</button>
    </div>`).join('');
  list.querySelectorAll('[data-revoke]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.revokeShareCode(Number(btn.dataset.revoke));
        await loadLists(document.querySelector('.share-modal'));
      } catch (e) {
        showToast(e.message || t('toast.err'), 'error');
      }
    });
  });
}

function renderMembers(list, members) {
  if (!list) return;
  if (!members.length) {
    list.innerHTML = `<div class="share-empty">${esc(t('gal.shareNoMembers'))}</div>`;
    return;
  }
  list.innerHTML = members.map(m => `
    <div class="share-row">
      <span class="share-row-user">${esc(m.username)}</span>
      <span class="share-row-meta">${esc(m.permission === 'upload' ? t('gal.sharePermUpload') : t('gal.sharePermView'))}</span>
      <button type="button" class="share-row-btn" data-remove="${m.userId}">${esc(t('gal.shareRemoveMember'))}</button>
    </div>`).join('');
  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.removeTripMember(_tripId, Number(btn.dataset.remove));
        await loadLists(document.querySelector('.share-modal'));
      } catch (e) {
        showToast(e.message || t('toast.err'), 'error');
      }
    });
  });
}

/** Condividi una singola foto dal lightbox. */
export function shareLightboxPhoto(trip, photo) {
  openShareModal(trip, { tab: 'photos', photos: [photo] });
}
