/**

 * ui/modal.js — Modale generica + form viaggio + conferme

 */



import * as api from '../api.js';
import { initTripKey } from '../crypto/tripKeyVault.js';

import { esc } from '../utils.js';

import { showToast } from './toast.js';
import { bindTripPlaceSuggest } from './placeSuggest.js';

import {
  t, getLang, getMonthValues, getMonthLabels, getTripTypeValues, displayTripType,
} from '../i18n.js';



let _onClose = null;

function focusNoScroll(el) {
  if (!el) return;
  try { el.focus({ preventScroll: true }); }
  catch { el.focus(); }
}



export function initModal() {

  const modal = document.getElementById('modal');

  document.getElementById('modalX').addEventListener('click', closeModal);

  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  document.addEventListener('keydown', e => {

    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();

  });

}



export function openModal({ title, body, onClose = null }) {

  _onClose = onClose;

  document.getElementById('modalTitle').textContent = title;

  const container = document.getElementById('modalBody');

  container.innerHTML = '';

  container.appendChild(body);

  document.getElementById('modal').classList.add('open');

  document.body.classList.add('modal-open');

}



export function closeModal() {

  document.getElementById('modal').classList.remove('open');

  document.body.classList.remove('modal-open');

  if (_onClose) { const fn = _onClose; _onClose = null; fn(); }

}



export function openTripForm({ trip = null, onSaved }) {

  const isEdit = trip !== null;

  const now = new Date();

  const monthValues = getMonthValues();

  const monthLabels = getMonthLabels();

  const defaultMonth = trip?.month ?? monthValues[now.getMonth()];



  const body = document.createElement('div');

  body.className = 'modal-body';

  body.innerHTML = `
    <div class="field">

      <label for="f-dest">${t('modal.dest')}</label>

      <input id="f-dest" type="text" placeholder="${esc(t('modal.destPh'))}" value="${esc(trip?.dest || '')}" maxlength="60" autocomplete="off" spellcheck="false">

      <div class="field-err" id="f-err"></div>

    </div>

    <div class="field">

      <label for="f-country">${t('modal.country')}</label>

      <input id="f-country" type="text" placeholder="${esc(t('modal.countryPh'))}" value="${esc(trip?.country || '')}" maxlength="40" autocomplete="off" spellcheck="false">

    </div>

    <div class="field-row">

      <div class="field">

        <label for="f-year">${t('modal.year')}</label>

        <input id="f-year" type="number" min="1950" max="2100" value="${trip?.year ?? now.getFullYear()}">

      </div>

      <div class="field">

        <label for="f-month">${t('modal.month')}</label>

        <select id="f-month">

          ${monthValues.map((m, i) => `<option value="${m}" ${m === defaultMonth ? 'selected' : ''}>${monthLabels[i]}</option>`).join('')}

        </select>

      </div>

    </div>

    <div class="field-row">

      <div class="field">

        <label for="f-days">${t('modal.days')}</label>

        <input id="f-days" type="number" min="1" max="365" placeholder="${esc(t('modal.daysPh'))}" value="${trip?.days ?? ''}">

      </div>

      <div class="field">

        <label for="f-type">${t('modal.type')}</label>

        <select id="f-type">

          <option value="">—</option>

          ${getTripTypeValues().map(v => `<option value="${esc(v)}" ${v === trip?.type ? 'selected' : ''}>${esc(displayTripType(v))}</option>`).join('')}

        </select>

      </div>

    </div>

    <div class="field">

      <label for="f-tags">${t('modal.tags')}</label>

      <input id="f-tags" type="text" placeholder="${esc(t('modal.tagsPh'))}" value="${esc((trip?.tags || []).join(', '))}">

      <div class="field-hint">${t('modal.tagsHint')}</div>

    </div>

    <div class="modal-actions">

      <button class="modal-btn s" id="f-cancel">${t('modal.cancel')}</button>

      <button class="modal-btn p" id="f-save">${isEdit ? t('modal.save') : t('modal.create')}</button>

    </div>

  `;



  const get = id => body.querySelector('#' + id);
  bindTripPlaceSuggest(get('f-dest'), get('f-country'));
  get('f-cancel').addEventListener('click', closeModal);



  get('f-save').addEventListener('click', async () => {

    const dest = get('f-dest').value.trim();

    const err = get('f-err');

    err.classList.remove('show');

    if (!dest) {

      err.textContent = t('modal.destRequired');

      err.classList.add('show');

      focusNoScroll(get('f-dest'));

      return;

    }



    const payload = {
      dest,
      country: get('f-country').value.trim() || null,
      year: get('f-year').value ? Number(get('f-year').value) : null,
      month: get('f-month').value,
      days: get('f-days').value ? Number(get('f-days').value) : null,
      type: get('f-type').value || null,
      tags: get('f-tags').value,
      lang: getLang(),
    };



    const btn = get('f-save');

    btn.disabled = true;

    btn.textContent = t('modal.saving');

    try {

      const saved = isEdit

        ? await api.updateTrip(trip.id, payload)

        : await api.createTrip(payload);

      if (!isEdit) await initTripKey(saved.id);

      closeModal();

      showToast(isEdit ? t('toast.tripUpdated') : t('toast.tripAdded', { dest: saved.dest }));

      onSaved?.(saved);

    } catch (e) {

      err.textContent = e.message || t('modal.saveErr');

      err.classList.add('show');

      btn.disabled = false;

      btn.textContent = isEdit ? t('modal.save') : t('modal.create');

    }

  });



  openModal({ title: isEdit ? t('modal.editTrip') : t('modal.newTrip'), body });

  setTimeout(() => focusNoScroll(get('f-dest')), 80);

}



export function openConfirm({ title, message, confirmLabel, onConfirm }) {

  const body = document.createElement('div');

  body.className = 'modal-body';

  body.innerHTML = `

    <div class="modal-msg">${message}</div>

    <div class="modal-actions">

      <button type="button" class="modal-btn s" id="c-cancel">${t('modal.cancel')}</button>

      <button type="button" class="modal-btn danger" id="c-ok">${esc(confirmLabel ?? t('modal.delete'))}</button>

    </div>

  `;

  body.querySelector('#c-cancel').addEventListener('click', closeModal);

  body.querySelector('#c-ok').addEventListener('click', async () => {

    const btn = body.querySelector('#c-ok');

    btn.disabled = true;

    try {

      await onConfirm();

      closeModal();

    } catch (e) {

      showToast(e.message || t('toast.err'), 'error');

      btn.disabled = false;

    }

  });

  openModal({ title, body });

}

