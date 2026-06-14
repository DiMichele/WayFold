/**
 * scenes.js — Canvas painters illustrativi
 *
 * Scene disegnate a runtime, usate come placeholder eleganti
 * per i viaggi che non hanno ancora foto reali.
 * Scene: coast | desert | fjord | temple | tropical | mountain | aegean
 */

export function scene(ctx, w, h, s) {
  ({ coast, desert, fjord, temple, tropical, mountain, aegean }[s] || coast)(ctx, w, h);
}

export function sceneRoad(ctx, w, h, t) { scene(ctx, w, h, t.scene); road(ctx, w, h); }

function coast(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h * .65);
  g.addColorStop(0, '#FF8C42'); g.addColorStop(.5, '#FFAE63'); g.addColorStop(1, '#FFD08A');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * .65);
  let s = ctx.createRadialGradient(w * .7, h * .22, 0, w * .7, h * .22, h * .2);
  s.addColorStop(0, 'rgba(255,220,100,.9)'); s.addColorStop(.4, 'rgba(255,180,60,.5)'); s.addColorStop(1, 'rgba(255,150,40,0)');
  ctx.fillStyle = s; ctx.beginPath(); ctx.arc(w * .7, h * .22, h * .2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFE070'; ctx.beginPath(); ctx.arc(w * .7, h * .22, h * .07, 0, Math.PI * 2); ctx.fill();
  let wg = ctx.createLinearGradient(0, h * .62, 0, h);
  wg.addColorStop(0, '#3A8FBF'); wg.addColorStop(.5, '#1A5A80'); wg.addColorStop(1, '#0A2A40');
  ctx.fillStyle = wg; ctx.fillRect(0, h * .62, w, h * .38);
  ctx.save(); ctx.globalAlpha = .13; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const y = h * (.68 + i * .06); ctx.beginPath(); ctx.moveTo(w * .2, y); ctx.quadraticCurveTo(w * .5, y - 4, w * .8, y); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#E8C880'; ctx.fillRect(0, h * .75, w, h * .07);
}

function desert(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#F5A030'); g.addColorStop(.45, '#E87020'); g.addColorStop(1, '#8A3010');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let s = ctx.createRadialGradient(w * .75, h * .18, 0, w * .75, h * .18, h * .22);
  s.addColorStop(0, 'rgba(255,240,150,.95)'); s.addColorStop(.3, 'rgba(255,200,80,.6)'); s.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = s; ctx.beginPath(); ctx.arc(w * .75, h * .18, h * .22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFE890'; ctx.beginPath(); ctx.arc(w * .75, h * .18, h * .06, 0, Math.PI * 2); ctx.fill();
  [{ c: '#C87A3A', p: [0, .78, .18, .56, .38, .68, .58, .5, .78, .62, 1, .55] },
   { c: '#A05828', p: [0, .82, .22, .62, .45, .72, .65, .55, .85, .65, 1, .6] },
   { c: '#7A3A18', p: [0, .88, .3, .70, .55, .78, .75, .65, 1, .72] }].forEach(({ c, p }) => {
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i < p.length; i += 2) ctx.lineTo(w * p[i], h * p[i + 1]);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  });
}

function fjord(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h * .7);
  g.addColorStop(0, '#C8D8E8'); g.addColorStop(.6, '#90B0D0'); g.addColorStop(1, '#6080A0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  [[0, .72, w * .22, .32, w * .48, .52, w * .7, .38, w, .55, '#6A8FA8'],
   [0, .78, w * .15, .42, w * .38, .58, w * .6, .36, w * .85, .5, w, .6, '#4A7090'],
   [0, .84, w * .25, .5, w * .5, .65, w * .72, .44, w, .62, '#2A5070'],
   [0, .88, w * .1, .6, w * .35, .72, w * .6, .55, w, .68, '#1A3A50']].forEach(pts => {
    const c = pts.pop(); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], h * pts[i + 1]);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,.48)';
  [[w * .22, h * .32, 14], [w * .6, h * .36, 18], [w * .85, h * .5, 10]].forEach(([cx, cy, sz]) => {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - sz, cy + sz * 1.2); ctx.lineTo(cx + sz, cy + sz * 1.2); ctx.closePath(); ctx.fill();
  });
  let wg = ctx.createLinearGradient(0, h * .72, 0, h);
  wg.addColorStop(0, '#5080A0'); wg.addColorStop(1, '#1A3050');
  ctx.fillStyle = wg; ctx.fillRect(0, h * .72, w, h * .28);
}

