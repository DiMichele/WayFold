import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The offline package's exit reaches intranet sites whose certificates are
 * self-signed or signed by a company CA, so the TLS client must be allowed to
 * skip validation. epoxy-transport 2.1.29 drops that option before it reaches
 * the client; this restores the passthrough. Only the offline build uses it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "node_modules", "@mercuryworkshop", "epoxy-transport", "dist", "index.js");
const source = await readFile(file, "utf8");
if (source.includes('"disable_certificate_validation"')) {
  console.log("epoxy-transport already forwards certificate options");
  process.exit(0);
}
const needle = /"buffer_size"\r?\n];/;
if (!needle.test(source)) throw new Error("epoxy-transport bundle changed shape; patch needs updating");
await writeFile(file, source.replace(needle, `"buffer_size",\n  "pem_files",\n  "disable_certificate_validation"\n];`));
console.log("epoxy-transport now forwards certificate options");
