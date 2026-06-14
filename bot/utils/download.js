/**
 * utils/download.js — Download file con redirect e timeout
 *
 * Telegram serve i file tramite CDN che reindirizza:
 * seguiamo fino a 5 redirect, con timeout di 30s.
 */

const fs = require('fs');
const https = require('https');
const http = require('http');

function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Troppi redirect'));

    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const cleanup = () => { file.close(); fs.unlink(dest, () => {}); };

    const req = client.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        cleanup();
        return downloadFile(res.headers.location, dest, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        cleanup();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => { cleanup(); reject(err); });
    });

    req.on('error', (err) => { cleanup(); reject(err); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout download')); });
  });
}

module.exports = { downloadFile };
