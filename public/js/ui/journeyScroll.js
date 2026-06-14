/**
 * ui/journeyScroll.js — Scroll verticale curato per la lista «Tutte le tappe»
 */

const bound = new WeakMap();

function updateScrollState(root) {
  const track = root.querySelector('.journey-scroll-track');
  if (!track) return;

  const { scrollTop, scrollHeight, clientHeight } = track;
  const overflow = scrollHeight > clientHeight + 2;

  root.classList.toggle('is-overflowing', overflow);
  root.classList.toggle('can-scroll-up', overflow && scrollTop > 6);
  root.classList.toggle('can-scroll-down', overflow && scrollTop + clientHeight < scrollHeight - 6);
  root.classList.toggle('hint-scroll', overflow && scrollTop < 28 && scrollTop + clientHeight < scrollHeight - 6);
}

export function bindJourneyScroll(root) {
  if (!root || bound.has(root)) return;
  const track = root.querySelector('.journey-scroll-track');
  if (!track) return;

  const onScroll = () => updateScrollState(root);
  track.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(onScroll).observe(track);

  bound.set(root, onScroll);
  onScroll();
}

export function initJourneyScrolls() {
  document.querySelectorAll('.journey-scroll').forEach(bindJourneyScroll);
}

/** Da chiamare dopo ogni render della lista. */
function scheduleScrollStateUpdate(root) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => updateScrollState(root));
  });
}

export function refreshJourneyScroll(listEl) {
  const root = listEl?.closest('.journey-scroll');
  if (!root) return;
  if (!bound.has(root)) bindJourneyScroll(root);
  scheduleScrollStateUpdate(root);
}

/** Ricalcola tutti gli scroll viaggi nella vista attiva (dopo switch o layout). */
export function refreshJourneyScrollsInView(viewName) {
  const view = document.getElementById('view-' + viewName);
  if (!view) return;
  view.querySelectorAll('.journey-scroll').forEach(root => {
    if (!bound.has(root)) bindJourneyScroll(root);
    scheduleScrollStateUpdate(root);
  });
}
