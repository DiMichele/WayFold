import { Modem } from "./modem.ts";
import "./modem.css";

const params = new URLSearchParams(location.search);
const app = document.getElementById("modem-app")!;

/** Served by the helper itself: talk back to the same origin. */
function sameOriginWs(): string | undefined {
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  return location.protocol === "http:" && local && location.port ? `ws://${location.host}/modem-ws` : undefined;
}

if (params.has("dual")) {
  // Bench test on one machine: each modem's "webcam" is the other modem's canvas.
  document.body.classList.add("mdm-dual");
  const a = document.createElement("section");
  const b = document.createElement("section");
  app.append(a, b);
  let gw: Modem | null = null;
  let cl: Modem | null = null;
  gw = new Modem(a, {
    key: "dual-gateway",
    title: "Gateway",
    defaults: { ws: "ws://127.0.0.1:7701/modem-ws" },
    videoSource: () => cl!.canvas.captureStream(30),
  });
  cl = new Modem(b, {
    key: "dual-client",
    title: "Client",
    defaults: { ws: "ws://127.0.0.1:7702/modem-ws" },
    videoSource: () => gw!.canvas.captureStream(30),
  });
} else {
  const section = document.createElement("section");
  app.append(section);
  const ws = sameOriginWs();
  new Modem(section, {
    key: ws ? `helper-${location.port}` : "default",
    title: "Modem ottico",
    defaults: ws ? { ws } : {},
  });
}
