/**
 * Canonicalizzazione email per deduplicazione (Gmail alias, punti, googlemail.com).
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function canonicalEmail(email) {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) return raw;

  const at = raw.lastIndexOf('@');
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);

  if (domain === 'googlemail.com') domain = 'gmail.com';

  if (GMAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf('+');
    if (plus !== -1) local = local.slice(0, plus);
    local = local.replace(/\./g, '');
  }

  return `${local}@${domain}`;
}

function emailsMatch(a, b) {
  if (!a || !b) return false;
  return canonicalEmail(a) === canonicalEmail(b);
}

module.exports = { canonicalEmail, emailsMatch };
