/**
 * Un solo file HTML da aprire con doppio clic.
 * Niente .bat, PowerShell o Python: il browser basta.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "WayFold-Transfer-Portable");
const outFile = path.join(outDir, "WayFold Transfer.html");

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function readDist(rel) {
  return fs.readFileSync(path.join(root, "dist", rel.replace(/^\.\//, "")));
}

function dataUri(file, mime) {
  return `data:${mime};base64,${readDist(file).toString("base64")}`;
}

function stripTags(html, pattern) {
  return html.replace(pattern, "");
}

/** Il parser HTML chiude lo script al primo </script>, anche dentro una stringa. */
export function escapeScriptClose(code) {
  return code.replace(/<\/script/gi, "<\\/script");
}

/**
 * Inserisce CSS e JS nell'HTML.
 * Il ricambio deve essere una funzione: una stringa interpreta `$&` come il testo trovato,
 * e il bundle minificato contiene proprio `$&`.
 */
export function insertInlineAssets(html, css, js) {
  html = html.replace(
    /\s*<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+\.css"[^>]*>/i,
    () => `\n    <style>${css}</style>`,
  );
  return html.replace("</body>", () => `<script>${escapeScriptClose(js)}</script>\n  </body>`);
}

/** Vite spezza il bundle: il primo <script> può essere un chunk condiviso, non l'app. */
function inlineEsImports(code) {
  const importRe = /import\s*\{([^}]+)\}\s*from\s*"(\.\/[^"]+\.js)"\s*;?/g;
  if (!importRe.test(code)) return code;
  importRe.lastIndex = 0;
  return code.replace(importRe, (full, bindings, spec) => {
    const file = spec.replace(/^\.\//, "");
    let chunk = inlineEsImports(readDist(`assets/${file}`).toString("utf8"));
    const exp = chunk.match(/export\{([^}]+)\};?\s*$/);
    if (!exp) throw new Error(`Export non trovato in ${file}`);
    chunk = chunk.slice(0, exp.index).trimEnd();
    const exported = new Map();
    for (const part of exp[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      exported.set(bits[1] || bits[0], bits[0]);
    }
    const id = `__wf_${file.replace(/[^A-Za-z0-9]/g, "_")}`;
    const returns = [...exported.entries()].map(([name, local]) => `${name}:${local}`).join(",");
    const locals = bindings
      .split(",")
      .map((part) => {
        const bits = part.trim().split(/\s+as\s+/);
        const name = bits[0];
        const local = bits[1] || bits[0];
        if (!exported.has(name)) throw new Error(`Export ${name} assente in ${file}`);
        return `const ${local}=${id}.${name};`;
      })
      .join("");
    return `const ${id}=(()=>{${chunk}\nreturn{${returns}};})();\n${locals}`;
  });
}

/** zxing carica il proprio wasm da un URL: dal disco serve un blob anche per quello. */
function inlineWasm(worker) {
  const wasmName = worker.match(/zxing_reader-[A-Za-z0-9_-]+\.wasm/)?.[0];
  if (!wasmName) return worker;
  const wasmB64 = readDist(`assets/${wasmName}`).toString("base64");
  const wasmExpr = `""+new URL("${wasmName}",self.location.href).href`;
  if (!worker.includes(wasmExpr)) throw new Error("Espressione URL del wasm non trovata");
  return (
    `var __wfWasmUrl=URL.createObjectURL(new Blob([Uint8Array.from(atob(${JSON.stringify(wasmB64)}),function(c){return c.charCodeAt(0)})],{type:"application/wasm"}));` +
    worker.replace(wasmExpr, () => "__wfWasmUrl")
  );
}

function jsString(code) {
  return JSON.stringify(code).replace(/</g, "\\u003c");
}

/**
 * The network page loads the proxy on demand. From a local file that URL does not
 * exist, so both chunks become blob modules created when the page opens.
 */
