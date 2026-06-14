/**
 * passwordToggle.js — Mostra/nascondi password su tutti i campi type="password"
 */

import { t } from '../i18n.js';

const EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_CLOSED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function setVisible(input, btn, visible) {
  input.type = visible ? 'text' : 'password';
  btn.innerHTML = visible ? EYE_CLOSED : EYE_OPEN;
  btn.setAttribute('aria-label', visible ? t('password.hide') : t('password.show'));
  btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

function wrapPasswordInput(input) {
  if (input.closest('.password-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'password-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'password-toggle';
  setVisible(input, btn, false);

  btn.addEventListener('click', () => {
    setVisible(input, btn, input.type === 'password');
  });

  input.addEventListener('input', () => {
    if (!input.value && input.type === 'text') setVisible(input, btn, false);
  });

  wrap.appendChild(btn);
}

export function initPasswordToggle(root = document) {
  root.querySelectorAll('input[type="password"]').forEach(wrapPasswordInput);
}

export function refreshPasswordToggleLabels(root = document) {
  root.querySelectorAll('.password-wrap').forEach(wrap => {
    const input = wrap.querySelector('input');
    const btn = wrap.querySelector('.password-toggle');
    if (!input || !btn) return;
    const visible = input.type === 'text';
    btn.setAttribute('aria-label', visible ? t('password.hide') : t('password.show'));
  });
}
