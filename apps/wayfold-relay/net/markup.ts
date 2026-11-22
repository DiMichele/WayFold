// Injected like the Diode view, so the three HTML shells share one copy.
const VIEW = `
<section id="view-net" class="view view-net" hidden>
  <div class="card workspace net">
    <div class="diode-head">
      <div class="diode-roles" role="tablist" data-i18n-aria="net.roles">
        <button type="button" class="diode-role" role="tab" data-net-role="share">
          <span class="diode-role-label" data-i18n="net.roleShare">Share</span>
          <span class="diode-role-hint" data-i18n="net.roleShareHint">This PC has internet</span>
        </button>
        <button type="button" class="diode-role" role="tab" data-net-role="join">
          <span class="diode-role-label" data-i18n="net.roleJoin">Connect</span>
          <span class="diode-role-hint" data-i18n="net.roleJoinHint">This PC browses through the other one</span>
        </button>
      </div>
      <p class="diode-note" data-i18n="net.disclaimer"></p>
    </div>

    <div class="banner banner--error" id="net-error" hidden role="alert"></div>

    <div class="net-status card-inner" id="net-status">
      <div class="net-status-head">
        <span class="net-dot" id="net-dot" aria-hidden="true"></span>
        <strong class="net-state" id="net-state" role="status"></strong>
      </div>
      <p class="net-hint" id="net-hint"></p>
      <div class="net-code" id="net-code" hidden>
        <span data-i18n="net.code">Verification code</span>
        <b id="net-code-value"></b>
      </div>
      <div class="xfer-actions net-actions" id="net-actions"></div>
    </div>

    <div class="net-modem" id="net-modem"></div>

    <dl class="xfer-stats xfer-stats--row net-stats" id="net-stats" hidden>
      <div><dt data-i18n="net.stat.down">Down</dt><dd id="net-down">–</dd></div>
      <div><dt data-i18n="net.stat.up">Up</dt><dd id="net-up">–</dd></div>
      <div><dt data-i18n="net.stat.rtt">RTT</dt><dd id="net-rtt">–</dd></div>
      <div><dt data-i18n="net.stat.qr">QR read/s</dt><dd id="net-qr">–</dd></div>
    </dl>

    <section class="net-browse card-inner" id="net-browse" hidden>
      <h2 data-i18n="net.browse.title">Browse from this PC</h2>
      <p data-i18n="net.browse.hint"></p>
      <div class="xfer-actions">
        <button type="button" class="btn-primary" id="net-open-browse" data-i18n="net.browse.open">Open browsing</button>
      </div>
      <p class="net-small" data-i18n="net.browse.note"></p>
    </section>

    <div class="diode-controls net-controls">
      <div class="layout-picker diode-layout">
        <span class="layout-label" id="net-layout-label" data-i18n="send.layout">Codes on screen</span>
        <div class="segmented" role="group" aria-labelledby="net-layout-label">
          <button type="button" class="segmented-btn" data-net-grid="1" aria-pressed="false">1</button>
          <button type="button" class="segmented-btn is-on" data-net-grid="2" aria-pressed="true">2</button>
          <button type="button" class="segmented-btn" data-net-grid="4" aria-pressed="false">4</button>
        </div>
        <p class="layout-hint" data-i18n="send.layoutHint"></p>
      </div>
      <label class="diode-field diode-field--inline">
        <span data-i18n="net.camera">Camera</span>
        <select id="net-camera"></select>
      </label>
      <div class="xfer-actions diode-transport">
        <button type="button" id="net-start" class="btn-primary" data-i18n="net.start">Start link</button>
        <button type="button" id="net-fullscreen" class="btn-secondary" data-i18n="net.fullscreen" hidden>Full-screen QR</button>
        <button type="button" id="net-stop" class="btn-secondary btn-icon-text" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>
          <span data-i18n="net.stop">Stop</span>
        </button>
      </div>
    </div>
  </div>
</section>
`;

export function ensureNetView(): void {
  if (document.getElementById("view-net")) return;
  const shell = document.querySelector("main.app-shell");
  shell?.insertAdjacentHTML("beforeend", VIEW);
}
