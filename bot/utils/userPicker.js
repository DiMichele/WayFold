/**
 * userPicker.js — Tastiera inline per scegliere un utente
 */

const db = require('../../server/db');

const PAGE_SIZE = 24;

function buildUserKeyboard(users, action, page = 0) {
  const start = page * PAGE_SIZE;
  const slice = users.slice(start, start + PAGE_SIZE);
  const rows = [];

  for (let i = 0; i < slice.length; i += 3) {
    rows.push(
      slice.slice(i, i + 3).map(u => ({
        text: u.username,
        callback_data: `pick:${action}:${u.username}`.slice(0, 64),
      }))
    );
  }

  const nav = [];
  if (page > 0) {
    nav.push({ text: 'Precedente', callback_data: `page:${action}:${page - 1}` });
  }
  if (start + PAGE_SIZE < users.length) {
    nav.push({ text: 'Successiva', callback_data: `page:${action}:${page + 1}` });
  }
  if (nav.length) rows.push(nav);

  return { inline_keyboard: rows };
}

function usersForPicker(query) {
  const q = String(query || '').trim();
  return q.length >= 1 ? db.searchUsers(q) : db.getAllUsers();
}

function userButtonLabel(user) {
  const { count } = db.getUserUsage(user.id);
  return { username: user.username, photos: count };
}

module.exports = { buildUserKeyboard, usersForPicker, userButtonLabel, PAGE_SIZE };
