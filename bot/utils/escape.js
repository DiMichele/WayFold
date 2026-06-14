/**

 * escape.js — Escape per parse_mode Markdown (legacy) di Telegram

 */



/** Solo i caratteri speciali della modalità Markdown legacy. */

function escMd(text) {

  return String(text).replace(/([_*`\[])/g, '\\$1');

}



module.exports = { escMd };

