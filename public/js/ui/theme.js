/**
 * ui/theme.js — Tema dark/light con persistenza
 */

const STORAGE_KEY = 'wf-theme';
const TOGGLE_IDS = ['themeToggle', 'authThemeToggle'];

function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  for (const id of TOGGLE_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const moon = btn.querySelector('.icon-moon');
    const sun = btn.querySelector('.icon-sun');
    if (moon) moon.style.display = theme === 'light' ? 'none' : '';
    if (sun) sun.style.display = theme === 'light' ? '' : 'none';
  }
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* storage bloccato */ }
  const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  apply(saved === 'light' || saved === 'dark' ? saved : system);

  for (const id of TOGGLE_IDS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      apply(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage bloccato */ }
    });
  }
}
