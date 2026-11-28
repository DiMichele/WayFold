// The three HTML shells (index, send, receive) share one SPA; the Diode view
// is injected here so it exists in every shell without a fourth copy of the markup.
const VIEW = `
<section id="view-diode" class="view view-diode" hidden>
  <div class="card workspace diode">
    <div class="diode-head">
      <div class="diode-roles" role="tablist" data-i18n-aria="diode.roles">
        <button type="button" class="diode-role" role="tab" data-diode-role="tx">
          <span class="diode-role-label" data-i18n="diode.roleTx">Transmit</span>
        </button>
        <button type="button" class="diode-role" role="tab" data-diode-role="rx">
          <span class="diode-role-label" data-i18n="diode.roleRx">Receive</span>
        </button>
      </div>
    </div>

    <div class="diode-panel" id="dx-panel" hidden>
      <div class="banner banner--error" id="dx-error" hidden role="alert"></div>

      <div class="diode-payload">
        <h2 data-i18n="diode.pay.label">What to send</h2>
        <div class="diode-pay" role="tablist" data-i18n-aria="diode.pay.label">
          <button type="button" class="diode-pay-btn is-on" role="tab" data-diode-pay="chat" aria-selected="true">
            <span data-i18n="diode.live.title">Messages</span>
          </button>
          <button type="button" class="diode-pay-btn" role="tab" data-diode-pay="file" aria-selected="false">
            <span data-i18n="diode.pay.file">File</span>
          </button>
          <button type="button" class="diode-pay-btn" role="tab" data-diode-pay="video" aria-selected="false">
            <span data-i18n="diode.video.title">Video</span>
          </button>
        </div>

        <section class="diode-block" data-pay-panel="chat">
          <form class="diode-live-form" id="dx-live-form" autocomplete="off">
            <input id="dx-live-input" type="text" maxlength="400" data-i18n-placeholder="diode.live.placeholder" />
            <button type="submit" class="btn-primary" data-i18n="diode.live.send">Send</button>
          </form>
        </section>

        <section class="diode-block" data-pay-panel="file" hidden>
          <div class="drop-zone" id="dx-drop">
            <input id="dx-files" type="file" class="sr-only" multiple />
            <div class="drop-zone-inner">
              <label class="btn-outline" for="dx-files" data-i18n="diode.tx.addFiles">Add files</label>
              <p class="drop-zone-hint" data-i18n="send.dropHint">or drag and drop here</p>
            </div>
          </div>
          <ul class="diode-list" id="dx-queue"></ul>
        </section>

        <section class="diode-block" data-pay-panel="video" hidden>
          <div class="diode-video-row">
            <video id="dx-video-preview" class="diode-video-preview" muted playsinline autoplay hidden></video>
            <div class="diode-video-actions">
              <label class="diode-fps" data-i18n-title="diode.video.fpsTip">
                <select id="dx-video-fps" data-i18n-aria="diode.video.fps">
                  <option value="1">1</option>
                  <option value="2" selected>2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="8">8</option>
                </select>
                <span class="diode-fps-unit" data-i18n="diode.tx.fpsUnit">fps</span>
              </label>
              <button type="button" id="dx-video-start" class="btn-primary" data-i18n="diode.video.start">Start video</button>
              <button type="button" id="dx-video-flip" class="btn-secondary" hidden data-i18n="diode.video.flip">Flip camera</button>
              <button type="button" id="dx-video-stop" class="btn-ghost" hidden data-i18n="diode.video.stop">Stop video</button>
            </div>
          </div>
        </section>
      </div>

      <section class="diode-block diode-screen">
        <div class="diode-screen-bar">
          <div class="diode-screen-group">
            <span class="layout-label" id="dx-layout-label" data-i18n="send.layout">Codes on screen</span>
            <div class="segmented" role="group" aria-labelledby="dx-layout-label">
              <button type="button" class="segmented-btn is-on" data-diode-grid="1" aria-pressed="true">1</button>
              <button type="button" class="segmented-btn" data-diode-grid="2" aria-pressed="false">2</button>
              <button type="button" class="segmented-btn" data-diode-grid="4" aria-pressed="false">4</button>
            </div>
            <label class="diode-screen-group">
              <span class="layout-label" data-i18n="color.profile">Optical profile</span>
              <select id="dx-color">
                <option value="mono" selected data-i18n="color.mono">Mono</option>
                <option value="color2" data-i18n="color.color2">Color 2 (experimental)</option>
                <option value="rgb3" data-i18n="color.rgb3">RGB 3 (experimental)</option>
              </select>
              <span id="dx-color-status" class="layout-hint"></span>
            </label>
            <p id="color-hint-diode" class="layout-hint" hidden></p>
            <select id="dx-grid" hidden>
              <option value="1" selected>1</option>
              <option value="2">2</option>
              <option value="4">4</option>
            </select>
          </div>
          <label class="diode-screen-group">
            <span class="layout-label" data-i18n="diode.tx.fps" data-i18n-title="diode.tx.fpsTip">Speed</span>
            <span class="diode-fps">
              <select id="dx-fps" data-i18n-aria="diode.tx.fps">
                <option value="10">10</option>
                <option value="15">15</option>
                <option value="20">20</option>
                <option value="24" selected>24</option>
                <option value="30">30</option>
              </select>
              <span class="diode-fps-unit" data-i18n="diode.tx.fpsUnit">fps</span>
            </span>
          </label>
        </div>
        <div class="xfer-actions diode-transport">
          <button type="button" id="dx-start" class="btn-primary" data-i18n="diode.tx.start">Start transmitting</button>
          <button type="button" id="dx-pause" class="btn-secondary btn-icon-text" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5h3.2v14H6.5zm7.8 0h3.2v14h-3.2z"/></svg>
            <span data-i18n="xfer.pause">Pause</span>
          </button>
          <button type="button" id="dx-resume" class="btn-primary btn-icon-text" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>
            <span data-i18n="xfer.resume">Resume</span>
          </button>
          <button type="button" id="dx-stop" class="btn-ghost btn-icon-text btn-stop" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
            <span data-i18n="diode.stop">Stop</span>
          </button>
        </div>
        <div class="stage-wrap">
          <div class="stage" id="dx-stage" hidden data-i18n-title="send.doubleClick">
            <canvas id="dx-qr" width="16" height="16"></canvas>
          </div>
          <div class="stage-placeholder card-inner" id="dx-idle">
            <p id="dx-idle-text"></p>
          </div>
        </div>
        <div class="xfer-status" id="dx-status" hidden>
          <div class="xfer-status-head">
            <span class="xfer-live" id="dx-live" aria-hidden="true"></span>
            <span class="xfer-state" id="dx-state" role="status"></span>
          </div>
        </div>
      </section>
    </div>

    <div class="diode-panel" id="dr-panel" hidden>
      <div class="banner banner--error" id="dr-error" hidden role="alert"></div>
      <section class="diode-block">
        <div class="toolbar">
          <button type="button" id="dr-start" class="btn-primary btn-primary--lg" data-i18n="diode.rx.start">Start listening</button>
          <button type="button" id="dr-resume" class="btn-primary" hidden data-i18n="diode.rx.resume">Turn camera back on</button>
          <button type="button" id="dr-stop" class="btn-ghost btn-cancel" hidden data-i18n="diode.stop">Stop</button>
        </div>
        <p class="diode-draft" id="dr-draft" hidden></p>
        <p class="diode-now" id="dr-now" hidden></p>
      </section>
      <section class="diode-block" id="dr-camera" hidden>
        <h2 data-i18n="diode.camera.title">Camera</h2>
        <div class="camera-panel">
          <div class="diode-video-live">
            <h2 data-i18n="diode.video.title">Video</h2>
            <div class="diode-video-stage">
              <canvas id="dr-video-out" width="176" height="144"></canvas>
              <p class="diode-video-wait" id="dr-video-wait" data-i18n="diode.video.waiting"></p>
            </div>
          </div>
          <div class="preview" id="dr-preview">
            <video id="dr-video" muted playsinline></video>
          </div>
          <div class="xfer-progress" id="dr-progress">
            <div class="xfer-progress-head">
              <span class="xfer-state" id="dr-state" role="status"></span>
              <span class="xfer-pct" id="dr-pct"></span>
            </div>
            <div class="progress progress--lg"><div id="dr-bar"></div></div>
          </div>
        </div>
      </section>
    </div>

  </div>
</section>
`;

export function ensureDiodeView(): void {
  if (document.getElementById("view-diode")) return;
  const shell = document.querySelector("main.app-shell");
  shell?.insertAdjacentHTML("beforeend", VIEW);
}