function temple(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#F8D8E8'); g.addColorStop(.5, '#E8A8C0'); g.addColorStop(1, '#C07890');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  [[w * .05, h * .45], [w * .25, h * .38], [w * .72, h * .40], [w * .90, h * .46]].forEach(([tx, ty]) => {
    ctx.fillStyle = '#5A3020'; ctx.fillRect(tx - 3, ty, 6, h - ty);
    [['#F0A8C0', 26], ['#E890B0', 22], ['#F8C0D0', 18]].forEach(([c, r], i) => {
      ctx.globalAlpha = .8 - i * .1; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(tx + (i - 1) * 10, ty - 8 + i * 6, r, 0, Math.PI * 2); ctx.fill();
    }); ctx.globalAlpha = 1;
  });
  let gg = ctx.createLinearGradient(0, h * .68, 0, h);
  gg.addColorStop(0, '#3A2018'); gg.addColorStop(1, '#1A0A08');
  ctx.fillStyle = gg; ctx.fillRect(0, h * .68, w, h * .32);
}

function tropical(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h * .6);
  g.addColorStop(0, '#60D8F8'); g.addColorStop(1, '#30A8D8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let lg = ctx.createLinearGradient(0, h * .55, 0, h);
  lg.addColorStop(0, '#50E0F0'); lg.addColorStop(.3, '#20A8C8'); lg.addColorStop(.7, '#1878A8'); lg.addColorStop(1, '#0A4878');
  ctx.fillStyle = lg; ctx.fillRect(0, h * .55, w, h * .45);
  ctx.save(); ctx.globalAlpha = .16; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) { const y = h * (.6 + i * .08); ctx.beginPath(); ctx.moveTo(w * .15, y); ctx.quadraticCurveTo(w * .5, y - 6, w * .85, y); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = '#F0D080'; ctx.fillRect(0, h * .75, w, h * .25);
  [[w * .08, h * .68], [w * .92, h * .65]].forEach(([px, py], si) => {
    ctx.fillStyle = '#5A3A18'; ctx.fillRect(px - 3, py, 6, h - py);
    const lean = si === 0 ? -1 : 1;
    [['#4A9A28', 28, 10], ['#3A8820', 24, 7], ['#5AAA38', 20, 4]].forEach(([c, rx], i) => {
      ctx.fillStyle = c; ctx.globalAlpha = .9;
      ctx.beginPath(); ctx.ellipse(px + lean * 20 + lean * i * 5, py - 4 + i * 7, rx, 9, lean * .4 * (i + 1), 0, Math.PI * 2); ctx.fill();
    }); ctx.globalAlpha = 1;
  });
}

function mountain(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#B0C8D8'); g.addColorStop(.5, '#789AB0'); g.addColorStop(1, '#304858');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  [[0, .58, w * .28, .18, w * .55, .48, w * .75, .28, w, .45, '#5A7A68'],
   [0, .65, w * .18, .28, w * .42, .5, w * .65, .22, w * .88, .42, w, .52, '#3A5A48'],
   [0, .72, w * .12, .38, w * .32, .55, w * .52, .30, w * .72, .48, w, .58, '#2A3A30'],
   [0, .78, w * .08, .52, w * .25, .62, w * .45, .42, w * .68, .58, w * .88, .48, w, .62, '#1A2820']].forEach(pts => {
    const c = pts.pop(); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, h);
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i], h * pts[i + 1]);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = 'rgba(255,255,255,.58)';
  [[w * .28, h * .18, 18], [w * .65, h * .22, 22], [w * .42, h * .30, 14]].forEach(([cx, cy, sz]) => {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - sz, cy + sz * 1.5); ctx.lineTo(cx + sz, cy + sz * 1.5); ctx.closePath(); ctx.fill();
  });
}

