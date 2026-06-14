/**
 * sessionStore.js — Store sessioni su file per express-session
 *
 * Una sessione = un file JSON in sessions/. Gli ID sessione sono generati
 * da express-session (crittograficamente sicuri); il nome file viene
 * sanitizzato comunque per difesa in profondità.
 * Le sessioni scadute vengono ripulite ogni ora.
 */

const fs = require('fs');
const path = require('path');
const { Store } = require('express-session');
const config = require('../config');

const DIR = config.SESSIONS_DIR;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

class FileSessionStore extends Store {
  constructor() {
    super();
    fs.mkdirSync(DIR, { recursive: true });
    setInterval(() => this._cleanup(), 60 * 60 * 1000).unref();
  }

  _file(sid) {
    if (!SAFE_ID.test(sid)) return null;
    return path.join(DIR, sid + '.json');
  }

  get(sid, cb) {
    const file = this._file(sid);
    if (!file) return cb(null, null);
    fs.readFile(file, 'utf8', (err, raw) => {
      if (err) return cb(null, null);
      try {
        const sess = JSON.parse(raw);
        const expires = sess.cookie?.expires;
        if (expires && new Date(expires) < new Date()) {
          this.destroy(sid, () => cb(null, null));
          return;
        }
        cb(null, sess);
      } catch {
        cb(null, null);
      }
    });
  }

  set(sid, sess, cb) {
    const file = this._file(sid);
    if (!file) return cb?.(new Error('Session ID non valido'));
    fs.writeFile(file, JSON.stringify(sess), err => cb?.(err));
  }

  destroy(sid, cb) {
    const file = this._file(sid);
    if (!file) return cb?.();
    fs.unlink(file, () => cb?.());
  }

  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }

  _cleanup() {
    fs.readdir(DIR, (err, files) => {
      if (err) return;
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const file = path.join(DIR, f);
        fs.readFile(file, 'utf8', (e, raw) => {
          if (e) return;
          try {
            const sess = JSON.parse(raw);
            const expires = sess.cookie?.expires;
            if (expires && new Date(expires) < new Date()) fs.unlink(file, () => {});
          } catch {
            fs.unlink(file, () => {});
          }
        });
      }
    });
  }
}

module.exports = { FileSessionStore };