function inlineTransport(js) {
  const transportSpec = js.match(/import\("(\.\/transport-[^"]+\.js)"\)/)?.[1];
  if (!transportSpec) throw new Error("Import del transport non trovato");
  let transport = readDist(`assets/${transportSpec.slice(2)}`).toString("utf8");
  const proxySpec = transport.match(/from"(\.\/proxy-transport-[^"]+\.js)"/)?.[1];
  if (!proxySpec) throw new Error("Import del proxy non trovato");
  const proxy = readDist(`assets/${proxySpec.slice(2)}`).toString("utf8");
  transport = transport.replace(proxySpec, "__WF_PROXY_URL__");
  const prelude =
    `var __wfProxyUrl=URL.createObjectURL(new Blob([${jsString(proxy)}],{type:"text/javascript"}));` +
    `var __wfTransportUrl=URL.createObjectURL(new Blob([${jsString(transport)}.replaceAll("__WF_PROXY_URL__",__wfProxyUrl)],{type:"text/javascript"}));`;
  const rewritten = js.replace(
    /\w+\(async\(\)=>\{const\{(\w+):(\w+)\}=await import\("\.\/transport-[^"]+\.js"\);return\{\1:\2\}\},__vite__mapDeps\(\[[^\]]*\]\),import\.meta\.url\)/g,
    "import(__wfTransportUrl)",
  );
  if (/import\("\.\/transport-/.test(rewritten)) throw new Error("Import del transport ancora relativo");
  return { prelude, js: rewritten };
}

/** Ogni `new Worker(new URL(...))` diventa un blob: un file aperto dal disco non può caricare altri script. */
function inlineWorkers(js) {
  const workerCall =
    /new Worker\(new URL\(""\+new URL\("([A-Za-z0-9_-]+\.js)",import\.meta\.url\)\.href,import\.meta\.url\),\{type:"module"\}\)/g;
  const names = [...new Set([...js.matchAll(workerCall)].map((match) => match[1]))];
  if (names.length === 0) throw new Error("Chiamata new Worker non trovata");
  const urls = new Map(names.map((name, i) => [name, `__wfWorkerUrl${i}`]));
  const prelude = names
    .map((name) => {
      const worker = inlineWasm(readDist(`assets/${name}`).toString("utf8"));
      const literal = JSON.stringify(worker).replace(/</g, "\\u003c");
      return `var ${urls.get(name)}=URL.createObjectURL(new Blob([${literal}],{type:"text/javascript"}));`;
    })
    .join("");
  return prelude + js.replace(workerCall, (_full, name) => `new Worker(${urls.get(name)})`);
}

function buildHtml() {
  let html = readDist("index.html").toString("utf8");
  const cssHref = html.match(/href="(\.\/assets\/[^"]+\.css)"/);
  const scriptSrcs = [...html.matchAll(/src="(\.\/assets\/[^"]+\.js)"/g)].map((match) => match[1]);
  if (!cssHref || scriptSrcs.length === 0) throw new Error("CSS o JS della build non trovati in index.html");

  const css = escapeScriptClose(readDist(cssHref[1]).toString("utf8").replace(/<\/style/gi, "<\\/style"));
  const entry = scriptSrcs.find((src) => /\/main-[^/]+\.js$/.test(src));
  if (!entry) throw new Error("Bundle dell'app non trovato");
  let js = inlineEsImports(readDist(entry).toString("utf8"));
  js = inlineWorkers(js);
  const transport = inlineTransport(js);
  if (transport.js.includes("import.meta")) throw new Error("import.meta rimasto nel bundle: il file non si aprirebbe dal disco");
  js = transport.prelude + transport.js;

  html = stripTags(html, /\s*<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/gi);
  html = stripTags(html, /\s*<link rel="manifest"[^>]*>/i);
  html = stripTags(html, /\s*<link rel="apple-touch-icon"[^>]*>/i);
  html = stripTags(html, /\s*<link rel="icon"[^>]*>/gi);
  html = stripTags(html, /\s*<script src="\.\/js\/install-capture\.js"><\/script>/i);
  html = stripTags(html, /\s*<link rel="modulepreload"[^>]*>/gi);
  html = stripTags(html, /\s*<script type="module"[^>]*src="\.\/assets\/[^"]+\.js"[^>]*><\/script>/gi);
  // Script classico in head partirebbe prima del body. Va in fondo.
  html = insertInlineAssets(html, css, js);

  html = html.replace('href="./" data-mode-link="home"', 'href="#" data-mode-link="home"');
  html = html.replace('href="./send/" data-mode-link="send"', 'href="#send" data-mode-link="send"');
  html = html.replace('href="./receive/" data-mode-link="receive"', 'href="#receive" data-mode-link="receive"');

  const qr = dataUri("img/demo-qr.png", "image/png");
  const icon = dataUri("icons/icon-192.png", "image/png");
  html = html.replaceAll('src="./img/demo-qr.png"', `src="${qr}"`);
  html = html.replaceAll('src="./icons/icon-192.png"', `src="${icon}"`);

  if (html.includes('src="./') || html.includes('href="./assets/')) {
    throw new Error("Restano riferimenti a file esterni");
  }
  return html;
}

function main() {
  if (process.env.WF_PORTABLE_REUSE_DIST === "1") {
    console.log("Uso dist già compilata…");
  } else {
    console.log("Build app…");
    execSync("npm run build", { cwd: root, stdio: "inherit" });
  }
  const keyFile = path.join(root, "offline", "portable-wisp.key");
  const key = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : crypto.randomBytes(24).toString("hex");
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, `${key}\n`);
  let html = buildHtml();
  if (!html.includes("__WF_PORTABLE_WISP_KEY__")) throw new Error("Segnaposto della chiave Wisp assente");
  html = html.replaceAll("__WF_PORTABLE_WISP_KEY__", key);
  rmrf(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  fs.writeFileSync(
    path.join(outDir, "LEGGIMI.txt"),
    [
      "WayFold Transfer",
      "",
      "Copia il file «WayFold Transfer.html» sulla pen drive.",
      "Doppio clic: si apre nel browser. Nessun programma da eseguire e nessun file bat.",
      "Apri questo file con Firefox: Chrome ed Edge non danno la fotocamera a un file sul disco.",
      "",
      "Invia e Ricevi: il file passa dai QR, senza rete.",
      "Rete: scegli Condividi sul PC che ha internet e Collegati sull'altro, poi Apri navigazione.",
      "Nella finestra scrivi un indirizzo qualsiasi (non solo WayFold). Le pagine escono dal server WayFold.",
      "I siti interni della rete del PC, e i siti molto complessi, si aprono da https://transfer.wayfold.xyz.",
      "",
      "Tieni visibile la pagina con i QR. Se la copri, il collegamento si interrompe.",
      "",
    ].join("\r\n"),
  );
  const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
  console.log(`\nPronto: ${outFile} (${mb} MiB)`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();
