import { onLangChange } from "../shared/i18n.ts";
import { el, setCurrentPolicy } from "./common.ts";
import { forgetTransfers } from "./store.ts";
import { AUTOMATIC_POLICY } from "./policy.ts";
import { isRxRunning, mountRx, refreshRxText, stopRx, unmountRx } from "./rx-controller.ts";
import { isTxRunning, mountTx, refreshTxText, stopTx, unmountTx } from "./tx-controller.ts";

type Role = "tx" | "rx";

const ROLE_KEY = "wf-diode-role";
const PAY_KEY = "wf-diode-pay";

type Pay = "chat" | "file" | "video";

let role: Role = "tx";
let wired = false;
let mounted = false;

function savedRole(): Role {
  try {
    return localStorage.getItem(ROLE_KEY) === "rx" ? "rx" : "tx";
  } catch {
    return "tx";
  }
}

function setRole(next: Role): void {
  if (next === role && mounted) {
    syncRoleUi();
    if (next === "tx" && !isTxRunning()) void mountTx();
    return;
  }
  if (next === "rx" && isTxRunning()) stopTx();
  if (next === "tx" && isRxRunning()) stopRx();
  role = next;
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    /* ignore */
  }
  syncRoleUi();
  if (role === "tx") void mountTx();
  else void mountRx();
}

function syncRoleUi(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-diode-role]").forEach((btn) => {
    const active = btn.dataset.diodeRole === role;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  const tx = el("dx-panel");
  const rx = el("dr-panel");
  if (tx) tx.hidden = role !== "tx";
  if (rx) rx.hidden = role !== "rx";
  document.body.classList.toggle("diode-tx", role === "tx");
  document.body.classList.toggle("diode-rx", role === "rx");
}

function savedPay(): Pay {
  try {
    const value = localStorage.getItem(PAY_KEY);
    if (value === "file" || value === "video" || value === "chat") return value;
  } catch {
    /* ignore */
  }
  return "chat";
}

function setPay(next: Pay): void {
  try {
    localStorage.setItem(PAY_KEY, next);
  } catch {
    /* ignore */
  }
  document.querySelectorAll<HTMLButtonElement>("[data-diode-pay]").forEach((btn) => {
    const active = btn.dataset.diodePay === next;
    btn.classList.toggle("is-on", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>("[data-pay-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.payPanel !== next;
  });
}

function wireOnce(): void {
  if (wired) return;
  wired = true;
  document.querySelectorAll<HTMLButtonElement>("[data-diode-role]").forEach((btn) => {
    btn.addEventListener("click", () => setRole(btn.dataset.diodeRole === "rx" ? "rx" : "tx"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-diode-pay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.diodePay;
      if (next === "chat" || next === "file" || next === "video") setPay(next);
    });
  });
  setPay(savedPay());
  onLangChange(() => {
    if (!mounted) return;
    refreshTxText();
    refreshRxText();
  });
}

export async function mountDiode(): Promise<void> {
  wireOnce();
  mounted = true;
  role = savedRole();
  syncRoleUi();
  setCurrentPolicy(AUTOMATIC_POLICY);
  void forgetTransfers().catch(() => undefined);
  if (role === "tx") await mountTx();
  else await mountRx();
}

export function unmountDiode(): void {
  mounted = false;
  unmountTx();
  unmountRx();
  document.body.classList.remove("diode-tx", "diode-rx");
}
