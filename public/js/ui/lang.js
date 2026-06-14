/**
 * ui/lang.js — Selettore lingua
 */

import { getLang, setLang, emitLangChange, t } from '../i18n.js';

const FLAG_CODES = { it: 'IT', en: 'GB', fr: 'FR', es: 'ES', de: 'DE' };

const GROUPS = [
  { toggleId: 'langToggle', menuId: 'langMenu', flagId: 'langFlag' },
  { toggleId: 'authLangToggle', menuId: 'authLangMenu', flagId: 'authLangFlag' },
];

export function initLang() {
  document.addEventListener('click', () => {
    document.querySelectorAll('.lang-menu.open').forEach(m => m.classList.remove('open'));
  });

  for (const group of GROUPS) {
    bindLangGroup(group);
  }

  updateUI();
}

function bindLangGroup({ toggleId, menuId, flagId }) {
  const btn = document.getElementById(toggleId);
  const menu = document.getElementById(menuId);
  if (!btn || !menu) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.contains('open');
    document.querySelectorAll('.lang-menu.open').forEach(m => m.classList.remove('open'));
    if (!open) menu.classList.add('open');
  });

  menu.querySelectorAll('[data-lang]').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      const lang = opt.dataset.lang;
      if (lang === getLang()) {
        menu.classList.remove('open');
        return;
      }
      setLang(lang);
      updateUI();
      document.querySelectorAll('.lang-menu.open').forEach(m => m.classList.remove('open'));
      emitLangChange();
    });
  });
}

function updateUI() {
  const lang = getLang();
  const code = FLAG_CODES[lang] || 'IT';
  document.querySelectorAll('#langFlag, #authLangFlag').forEach(el => {
    el.textContent = code;
  });
  document.querySelectorAll('.lang-opt').forEach(opt => {
    opt.classList.toggle('on', opt.dataset.lang === lang);
    opt.setAttribute('aria-selected', opt.dataset.lang === lang ? 'true' : 'false');
  });
  document.querySelectorAll('#langToggle, #authLangToggle').forEach(btn => {
    btn.setAttribute('aria-label', t('lang'));
  });
}
