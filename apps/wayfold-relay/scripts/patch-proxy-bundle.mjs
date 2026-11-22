import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * epoxy-transport 2.1.29 forwards only part of its TLS options to the client.
 * The offline build needs the certificate ones: intranet sites use self-signed
 * or company certificates. esbuild inlines and minifies the list, so the patch
 * matches the option array by its last entries rather than by formatting.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "dist", "assets");
const names = (await readdir(assets)).filter((name) => name.startsWith("proxy-transport-") && name.endsWith(".js"));
if (names.length !== 1) throw new Error(`expected one proxy-transport bundle, found ${names.length}`);

const file = join(assets, names[0]);
const source = await readFile(file, "utf8");
const needle = /"header_limit","buffer_size"(,"pem_files","disable_certificate_validation")?\]/;
if (!needle.test(source)) throw new Error("proxy bundle changed shape; patch needs updating");
await writeFile(file, source.replace(needle, `"header_limit","buffer_size","pem_files","disable_certificate_validation"]`));
console.log(`certificate options enabled in ${names[0]}`);
