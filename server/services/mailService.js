/**
 * mailService.js — Invio email (recupero password, benvenuto, eliminazione account)
 *
 * Richiede SMTP_* nel .env. Con MAIL_LOG_CODES=true e SMTP assente,
 * le email di sviluppo vengono stampate in console.
 */

const nodemailer = require('nodemailer');
const config = require('../config');

let _transport = null;

function isConfigured() {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
}

function getTransport() {
  if (_transport) return _transport;
  if (!isConfigured()) return null;
  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  return _transport;
}

async function sendMail({ to, subject, text, devLabel }) {
  if (!isConfigured()) {
    if (config.MAIL_LOG_CODES) {
      console.log(`📧  [dev] ${devLabel} → ${to}\n${text}`);
      return;
    }
    return false;
  }

  const from = config.SMTP_FROM || config.SMTP_USER;
  await getTransport().sendMail({ from, to, subject, text });
  return true;
}

async function sendPasswordResetEmail({ to, username, code }) {
  const subject = 'Wayfold — Reset password';
  const text = [
    `Ciao ${username},`,
    '',
    'abbiamo ricevuto una richiesta per reimpostare la password del tuo account Wayfold.',
    '',
    'Usa questo codice per continuare:',
    '',
    code,
    '',
    'Il codice è valido per 15 minuti.',
    '',
    'Se non hai richiesto tu il reset della password, puoi ignorare questa email.',
    '',
    'Per sicurezza, non condividere questo codice con nessuno.',
    '',
    'Il team di Wayfold',
  ].join('\n');

  if (!isConfigured()) {
    if (config.MAIL_LOG_CODES) {
      console.log(`📧  [dev] Reset password per "${username}" → ${to}: ${code}`);
      return;
    }
    throw Object.assign(new Error('Invio email non configurato sul server'), { status: 503 });
  }

  await sendMail({ to, subject, text, devLabel: `Reset password "${username}"` });
}

async function sendAdminPasswordResetEmail({ to, username, password }) {
  const subject = 'Wayfold — Password reimpostata';
  const text = [
    `Ciao ${username},`,
    '',
    'la password del tuo account Wayfold è stata reimpostata.',
    '',
    'Puoi accedere usando questa password temporanea:',
    '',
    password,
    '',
    'Per proteggere il tuo account, ti consigliamo di cambiarla dopo l\'accesso dalle impostazioni del profilo.',
    '',
    'Se non ti aspettavi questa modifica, ti invitiamo a contattarci per verificare la sicurezza del tuo account.',
    '',
    'A presto,',
    'Il team di Wayfold',
  ].join('\n');

  if (!isConfigured()) {
    if (config.MAIL_LOG_CODES) {
      console.log(`📧  [dev] Reset admin per "${username}" → ${to}: ${password}`);
      return;
    }
    throw Object.assign(new Error('Invio email non configurato sul server'), { status: 503 });
  }

  await sendMail({ to, subject, text, devLabel: `Reset admin "${username}"` });
}

async function sendEmailVerification({ to, username, code }) {
  const subject = 'Wayfold — Verifica email';
  const text = [
    `Ciao ${username},`,
    '',
    'grazie per esserti registrato su Wayfold.',
    '',
    'Per completare la creazione del tuo account, inserisci questo codice di verifica nell\'app:',
    '',
    code,
    '',
    'Il codice è valido per 15 minuti.',
    '',
    'Se non hai richiesto tu la registrazione a Wayfold, puoi ignorare questa email.',
    '',
    'A presto,',
    'Il team di Wayfold',
  ].join('\n');

  if (!isConfigured()) {
    if (config.MAIL_LOG_CODES) {
      console.log(`📧  [dev] Verifica email per "${username}" → ${to}: ${code}`);
      return;
    }
    throw Object.assign(new Error('Invio email non configurato sul server'), { status: 503 });
  }

  await sendMail({ to, subject, text, devLabel: `Verifica email "${username}"` });
}

async function sendWelcomeEmail({ to, username }) {
  const subject = 'wayfold — Benvenuto!';
  const text = [
    `Ciao ${username},`,
    '',
    'Il tuo account su wayfold è stato creato con successo.',
    'Puoi iniziare subito a creare viaggi e caricare le tue foto.',
    '',
    'Buon viaggio!',
  ].join('\n');

  const sent = await sendMail({ to, subject, text, devLabel: `Benvenuto "${username}"` });
  if (!sent) {
    console.warn(`⚠️  Email benvenuto non inviata a "${username}" (SMTP non configurato)`);
  }
}

async function sendAccountDeletedEmail({ to, username }) {
  const subject = 'Wayfold — Account eliminato';
  const text = [
    'Ciao,',
    '',
    'l\'eliminazione del tuo account Wayfold è avvenuta con successo.',
    '',
    'Tutti i dati associati al tuo account, inclusi foto, video e contenuti caricati, sono stati eliminati.',
    '',
    'Ci dispiace vederti andare via, ma ti ringraziamo per aver condiviso con Wayfold una parte dei tuoi viaggi e dei tuoi ricordi.',
    '',
    'Speriamo di poterti riaccogliere in futuro, quando vorrai raccontare nuove avventure.',
    '',
    'Il team di Wayfold',
  ].join('\n');

  const sent = await sendMail({ to, subject, text, devLabel: `Eliminazione account "${username}"` });
  if (!sent && !config.MAIL_LOG_CODES) {
    console.warn(`⚠️  Email eliminazione account non inviata a "${username}" (SMTP non configurato)`);
  }
}

module.exports = {
  isConfigured,
  sendPasswordResetEmail,
  sendAdminPasswordResetEmail,
  sendEmailVerification,
  sendWelcomeEmail,
  sendAccountDeletedEmail,
};
