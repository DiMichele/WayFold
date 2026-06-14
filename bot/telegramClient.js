/**
 * telegramClient.js — Client Bot API minimale (zero dipendenze)
 *
 * Sostituisce node-telegram-bot-api (e la sua catena `request` deprecata e
 * vulnerabile) con il sottoinsieme usato dal bot: long polling, eventi
 * message/photo/document, onText, sendMessage, getFileLink, getMe.
 */

const POLL_TIMEOUT_S = 50;
const RETRY_DELAY_MS = 3000;

class TelegramClient {
  constructor(token) {
    this._base = `https://api.telegram.org/bot${token}`;
    this._fileBase = `https://api.telegram.org/file/bot${token}`;
    this._handlers = {
      message: [], photo: [], document: [], polling_error: [],
      callback_query: [], inline_query: [],
    };
    this._textHandlers = [];
    this._offset = 0;
    this._running = false;
  }

  on(event, cb) {
    if (event === 'callback_query') {
      this._handlers.callback_query.push(cb);
      return;
    }
    if (event === 'inline_query') {
      this._handlers.inline_query.push(cb);
      return;
    }
    this._handlers[event]?.push(cb);
  }

  onText(regex, cb) {
    this._textHandlers.push({ regex, cb });
  }

  onCallback(cb) {
    this._handlers.callback_query.push(cb);
  }

  onInlineQuery(cb) {
    this._handlers.inline_query.push(cb);
  }

  async _call(method, params = {}, { timeoutMs = 30000 } = {}) {
    const res = await fetch(`${this._base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!body?.ok) throw new Error(body?.description || `${method}: HTTP ${res.status}`);
    return body.result;
  }

  getMe() {
    return this._call('getMe');
  }

  sendMessage(chatId, text, opts = {}) {
    return this._call('sendMessage', { chat_id: chatId, text, ...opts });
  }

  getChatMember(chatId, userId) {
    return this._call('getChatMember', { chat_id: chatId, user_id: userId });
  }

  setMyCommands(commands, { scope, language_code } = {}) {
    const params = { commands };
    if (scope) params.scope = scope;
    if (language_code) params.language_code = language_code;
    return this._call('setMyCommands', params);
  }

  answerCallbackQuery(callbackQueryId, opts = {}) {
    return this._call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...opts });
  }

  answerInlineQuery(inlineQueryId, results, opts = {}) {
    return this._call('answerInlineQuery', {
      inline_query_id: inlineQueryId,
      results,
      ...opts,
    });
  }

  editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    return this._call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  /** URL diretto al file (scade dopo ~1h, sufficiente per il download immediato). */
  async getFileLink(fileId) {
    const file = await this._call('getFile', { file_id: fileId });
    return `${this._fileBase}/${file.file_path}`;
  }

  startPolling() {
    if (this._running) return;
    this._running = true;
    this._loop();
  }

  async _loop() {
    while (this._running) {
      try {
        const updates = await this._call('getUpdates', {
          offset: this._offset,
          timeout: POLL_TIMEOUT_S,
          allowed_updates: ['message', 'callback_query', 'inline_query'],
        }, { timeoutMs: (POLL_TIMEOUT_S + 10) * 1000 });

        for (const u of updates) {
          this._offset = u.update_id + 1;
          if (u.callback_query) this._dispatchCallback(u.callback_query);
          else if (u.inline_query) this._dispatchInline(u.inline_query);
          else if (u.message) this._dispatch(u.message);
        }
      } catch (err) {
        for (const cb of this._handlers.polling_error) cb(err);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  _dispatchCallback(query) {
    for (const cb of this._handlers.callback_query) {
      Promise.resolve(cb(query)).catch(err => console.error('❌  Handler callback:', err.message));
    }
  }

  _dispatchInline(query) {
    for (const cb of this._handlers.inline_query) {
      Promise.resolve(cb(query)).catch(err => console.error('❌  Handler inline:', err.message));
    }
  }

  _dispatch(msg) {
    const emit = (event) => {
      for (const cb of this._handlers[event]) {
        Promise.resolve(cb(msg)).catch(err => console.error(`❌  Handler ${event}:`, err.message));
      }
    };
    emit('message');
    if (msg.photo) emit('photo');
    if (msg.document) emit('document');
    if (typeof msg.text === 'string') {
      for (const { regex, cb } of this._textHandlers) {
        const match = msg.text.match(regex);
        if (match) Promise.resolve(cb(msg, match)).catch(err => console.error('❌  Handler comando:', err.message));
      }
    }
  }
}

module.exports = { TelegramClient };
