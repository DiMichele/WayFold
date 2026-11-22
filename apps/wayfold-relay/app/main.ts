import { applyStatic, onLangChange, t } from "../shared/i18n.ts";
import { registerServiceWorker } from "../shared/register-sw.ts";
import { initChrome } from "../shared/ui.ts";
import { mountReceive, unmountReceive } from "../receive/controller.ts";
import { isSendStreaming, mountSend, resumeSend, suspendSend, unmountSend } from "../send/controller.ts";
import { mountDiode, unmountDiode } from "../diode/controller.ts";
import { ensureDiodeView } from "../diode/markup.ts";
import { mountNet, unmountNet } from "../net/controller.ts";
import { ensureNetView } from "../net/markup.ts";

export type Mode = "home" | "send" | "receive" | "diode" | "net";

let mode: Mode = "home";
let sendMounted = false;
let receiveMounted = false;
let diodeMounted = false;
let netMounted = false;

function isMode(value: string | undefined): value is Mode {
  return value === "home" || value === "send" || value === "receive" || value === "diode" || value === "net";
}

function inSubdir(): boolean {
  return /\/(send|receive)\/?$/.test(location.pathname.replace(/\/index\.html$/, "/"));
}

function pathFor(next: Mode): string {
  // Un file aperto dal disco non ha /send/ e /receive/: l'hash resta sullo stesso file.
  if (location.protocol === "file:") {
    const base = location.pathname + location.search;
    return next === "home" ? base : `${base}#${next}`;
  }
  const sub = inSubdir();
  if (next === "home") return sub ? "../" : "./";
  if (next === "diode") return sub ? "../#diode" : "./#diode";
  if (next === "net") return sub ? "../#net" : "./#net";
  if (next === "send") return sub ? "../send/" : "./send/";
  return sub ? "../receive/" : "./receive/";
}

function modeFromPath(): Mode {
  const hash = location.hash.replace(/^#/, "");
  if (location.protocol === "file:") {
    if (hash === "send" || hash === "receive" || hash === "diode" || hash === "net") return hash;
    return "home";
  }
  if (hash === "diode") return "diode";
  if (hash === "net") return "net";
  const path = location.pathname.replace(/\/index\.html$/, "/");
  if (/\/receive\/?$/.test(path)) return "receive";
  if (/\/send\/?$/.test(path)) return "send";
  return "home";
}

function setTitle(): void {
  if (mode === "send") document.title = t("page.send");
  else if (mode === "receive") document.title = t("page.receive");
  else if (mode === "diode") document.title = t("page.diode");
  else if (mode === "net") document.title = t("page.net");
  else document.title = t("page.home");
}

function showView(el: HTMLElement | null, show: boolean): void {
  if (!el) return;
  el.classList.remove("is-entering");
  if (!show) {
    el.hidden = true;
    return;
  }
  const wasHidden = el.hidden;
  el.hidden = false;
  if (wasHidden) {
    // Forza reflow poi anima senza opacity (evita flash su mobile)
    void el.offsetWidth;
    el.classList.add("is-entering");
    const done = () => el.classList.remove("is-entering");
    el.addEventListener("animationend", done, { once: true });
    window.setTimeout(done, 280);
  }
}

function syncChrome(): void {
  document.body.dataset.mode = mode;
  document.body.classList.toggle("role-home", mode === "home");
  document.body.classList.toggle("role-send", mode === "send");
  document.body.classList.toggle("role-receive", mode === "receive");
  document.body.classList.toggle("role-diode", mode === "diode");
  document.body.classList.toggle("role-net", mode === "net");

  showView(document.getElementById("view-home"), mode === "home");
  showView(document.getElementById("view-send"), mode === "send");
  showView(document.getElementById("view-receive"), mode === "receive");
  showView(document.getElementById("view-diode"), mode === "diode");
  showView(document.getElementById("view-net"), mode === "net");

  document.querySelectorAll<HTMLElement>("[data-mode-btn]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.modeBtn === mode);
    btn.setAttribute("aria-pressed", btn.dataset.modeBtn === mode ? "true" : "false");
  });

  const modeNav = document.getElementById("mode-nav");
  if (modeNav) modeNav.hidden = false;

  setTitle();
}

function ensureMounted(next: Mode): void {
  if (next === "send") {
    if (!sendMounted) {
      mountSend();
      sendMounted = true;
    } else {
      resumeSend();
    }
  } else if (sendMounted) {
    if (next === "home" && !isSendStreaming()) {
      unmountSend();
      sendMounted = false;
    } else {
      // Trasmissione in corso: sospendi senza distruggere la sessione QR.
      suspendSend();
    }
  }

  if (next === "receive") {
    if (!receiveMounted) {
      mountReceive();
      receiveMounted = true;
    }
  } else if (receiveMounted) {
    unmountReceive();
    receiveMounted = false;
  }

  if (next === "diode") {
    if (!diodeMounted) {
      void mountDiode();
      diodeMounted = true;
    }
  } else if (diodeMounted) {
    unmountDiode();
    diodeMounted = false;
  }

  if (next === "net") {
    if (!netMounted) {
      mountNet();
      netMounted = true;
    }
  } else if (netMounted) {
    unmountNet();
    netMounted = false;
  }
}

export function setMode(next: Mode, push = true): void {
  if (next === mode && (next === "home" || document.body.dataset.mode === next)) {
    ensureMounted(next);
    syncChrome();
    return;
  }
  mode = next;
  ensureMounted(next);
  syncChrome();
  if (push) {
    history.pushState({ mode: next }, "", pathFor(next));
  }
}

function bindUi(): void {
  document.querySelectorAll<HTMLElement>("[data-mode-btn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
      const next = btn.dataset.modeBtn;
      if (isMode(next)) setMode(next);
    });
  });

  document.querySelectorAll<HTMLAnchorElement>("a[data-mode-link]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
      const next = a.dataset.modeLink;
      if (isMode(next)) setMode(next);
    });
  });

  window.addEventListener("popstate", () => {
    mode = modeFromPath();
    ensureMounted(mode);
    syncChrome();
  });
}

/** Come wayfold.xyz: resta visibile durante il boot, poi fade-out (min ~850ms). */
async function hideLoader(): Promise<void> {
  const ld = document.getElementById("ld");
  if (!ld) return;
  const minVisibleMs = 850;
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch {
    /* ignore */
  }
  const remaining = Math.max(0, minVisibleMs - performance.now());
  if (remaining > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, remaining);
    });
  }
  ld.classList.add("gone");
}

ensureDiodeView();
ensureNetView();
initChrome();
bindUi();
mode = modeFromPath();
ensureMounted(mode);
syncChrome();
onLangChange(() => {
  applyStatic();
  setTitle();
});
void hideLoader();
void registerServiceWorker();
