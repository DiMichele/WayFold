// Injected like the Diode view, so the three HTML shells share one copy.
const VIEW = `
<section id="view-net" class="view view-net" hidden>
  <div class="card workspace net">
    <div class="diode-head">
      <div class="diode-roles" role="tablist" data-i18n-aria="net.roles">
        <button type="button" class="diode-role" role="tab" data-net-role="share">
          <span class="diode-role-label" data-i18n="net.roleShare">Share</span>
        </button>
        <button type="button" class="diode-role" role="tab" data-net-role="join">
          <span class="diode-role-label" data-i18n="net.roleJoin">Connect</span>
        </button>
      </div>
    </div>

    <div class="banner banner--error" id="net-error" hidden role="alert"></div>

    <div class="net-status card-inner" id="net-status">
      <div class="net-status-head">
        <span class="net-dot" id="net-dot" aria-hidden="true"></span>
        <strong class="net-state" id="net-state" role="status"></strong>
        <div class="net-transport">
          <button type="button" id="net-start" class="btn-primary" data-i18n="net.start">Start link</button>
          <button type="button" id="net-fullscreen" class="btn-secondary" data-i18n="net.fullscreen" hidden>Full-screen QR</button>
          <button type="button" id="net-stop" class="btn-secondary btn-icon-text" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>
            <span data-i18n="net.stop">Stop</span>
          </button>
        </div>
      </div>
      <p class="net-hint" id="net-hint"></p>
      <div class="net-code" id="net-code" hidden>
        <span data-i18n="net.code">Verification code</span>
        <b id="net-code-value"></b>
      </div>
      <div class="xfer-actions net-actions" id="net-actions"></div>
    </div>

    <section class="net-browse card-inner" id="net-browse" hidden>
      <h2 data-i18n="net.browse.title">Browse from this PC</h2>
      <p data-i18n="net.browse.hint"></p>
      <div class="xfer-actions">
        <button type="button" class="btn-primary" id="net-open-browse" data-i18n="net.browse.open">Open browsing</button>
      </div>
      <p class="net-small" data-i18n="net.browse.note"></p>
    </section>

    <div class="diode-payload">
      <h2 data-i18n="diode.pay.label">What to send</h2>
      <div class="diode-pay" role="tablist" data-i18n-aria="diode.pay.label">
        <button type="button" class="diode-pay-btn is-on" role="tab" data-net-pay="chat" aria-selected="true">
          <span data-i18n="diode.live.title">Messages</span>
        </button>
        <button type="button" class="diode-pay-btn" role="tab" data-net-pay="file" aria-selected="false">
          <span data-i18n="diode.pay.file">File</span>
        </button>
        <button type="button" class="diode-pay-btn" role="tab" data-net-pay="video" aria-selected="false">
          <span data-i18n="diode.video.title">Video</span>
        </button>
      </div>
      <section class="diode-block" data-net-panel="chat">
        <form class="diode-live-form" id="net-live-form" autocomplete="off">
          <input id="net-live-input" type="text" maxlength="400" data-i18n-placeholder="diode.live.placeholder" />
          <button type="submit" class="btn-primary" data-i18n="diode.live.send">Send</button>
        </form>
        <p class="diode-now" id="net-now" hidden></p>
      </section>
      <section class="diode-block" data-net-panel="file" hidden>
        <div class="drop-zone" id="net-drop">
          <input id="net-desk-files" type="file" class="sr-only" multiple />
          <div class="drop-zone-inner">
            <label class="btn-outline" for="net-desk-files" data-i18n="diode.tx.addFiles">Add files</label>
            <p class="drop-zone-hint" data-i18n="send.dropHint">or drag and drop here</p>
          </div>
        </div>
      </section>
      <section class="diode-block" data-net-panel="video" hidden>
        <div class="diode-video-row">
          <video id="net-video-preview" class="diode-video-preview" muted playsinline autoplay hidden></video>
          <div class="diode-video-actions">
            <label class="diode-fps" data-i18n-title="diode.video.fpsTip">
              <select id="net-video-fps" data-i18n-aria="diode.video.fps">
                <option value="1">1</option>
                <option value="2" selected>2</option>
                <option value="4">4</option>
                <option value="8">8</option>
              </select>
              <span class="diode-fps-unit" data-i18n="diode.tx.fpsUnit">fps</span>
            </label>
            <button type="button" id="net-video-start" class="btn-primary" data-i18n="diode.video.start">Start video</button>
            <button type="button" id="net-video-flip" class="btn-secondary" hidden data-i18n="diode.video.flip">Flip camera</button>
            <button type="button" id="net-video-stop" class="btn-ghost" hidden data-i18n="diode.video.stop">Stop video</button>
          </div>
        </div>
        <div class="diode-video-stage">
          <canvas id="net-video-out" width="176" height="144"></canvas>
          <p class="diode-video-wait" id="net-video-wait" data-i18n="diode.video.waiting"></p>
        </div>
      </section>
    </div>

    <div class="diode-screen-bar net-tools">
      <div class="diode-screen-group">
        <span class="layout-label" id="net-layout-label" data-i18n="send.layout">Codes on screen</span>
        <div class="segmented" role="group" aria-labelledby="net-layout-label">
          <button type="button" class="segmented-btn" data-net-grid="1" aria-pressed="false">1</button>
          <button type="button" class="segmented-btn is-on" data-net-grid="2" aria-pressed="true">2</button>
          <button type="button" class="segmented-btn" data-net-grid="4" aria-pressed="false">4</button>
        </div>
      </div>
      <label class="diode-screen-group">
        <span class="layout-label" data-i18n="color.profile">Optical profile</span>
        <select id="net-color">
          <option value="mono" selected data-i18n="color.mono">Mono</option>
          <option value="color2" data-i18n="color.color2">Color 2 (experimental)</option>
          <option value="rgb3" data-i18n="color.rgb3">RGB 3 (experimental)</option>
        </select>
        <span id="net-color-status" class="layout-hint"></span>
      </label>
      <p id="color-hint-net" class="layout-hint" hidden></p>
      <label class="diode-screen-group">
        <span class="layout-label" data-i18n="diode.tx.fps" data-i18n-title="diode.tx.fpsTip">Speed</span>
        <span class="diode-fps">
          <select id="net-fps" data-i18n-aria="diode.tx.fps">
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
            <option value="24">24</option>
            <option value="30">30</option>
          </select>
          <span class="diode-fps-unit" data-i18n="diode.tx.fpsUnit">fps</span>
        </span>
      </label>
      <label class="diode-screen-group">
        <span class="layout-label" data-i18n="net.camera">Camera</span>
        <select id="net-camera" class="net-camera"></select>
      </label>
    </div>

    <div class="net-modem" id="net-modem"></div>
  </div>
</section>
`;

export function ensureNetView(): void {
  if (document.getElementById("view-net")) return;
  const shell = document.querySelector("main.app-shell");
  shell?.insertAdjacentHTML("beforeend", VIEW);
}
