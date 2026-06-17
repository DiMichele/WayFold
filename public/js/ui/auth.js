/**
 * ui/auth.js — Pagina di accesso (login / registrazione / verifica email / reset password)
 */

import * as api from '../api.js';
import { t } from '../i18n.js';
import { cryptoOnRegister, cryptoOnLogin } from '../crypto/authCrypto.js';

const el = id => document.getElementById(id);

let _mode = 'login';
let _onSuccess = null;
let _verifyUser = null;
let _forgotUsername = '';

export function initAuth({ onSuccess }) {
  _onSuccess = onSuccess;

  el('authTabLogin').addEventListener('click', () => setMode('login'));
  el('authTabRegister').addEventListener('click', () => setMode('register'));
  el('authForgot').addEventListener('click', () => setMode('forgot-request'));
  el('authBackLogin').addEventListener('click', () => setMode('login'));
  el('authBackCode').addEventListener('click', () => setMode('forgot-request'));
  el('authResendVerify').addEventListener('click', () => resendVerification());

  el('authForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submit();
  });
  el('authForgotForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitForgotRequest();
  });
  el('authResetForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitReset();
  });
  el('authVerifyForm').addEventListener('submit', async e => {
    e.preventDefault();
    await submitVerify();
  });
}

export function refreshAuthLabels() {
  setMode(_mode);
}

export function showVerifyEmail(user) {
  _verifyUser = user;
  setMode('verify-email');
}

function setMode(mode) {
  _mode = mode;
  setError('');

  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const isForgotReq = mode === 'forgot-request';
  const isForgotReset = mode === 'forgot-reset';
  const isVerify = mode === 'verify-email';
  const isMain = isLogin || isRegister;

  el('authTabs').style.display = isMain ? '' : 'none';
  el('authForm').style.display = isMain ? '' : 'none';
  el('authForgotPanel').style.display = isForgotReq ? '' : 'none';
  el('authResetPanel').style.display = isForgotReset ? '' : 'none';
  el('authVerifyPanel').style.display = isVerify ? '' : 'none';

  el('authTabLogin').classList.toggle('on', isLogin);
  el('authTabRegister').classList.toggle('on', isRegister);

  el('authEmailField').style.display = isRegister ? '' : 'none';
  el('authForgotWrap').style.display = isLogin ? '' : 'none';

  el('authSubmit').textContent = isLogin ? t('auth.enter') : t('auth.createAccount');

  if (isForgotReset) {
    el('authResetUser').textContent = _forgotUsername;
    setTimeout(() => el('authCode').focus(), 80);
  } else if (isForgotReq) {
    el('authForgotUser').value = _forgotUsername || el('authUser').value.trim();
    setTimeout(() => el('authForgotUser').focus(), 80);
  } else if (isVerify) {
    el('authVerifyEmail').textContent = _verifyUser?.email || '—';
    setTimeout(() => el('authVerifyCode').focus(), 80);
  }
}

function setError(msg) {
  const err = el('authErr');
  err.textContent = msg;
  err.classList.toggle('show', Boolean(msg));
}

function setForgotError(msg) {
  const err = el('authForgotErr');
  err.textContent = msg;
  err.classList.toggle('show', Boolean(msg));
}

function setResetError(msg) {
  const err = el('authResetErr');
  err.textContent = msg;
  err.classList.toggle('show', Boolean(msg));
}

function setVerifyError(msg) {
  const err = el('authVerifyErr');
  err.textContent = msg;
  err.classList.toggle('show', Boolean(msg));
}

function needsVerification(user) {
  return user && user.emailVerified === false;
}

async function submit() {
  const username = el('authUser').value.trim();
  const password = el('authPass').value;
  const email = el('authEmail').value.trim();
  setError('');

  if (!username || !password) {
    setError(t('auth.errCredentials'));
    return;
  }
  if (_mode === 'register') {
    if (!email) {
      setError(t('auth.errEmail'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.errPassword'));
      return;
    }
  }

  const btn = el('authSubmit');
  btn.disabled = true;
  btn.textContent = t('auth.wait');

  try {
    let user;
    if (_mode === 'login') {
      user = await api.login(username, password);
      await cryptoOnLogin(password, user);
    } else {
      const keys = await cryptoOnRegister(password);
      user = await api.register(username, password, email, keys);
    }
    el('authPass').value = '';
    el('authEmail').value = '';

    if (needsVerification(user)) {
      showVerifyEmail(user);
      return;
    }

    _onSuccess?.(user);
  } catch (e) {
    const fallback = _mode === 'register' ? t('auth.errRegister') : t('auth.errLogin');
    setError(e.message || fallback);
  } finally {
    btn.disabled = false;
    btn.textContent = _mode === 'login' ? t('auth.enter') : t('auth.createAccount');
  }
}

async function submitForgotRequest() {
  const username = el('authForgotUser').value.trim();
  setForgotError('');

  if (!username) {
    setForgotError(t('auth.errUsername'));
    return;
  }

  const btn = el('authForgotSubmit');
  btn.disabled = true;
  btn.textContent = t('auth.wait');

  try {
    await api.forgotPassword(username);
    _forgotUsername = username;
    setMode('forgot-reset');
  } catch (e) {
    setForgotError(e.message || t('auth.errForgot'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('auth.sendCode');
  }
}

async function submitReset() {
  const code = el('authCode').value.trim();
  const password = el('authNewPass').value;
  setResetError('');

  if (!code || !password) {
    setResetError(t('auth.errResetFill'));
    return;
  }
  if (password.length < 8) {
    setResetError(t('auth.errPassword'));
    return;
  }

  const btn = el('authResetSubmit');
  btn.disabled = true;
  btn.textContent = t('auth.wait');

  try {
    await api.resetPassword(_forgotUsername, code, password);
    el('authCode').value = '';
    el('authNewPass').value = '';
    el('authUser').value = _forgotUsername;
    el('authPass').value = '';
    _forgotUsername = '';
    setMode('login');
    setError('');
    el('authHint').textContent = t('auth.resetDone');
  } catch (e) {
    setResetError(e.message || t('auth.errReset'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('auth.resetPass');
  }
}

async function submitVerify() {
  const code = el('authVerifyCode').value.trim();
  setVerifyError('');

  if (!code) {
    setVerifyError(t('auth.errVerifyFill'));
    return;
  }

  const btn = el('authVerifySubmit');
  btn.disabled = true;
  btn.textContent = t('auth.wait');

  try {
    const user = await api.verifyEmail(code);
    el('authVerifyCode').value = '';
    _verifyUser = null;
    _onSuccess?.(user);
    el('authHint').textContent = t('auth.verifyDone');
  } catch (e) {
    setVerifyError(e.message || t('auth.errVerify'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('auth.verifySubmit');
  }
}

async function resendVerification() {
  setVerifyError('');
  const btn = el('authResendVerify');
  btn.disabled = true;

  try {
    await api.resendVerification();
    el('authHint').textContent = t('auth.resendDone');
  } catch (e) {
    setVerifyError(e.message || t('auth.errForgot'));
  } finally {
    btn.disabled = false;
  }
}
