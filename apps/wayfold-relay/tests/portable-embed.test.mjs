import assert from "node:assert/strict";
import test from "node:test";
import { insertInlineAssets } from "../scripts/build-portable.mjs";

test("un bundle con $& resta JavaScript, non viene sostituito con </body>", () => {
  const html = '<link rel="stylesheet" href="./assets/main.css">\n<body></body>';
  const js = "const kick=t=>{if(running&&!$&&!done) focus(t)}";
  const out = insertInlineAssets(html, ".a{color:red}", js);
  assert.match(out, /<script>const kick=t=>\{if\(running&&!\$&&!done\) focus\(t\)\}<\/script>/);
  assert.equal(out.includes("</body></script>") || out.includes("!</body>"), false);
});
