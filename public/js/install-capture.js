/** Cattura beforeinstallprompt prima del caricamento dei moduli ES (richiesto dalla CSP). */
window.__wfBip = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__wfBip = e;
  window.dispatchEvent(new Event('wf:installready'));
});
