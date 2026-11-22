import { onLangChange } from "../shared/i18n.ts";
import { el, setCurrentPolicy } from "./common.ts";
import { AUTOMATIC_POLICY } from "./policy.ts";
import { isRxRunning, mountRx, refreshRxText, stopRx, unmountRx } from "./rx-controller.ts";
import { isTxRunning, mountTx, refreshTxText, stopTx, unmountTx } from "./tx-controller.ts";

type Role = "tx" | "rx";

const ROLE_KEY = "wf-diode-role";

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

function wireOnce(): void {
  if (wired) return;
  wired = true;
  document.querySelectorAll<HTMLButtonElement>("[data-diode-role]").forEach((btn) => {
    btn.addEventListener("click", () => setRole(btn.dataset.diodeRole === "rx" ? "rx" : "tx"));
  });
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
  if (role === "tx") await mountTx();
  else await mountRx();
}

export function unmountDiode(): void {
  mounted = false;
  unmountTx();
  unmountRx();
  document.body.classList.remove("diode-tx", "diode-rx");
}
