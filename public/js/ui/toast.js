/**
 * ui/toast.js — Notifiche toast
 */

let _timer = null;

const ICON = {
  success: '<path d="M20 6L9 17l-5-5"/>',
  error: '<path d="M18 6 6 18M6 6l12 12"/>',
};

/**
 * @param {string} msg
 * @param {'success'|'error'|'neutral'} [type]
 */
export function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  const svg = el.querySelector('svg');
  el.classList.remove('toast--success', 'toast--error', 'toast--neutral');
  el.classList.add(`toast--${type}`);
  if (svg) {
    if (type === 'neutral') {
      svg.style.display = 'none';
    } else {
      svg.style.display = '';
      svg.innerHTML = ICON[type] || ICON.success;
    }
  }
  document.getElementById('toastTxt').textContent = msg;
  el.classList.add('show');
  clearTimeout(_timer);
  _timer = setTimeout(() => el.classList.remove('show'), 2600);
}