function aegean(ctx, w, h) {
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#F8D080'); g.addColorStop(.3, '#F0A040'); g.addColorStop(.6, '#E07020'); g.addColorStop(1, '#201060');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let sg = ctx.createRadialGradient(w * .72, h * .55, 0, w * .72, h * .55, h * .3);
  sg.addColorStop(0, 'rgba(255,220,100,1)'); sg.addColorStop(.2, 'rgba(255,170,50,.8)'); sg.addColorStop(.5, 'rgba(255,100,20,.3)'); sg.addColorStop(1, 'rgba(200,60,0,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(w * .72, h * .55, h * .3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFE870'; ctx.beginPath(); ctx.arc(w * .72, h * .55, h * .06, 0, Math.PI * 2); ctx.fill();
  let wg = ctx.createLinearGradient(0, h * .55, 0, h);
  wg.addColorStop(0, '#E06020'); wg.addColorStop(.2, '#A03020'); wg.addColorStop(.5, '#401880'); wg.addColorStop(1, '#100830');
  ctx.fillStyle = wg; ctx.fillRect(0, h * .55, w, h * .45);
  [[w * .08, h * .36], [w * .75, h * .30]].forEach(([bx, by]) => {
    ctx.fillStyle = '#F8F4EC'; ctx.fillRect(bx, by, 38, h * .22);
    ctx.fillStyle = '#4A88C8'; ctx.beginPath(); ctx.arc(bx + 19, by, 19, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fillRect(bx + 38, by + 3, 7, h * .22 - 3);
  });
  ctx.fillStyle = '#1A0A20'; ctx.beginPath();
  ctx.moveTo(0, h * .55); ctx.lineTo(w * .05, h * .48); ctx.lineTo(w * .12, h * .52); ctx.lineTo(w * .2, h * .44);
  ctx.lineTo(w * .28, h * .5); ctx.lineTo(w * .5, h * .42); ctx.lineTo(w * .58, h * .48);
  ctx.lineTo(w * .65, h * .44); ctx.lineTo(w * .7, h * .52); ctx.lineTo(0, h * .55); ctx.closePath(); ctx.fill();
}

function road(ctx, w, h) {
  const vx = w * .5, vy = h * .5, bl = w * .05, br = w * .95;
  let rg = ctx.createLinearGradient(0, vy, 0, h);
  rg.addColorStop(0, 'rgba(14,13,11,.80)'); rg.addColorStop(1, 'rgba(9,8,6,.94)');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(bl, h); ctx.lineTo(vx - 2, vy); ctx.lineTo(vx + 2, vy); ctx.lineTo(br, h); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.globalAlpha = .4; ctx.strokeStyle = '#C8983A'; ctx.lineWidth = 1.3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(bl, h); ctx.lineTo(vx - 2, vy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(br, h); ctx.lineTo(vx + 2, vy); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.48)'; ctx.setLineDash([11, 10]);
  for (let s = 0; s < 6; s++) {
    const t0 = .57 + s * .065, t1 = t0 + .04, y0 = vy + (h - vy) * t0, y1 = vy + (h - vy) * t1;
    ctx.lineWidth = Math.max(.7, s * .45); ctx.beginPath(); ctx.moveTo(vx, y0); ctx.lineTo(vx, y1); ctx.stroke();
  } ctx.restore();
}

/** Disegna su un canvas gestendo il device pixel ratio (retina). */
export function dc(canvas, w, h, fn) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  fn(ctx, w, h);
  return ctx;
}
