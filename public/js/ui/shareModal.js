/**
 * ui/shareModal.js — Condivisione album tramite codice invito Wayfold
 */

import * as api from '../api.js';
import { buildShareCodePayload } from '../crypto/tripKeyVault.js';
import { esc } from '../utils.js';
import { showToast } from './toast.js';
import { openModal } from './modal.js';
import { t } from '../i18n.js';

let _tripId = null;
let _trip = null;

function canInvite(trip) {
  return !trip?.shared;
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

function bindInvitePanel(body) {
  body.querySelector('#shareGenBtn')?.addEventListener('click', generateCode);
  body.querySelector('#shareCopyBtn')?.addEventListener('click', copyCode);
  loadLists(body);
}

/** Apre il modale per generare/gestire codici invito (solo proprietario). */
export function openShareModal(trip) {
  if (!canInvite(trip)) return;

  _trip = trip;
  _tripId = trip.id;

  const body = document.createElement('div');
  body.className = 'share-modal';
  body.innerHTML = `<div id="sharePanelInvite">${invitePanelHtml()}</div>`;
  bindInvitePanel(body);

  openModal({ title: t('gal.shareTabInvite'), body });
}

async function generateCode() {
  const perm = document.querySelector('input[name="sharePerm"]:checked')?.value || 'view';
  const btn = document.getElementById('shareGenBtn');
  btn.disabled = true;
  try {
    const payload = await buildShareCodePayload(_tripId, perm);
    const sc = await api.createShareCode(_tripId, {
      permission: payload.permission,
      codeHash: payload.codeHash,
      keyWrap: payload.keyWrap,
      wrapSalt: payload.wrapSalt,
    });
    const box = document.getElementById('shareCodeBox');
    const val = document.getElementById('shareCodeVal');
    box.hidden = false;
    val.textContent = payload.code;
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
      <span class="share-row-meta">${esc(c.permission === 'upload' ? t('gal.sharePermUpload') : t('gal.sharePermView'))}</span>
      <span class="share-row-meta">${esc(t('gal.shareCodeActive'))}</span>
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
