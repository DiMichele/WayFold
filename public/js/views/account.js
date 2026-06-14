/**
 * views/account.js — Impostazioni account (password, email, eliminazione)
 */

import { state } from '../state.js';
import * as api from '../api.js';
import { showToast } from '../ui/toast.js';
import { showVerifyEmail } from '../ui/auth.js';
import { openConfirm } from '../ui/modal.js';
import { t } from '../i18n.js';

const el = id => document.getElementById(id);

export function initAccount() {
  el('accountPassForm').addEventListener('submit', onChangePassword);
  el('accountEmailForm').addEventListener('submit', onSaveEmail);
  el('accountDeleteBtn').addEventListener('click', onDeleteAccount);
}

export function renderAccount() {
  const user = state.user;
  if (!user) return;

  el('accountUsername').textContent = user.username;
  el('accountEmailDisplay').textContent = user.email || '';

  const badge = el('accountEmailBadge');
  const hasEmail = !!user.email;
  el('accountEmailMeta').style.display = hasEmail ? '' : 'none';
  el('accountEmailAdd').style.display = hasEmail ? 'none' : '';

  if (user.email) {
    const verified = user.emailVerified !== false;
    badge.hidden = false;
    badge.textContent = verified ? t('account.emailVerified') : t('account.emailPending');
    badge.className = 'account-badge ' + (verified ? 'account-badge--ok' : 'account-badge--warn');
  } else {
    badge.hidden = true;
    badge.textContent = '';
    badge.className = 'account-badge';
  }

  const danger = el('accountDangerCard');
  if (danger) danger.style.display = '';
}

async function onChangePassword(e) {
  e.preventDefault();
  const current = el('accountCurPass').value;
  const next = el('accountNewPass').value;
  const confirm = el('accountConfPass').value;
  const err = el('accountPassErr');
  err.textContent = '';
  err.classList.remove('show');

  if (!current || !next) {
    err.textContent = t('account.errFill');
    err.classList.add('show');
    return;
  }
  if (next.length < 8) {
    err.textContent = t('auth.errPassword');
    err.classList.add('show');
    return;
  }
  if (next !== confirm) {
    err.textContent = t('account.errMismatch');
    err.classList.add('show');
    return;
  }

  const btn = el('accountPassSubmit');
  btn.disabled = true;
  btn.textContent = t('modal.saving');
  try {
    const updated = await api.changePassword(current, next);
    state.user = updated;
    el('accountCurPass').value = '';
    el('accountNewPass').value = '';
    el('accountConfPass').value = '';
    showToast(t('account.passUpdated'));
  } catch (e) {
    err.textContent = e.message || t('toast.err');
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = t('account.savePass');
  }
}

async function onSaveEmail(e) {
  e.preventDefault();
  const email = el('accountEmailInput').value.trim();
  const err = el('accountEmailErr');
  err.textContent = '';
  err.classList.remove('show');

  if (!email) {
    err.textContent = t('account.errEmail');
    err.classList.add('show');
    return;
  }

  const btn = el('accountEmailSubmit');
  btn.disabled = true;
  btn.textContent = t('modal.saving');
  try {
    const updated = await api.updateEmail(email);
    state.user = updated;
    el('accountEmailInput').value = '';
    renderAccount();
    if (updated.emailVerified === false) {
      showVerifyEmail(updated);
    } else {
      showToast(t('account.emailSaved'));
    }
  } catch (e) {
    err.textContent = e.message || t('toast.err');
    err.classList.add('show');
  } finally {
    btn.disabled = false;
    btn.textContent = t('account.saveEmail');
  }
}

function onDeleteAccount() {
  const password = el('accountDeletePass').value;
  const err = el('accountDeleteErr');
  err.textContent = '';
  err.classList.remove('show');

  if (!password) {
    err.textContent = t('account.errDeletePass');
    err.classList.add('show');
    return;
  }

  openConfirm({
    title: t('account.deleteTitle'),
    message: t('account.deleteMsg'),
    confirmLabel: t('account.deleteConfirm'),
    onConfirm: async () => {
      await api.deleteAccount(password);
      api.invalidatePhotoCache();
      showToast(t('account.deleteDone'));
      location.reload();
    },
  });
}
