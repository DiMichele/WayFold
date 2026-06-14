/**
 * placeSuggest.js — Autocomplete destinazione/paese nel form viaggio
 */

import * as api from '../api.js';
import { esc } from '../utils.js';
import { t } from '../i18n.js';

const DEBOUNCE_MS = 320;

function wrapInput(input) {
  if (input.parentElement?.classList.contains('suggest-wrap')) return input.parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'suggest-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'suggest-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);
  return wrap;
}

/**
 * @param {HTMLInputElement} destInput
 * @param {HTMLInputElement} countryInput
 */
export function bindTripPlaceSuggest(destInput, countryInput) {
  const destWrap = wrapInput(destInput);
  const countryWrap = wrapInput(countryInput);
  const destList = destWrap.querySelector('.suggest-list');
  const countryList = countryWrap.querySelector('.suggest-list');

  let destTimer = null;
  let countryTimer = null;
  let destReq = 0;
  let countryReq = 0;
  let activeField = null;
  let activeIndex = -1;
  let currentItems = [];

  function hideAll() {
    destList.hidden = true;
    countryList.hidden = true;
    destList.innerHTML = '';
    countryList.innerHTML = '';
    activeField = null;
    activeIndex = -1;
    currentItems = [];
  }

  function applySelection(item, field) {
    if (field === 'dest') {
      if (item.dest) destInput.value = item.dest;
      if (item.country) countryInput.value = item.country;
    } else if (item.dest && item.country) {
      destInput.value = item.dest;
      countryInput.value = item.country;
    } else if (item.country) {
      countryInput.value = item.country;
    }
    hideAll();
  }

  function renderList(listEl, items, field) {
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.innerHTML = `<li class="suggest-empty">${esc(t('modal.placesEmpty'))}</li>`;
      listEl.hidden = false;
      return;
    }
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'suggest-item';
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      li.innerHTML = `<span class="suggest-item-label">${esc(item.label)}</span>`;
      li.addEventListener('mousedown', e => {
        e.preventDefault();
        applySelection(item, field);
      });
      listEl.appendChild(li);
    });
    listEl.hidden = false;
  }

  function highlight(listEl) {
    listEl.querySelectorAll('.suggest-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
    });
  }

  async function search(field) {
    const isDest = field === 'dest';
    const q = (isDest ? destInput.value : countryInput.value).trim();
    const listEl = isDest ? destList : countryList;
    const reqId = isDest ? ++destReq : ++countryReq;

    if (q.length < 2) {
      hideAll();
      return;
    }

    listEl.innerHTML = `<li class="suggest-loading">${esc(t('modal.placesLoading'))}</li>`;
    listEl.hidden = false;
    activeField = field;
    activeIndex = -1;

    try {
      const items = await api.fetchPlaces({
        q,
        field,
        dest: destInput.value.trim(),
        country: countryInput.value.trim(),
      });
      if (reqId !== (isDest ? destReq : countryReq)) return;

      currentItems = items;
      if (isDest) countryList.hidden = true;
      else destList.hidden = true;
      renderList(listEl, items, field);
    } catch {
      if (reqId !== (isDest ? destReq : countryReq)) return;
      listEl.innerHTML = `<li class="suggest-empty">${esc(t('modal.placesEmpty'))}</li>`;
      listEl.hidden = false;
    }
  }

  function onInput(field) {
    if (field === 'dest') {
      clearTimeout(destTimer);
      destTimer = setTimeout(() => search('dest'), DEBOUNCE_MS);
    } else {
      clearTimeout(countryTimer);
      countryTimer = setTimeout(() => search('country'), DEBOUNCE_MS);
    }
  }

  function onKeydown(e, field) {
    const listEl = field === 'dest' ? destList : countryList;
    if (listEl.hidden || !currentItems.length || activeField !== field) {
      if (e.key === 'Escape') hideAll();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentItems.length - 1);
      highlight(listEl);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight(listEl);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      applySelection(currentItems[activeIndex], field);
    } else if (e.key === 'Escape') {
      hideAll();
    }
  }

  destInput.addEventListener('input', () => onInput('dest'));
  countryInput.addEventListener('input', () => onInput('country'));
  destInput.addEventListener('keydown', e => onKeydown(e, 'dest'));
  countryInput.addEventListener('keydown', e => onKeydown(e, 'country'));
  destInput.addEventListener('blur', () => setTimeout(hideAll, 150));
  countryInput.addEventListener('blur', () => setTimeout(hideAll, 150));
}
