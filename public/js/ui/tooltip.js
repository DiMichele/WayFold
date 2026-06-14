/**
 * ui/tooltip.js — Tooltip custom globali (sostituiscono il title nativo del browser)
 */

const POSITIONS = new Set(['top', 'bottom']);

function inferPosition(el) {
  if (el.classList.contains('ui-tip--top')) return 'top';
  if (el.classList.contains('ui-tip--bottom')) return 'bottom';
  if (el.classList.contains('gcell-cover')) return 'top';
  if (el.closest('.side-foot, .side, .lb-toolbar, .lb-top, .gal-actions')) return 'top';
  return 'bottom';
}

function ensureLabel(el) {
  let label = el.querySelector(':scope > .ui-tip-label');
  if (!label) {
    label = document.createElement('span');
    label.className = 'ui-tip-label';
    label.setAttribute('role', 'tooltip');
    el.appendChild(label);
  }
  return label;
}

/**
 * Applica o aggiorna il tooltip custom su un elemento.
 * @param {HTMLElement} el
 * @param {string} text
 * @param {{ position?: 'top'|'bottom' }} [opts]
 */
export function setTip(el, text, { position } = {}) {
  if (!el) return;
  const tip = String(text ?? '').trim();
  if (!tip) {
    el.removeAttribute('title');
    delete el.dataset.tip;
    return;
  }

  el.removeAttribute('title');
  el.dataset.tip = tip;
  el.classList.add('ui-tip');

  const pos = POSITIONS.has(position) ? position : inferPosition(el);
  el.classList.remove('ui-tip--top', 'ui-tip--bottom');
  el.classList.add(`ui-tip--${pos}`);

  ensureLabel(el).textContent = tip;
  el.dataset.tipUpgraded = '1';
}

function upgradeFromTitle(el) {
  if (!(el instanceof HTMLElement)) return;
  if (el.closest('[data-tip-skip]')) return;
  const text = el.getAttribute('title')?.trim();
  if (!text) return;
  setTip(el, text);
}

/** Converte tutti i title presenti nel sottoalbero. */
export function upgradeTooltips(root = document) {
  root.querySelectorAll('[title]').forEach(upgradeFromTitle);
}

let _observer = null;

/** Avvio: scan iniziale + osservatore per elementi futuri. */
export function initTooltips() {
  upgradeTooltips();

  if (_observer) return;
  _observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'title') {
        upgradeFromTitle(m.target);
        continue;
      }
      if (m.type !== 'childList') continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.hasAttribute?.('title')) upgradeFromTitle(n);
        n.querySelectorAll?.('[title]').forEach(upgradeFromTitle);
      }
    }
  });
  _observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title'],
  });
}
