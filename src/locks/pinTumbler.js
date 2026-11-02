import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { csg, cylX } from '../core/csg.js';
import { M, STATE } from '../core/materials.js';
import { sfx } from '../core/audio.js';
import { disposeTree } from '../core/stage.js';
import { h, zoneSlider, toggle } from '../ui.js';

// ---- 尺寸（单位：毫米）。锁芯轴线沿 X，钥匙从 +X 端插入 ----
const R_PLUG = 6.5;            // 锁芯半径 = 剪切线高度
const SHEAR = R_PLUG;
const R_HOUSE = 11;
const LEN = 34;
const X_FRONT = LEN / 2;
const Y_REST = -2.5;           // 下弹子静止时底端高度
const CH_TOP = 21;             // 弹子孔顶（弹簧顶住的地方）
const PIN_R = 1.32;
const CH_R = 1.5;
const LD = 5.6;                // 上弹子长度
const WAIST = 1.7;             // 防盗弹子腰部中心到底端的距离
const TOOL_GAP = 0.35;         // 工具尖端静止时低于弹子底端的距离
const KEY_LENGTHS = [4.6, 5.0, 5.4, 5.8, 6.2, 6.6, 7.0];

const DIFFS = {
  easy: { n: 3, spools: 0, label: '入门 · 3 颗' },
  std: { n: 5, spools: 0, label: '标准 · 5 颗' },
  hard: { n: 5, spools: 2, label: '防盗 · 含防盗弹子' },
};

const TENSION_ZONES = [
  { from: 0, to: 6, color: '--text-4', opacity: 0.35 },
  { from: 6, to: 12, color: '--warning' },
  { from: 12, to: 48, color: '--success' },
  { from: 48, to: 72, color: '--warning' },
  { from: 72, to: 100, color: '--danger' },
];

function tensionWord(t) {
  if (t < 6) return '无';
  if (t < 12) return '过轻';
  if (t < 48) return '合适';
  if (t < 72) return '偏重';
  return '过重';
}

const BLACK = new THREE.Color(0);
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// ---------- 零件几何 ----------
function lathe(points, seg = 32) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}
function keyPinGeo(L) {
  return lathe([[0, 0], [0.35, 0.03], [0.95, 0.45], [PIN_R, 0.85], [PIN_R, L - 0.14], [PIN_R - 0.14, L], [0, L]]);
}
function driverGeo(spool) {
  const r = PIN_R;
  const pts = spool
    ? [[0, 0], [r - 0.14, 0], [r, 0.14], [r, 0.9], [0.82, 1.25], [0.82, 2.15], [r, 2.5], [r, LD - 0.14], [r - 0.14, LD], [0, LD]]
    : [[0, 0], [r - 0.14, 0], [r, 0.14], [r, LD - 0.14], [r - 0.14, LD], [0, LD]];
  return lathe(pts);
}
function springGeo() {
  const turns = 11, r = 1.02;
  const pts = [];
  for (let i = 0; i <= 440; i++) {
    const t = i / 440;
    const a = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, t, Math.sin(a) * r));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 440, 0.12, 6, false);
}

function hookPickGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.7, -2.6);
  s.lineTo(52, -2.6);
  s.lineTo(52, -1.8);
  s.lineTo(1.0, -1.8);
  s.quadraticCurveTo(0.6, -1.1, 0.55, -0.35);
  s.quadraticCurveTo(0.42, 0.12, 0, 0.1);
  s.quadraticCurveTo(-0.6, 0.06, -0.7, -0.6);
  s.lineTo(-0.7, -2.6);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -0.25);
  return g;
}

// 耙子轮廓：u = 距离尖端的长度
function rakeProfile(u) {
  if (u < 0 || u > 16) return -9;
  const bumps = [[1.4, 1.1], [5.2, 2.0], [9.0, 0.9], [12.6, 1.7]];
  let y = 0;
  for (const [c, hgt] of bumps) y = Math.max(y, hgt * Math.exp(-((u - c) ** 2) / 2.2));
  return y;
}
function rakeGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.lineTo(52, -0.9);
  s.lineTo(52, -0.15);
  s.lineTo(16.5, -0.15);
  for (let u = 16.5; u >= 0; u -= 0.25) s.lineTo(u, Math.max(-0.15, rakeProfile(u)));
  s.lineTo(0, -0.9);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -0.25);
  return g;
}

function wrenchGeo() {
  const s = new THREE.Shape();
  s.moveTo(13, -5.25);
  s.lineTo(20.8, -5.25);
  s.lineTo(20.8, -19);
  s.lineTo(19.6, -19);
  s.lineTo(19.6, -4.45);
  s.lineTo(13, -4.45);
  s.lineTo(13, -5.25);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.45, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 });
  g.translate(0, 0, -1.0);
  return g;
}

export class PinTumblerLock {
  constructor({ stage, ui }) {
    this.stage = stage;
    this.ui = ui;
    this.root = new THREE.Group();
    this.disposers = [];
    this.diff = 'std';
    this.toolMode = 'hook';
    this.hints = true;
    this.cut = true;
    this.T = 0;
    this.sel = 0;
    this.toolLift = 0;
    this.liftTarget = 0;
    this.rakeX = 2;
    this.drag = null;
    this.keys = new Set();
    this.autoRake = 0;
    this.demo = null;
    this.flash = 0;
  }

  // ============ 生命周期 ============
  mount() {
    const { stage, ui } = this;
    stage.scene.add(this.root);
    stage.setShadowFrame({ center: [6, 4, 0], size: 50, groundY: -21 });
    stage.setLimits({ minDistance: 18, maxDistance: 260 });
    stage.jumpTo([40, 18, 120], [10, 3, 0]);
    stage.flyTo([16, 8, 108], [10, 3, 0], 1.4);

    this.buildStatic();
    this.newLock(this.diff);
    this.buildUI();
    this.bindInput();
    this.disposers.push(stage.onFrame((dt) => this.update(dt)));
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.stage.scene.remove(this.root);
    disposeTree(this.root);
  }

  // ============ 建模 ============
  buildStatic() {
    const tools = new THREE.Group();
    this.root.add(tools);

    // 勾针
    this.hook = new THREE.Group();
    const hookMesh = new THREE.Mesh(hookPickGeo(), M.steel);
    hookMesh.castShadow = true;
    const handle = new THREE.Mesh(new RoundedBoxGeometry(34, 4.6, 2.6, 3, 1), M.rubber);
    handle.position.set(68, -2.2, 0);
    handle.castShadow = true;
    this.hook.add(hookMesh, handle);
    tools.add(this.hook);

    // 耙子
    this.rake = new THREE.Group();
    const rakeMesh = new THREE.Mesh(rakeGeo(), M.steel);
    rakeMesh.castShadow = true;
    const handle2 = handle.clone();
    handle2.position.set(68, -0.5, 0);
    this.rake.add(rakeMesh, handle2);
    this.rake.visible = false;
    tools.add(this.rake);

    // 剪切线标记
    const shear = new THREE.Mesh(new THREE.BoxGeometry(LEN + 6, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: STATE.select, transparent: true, opacity: 0.9 }));
    shear.position.set(0, SHEAR, 1.5);
    this.shearMark = shear;
    this.root.add(shear);

    this.springGeo = springGeo();
  }

  buildLockGeometry(n) {
    if (this.lockGroup) { this.root.remove(this.lockGroup); disposeTree(this.lockGroup); }
    const g = new THREE.Group();
    this.lockGroup = g;
    this.root.add(g);

    this.xs = Array.from({ length: n }, (_, i) => 11 - i * 5.2);
    const chamberOps = (yFrom, yTo) => this.xs.map((x) => ({ geo: new THREE.CylinderGeometry(CH_R, CH_R, yTo - yFrom, 32), pos: [x, (yFrom + yTo) / 2, 0] }));
    const cutHouse = { geo: new THREE.BoxGeometry(80, 80, 40), pos: [0, 0, 20], mat: M.cutNickel };
    const cutPlug = { ...cutHouse, mat: M.cutBrass };

    // 锁壳：圆柱 + 上方"塔"（弹子室），挖掉锁芯孔和弹子孔
    const houseOps = [
      { geo: new RoundedBoxGeometry(LEN, 24, 11.5, 4, 2.2), pos: [0, 11.5, 0], mode: 'add' },
      { geo: cylX(R_PLUG + 0.04, LEN + 4) },
      ...chamberOps(0, CH_TOP),
    ];
    const houseFull = csg(cylX(R_HOUSE, LEN, 80), M.nickel, houseOps);
    const houseCut = csg(cylX(R_HOUSE, LEN, 80), M.nickel, [...houseOps, cutHouse]);
    this.houseGeos = { full: houseFull, cut: houseCut };
    const hv = this.cut ? houseCut : houseFull;
    this.house = new THREE.Mesh(hv.geometry, hv.material);
    this.house.castShadow = true;
    this.house.receiveShadow = true;
    g.add(this.house);

    // 锁芯：带前端凸缘、钥匙槽、弹子孔
    this.plug = new THREE.Group();
    g.add(this.plug);
    const plugOps = [
      { geo: cylX(R_PLUG + 1.7, 1.6, 64), pos: [X_FRONT + 0.8, 0, 0], mode: 'add' },
      { geo: new THREE.BoxGeometry(LEN + 8, 7.8, 2.2), pos: [0, -1.5, 0] },
      { geo: new THREE.BoxGeometry(LEN + 8, 1.4, 1.0), pos: [0, -3.4, -1.3] },
      { geo: new THREE.BoxGeometry(LEN + 8, 1.2, 1.0), pos: [0, 0.6, 1.3] },
      ...chamberOps(0, 8),
    ];
    const plugFull = csg(cylX(R_PLUG, LEN, 72), M.brass, plugOps);
    const plugCut = csg(cylX(R_PLUG, LEN, 72), M.brass, [...plugOps, cutPlug]);
    this.plugGeos = { full: plugFull, cut: plugCut };
    const pv = this.cut ? plugCut : plugFull;
    this.plugMesh = new THREE.Mesh(pv.geometry, pv.material);
    this.plugMesh.castShadow = true;
    this.plugMesh.receiveShadow = true;
    this.plug.add(this.plugMesh);

    // 锁芯尾部拨片：开锁时能看到它转过 90°
    const cam = new THREE.Mesh(new RoundedBoxGeometry(2.4, 9, 3.2, 2, 0.6), M.brassDark);
    cam.position.set(-X_FRONT - 1.4, -4.5, 0);
    cam.castShadow = true;
    this.plug.add(cam);

    // 张力扳手跟着锁芯一起转
    this.wrench = new THREE.Mesh(wrenchGeo(), M.steelDark);
    this.wrench.castShadow = true;
    this.plug.add(this.wrench);
  }

  newLock(diff) {
    this.diff = diff;
    const cfg = DIFFS[diff];
    this.buildLockGeometry(cfg.n);
    // 随机钥匙牙花与绑定顺序（制造公差）
    const pins = this.xs.map((x, i) => {
      const Lk = KEY_LENGTHS[(Math.random() * KEY_LENGTHS.length) | 0];
      return { i, x, Lk, hSet: SHEAR - Y_REST - Lk, spool: false, h: 0, v: 0, set: false, falseSet: false, overset: false, driverBottom: 0, offset: rand(-0.06, 0.06) };
    });
    if (cfg.spools) {
      // 防盗弹子要有足够的抬升行程才能出现假开
      const cands = shuffle(pins.slice());
      let k = 0;
      for (const p of cands) {
        if (k >= cfg.spools) break;
        if (p.hSet < 2.6) { p.Lk = KEY_LENGTHS[(Math.random() * 3) | 0]; p.hSet = SHEAR - Y_REST - p.Lk; }
        p.spool = true;
        k++;
      }
    }
    this.pins = pins;
    this.order = shuffle(pins.map((p) => p.i));

    for (const p of pins) {
      p.keyMat = M.brass.clone(); p.keyMat.userData = {};
      p.drvMat = (p.spool ? M.blued : M.steel).clone(); p.drvMat.userData = {};
      p.key = new THREE.Mesh(keyPinGeo(p.Lk), p.keyMat);
      p.drv = new THREE.Mesh(driverGeo(p.spool), p.drvMat);
      p.spr = new THREE.Mesh(this.springGeo, M.spring);
      for (const m of [p.key, p.drv, p.spr]) m.castShadow = true;
      p.key.position.x = p.drv.position.x = p.spr.position.x = p.x;
      this.plug.add(p.key);
      this.lockGroup.add(p.drv, p.spr);
    }
    this.sel = Math.min(this.sel, pins.length - 1);
    this.angle = 0;
    this.open = false;
    this.openT = 0;
    this.oversetHappened = false;
    this.startTime = null;
    this.elapsed = 0;
    this.drops = 0;
    this.lowTensionTimer = 0;
    this.tensionOkTime = 0;
    this.bindTime = 0;
    this.layoutPins();
    this.ui.log(`换了一把新锁：${cfg.label}`, 'info');
    this.refreshStats?.();
  }

  // ============ 交互 ============
  bindInput() {
    const vp = this.stage.container;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hitPlane = (e) => {
      this.stage.raycaster.setFromCamera(this.stage.ndc(e.clientX, e.clientY), this.stage.camera);
      const p = new THREE.Vector3();
      return this.stage.raycaster.ray.intersectPlane(plane, p) ? p : null;
    };
    const inLock = (p) => p && p.x > -22 && p.x < 30 && p.y > -16 && p.y < 26;
    const nearestPin = (x) => {
      let best = 0, bd = Infinity;
      this.xs.forEach((px, i) => { const d = Math.abs(px - x); if (d < bd) { bd = d; best = i; } });
      return best;
    };

    const onDown = (e) => {
      if (e.button !== 0 || this.demo || this.open) return;
      const p = hitPlane(e);
      if (!inLock(p)) return;
      e.stopPropagation();
      e.preventDefault();
      vp.setPointerCapture?.(e.pointerId);
      if (this.toolMode === 'hook' && this.toolLift < 0.8) this.sel = nearestPin(p.x);
      this.drag = { x: e.clientX, y: e.clientY, lift: this.liftTarget, rakeX: this.rakeX, wpp: this.stage.worldPerPixel(new THREE.Vector3(0, 4, 0)) };
      this.autoRake = 0;
    };
    const onMove = (e) => {
      const d = this.drag;
      if (d) {
        const dy = (d.y - e.clientY) * d.wpp;
        if (this.toolMode === 'hook') {
          this.liftTarget = THREE.MathUtils.clamp(d.lift + dy, 0, 5.2);
          if (this.toolLift < 0.8) { const p = hitPlane(e); if (p) this.sel = nearestPin(p.x); }
        } else {
          this.liftTarget = THREE.MathUtils.clamp(d.lift + dy, 0, 4.4);
          this.rakeX = THREE.MathUtils.clamp(d.rakeX + (e.clientX - d.x) * d.wpp, -14, 12);
        }
        return;
      }
      // 悬停：勾针跟随鼠标选择弹子
      if (this.toolMode === 'hook' && !this.demo && !this.open && this.toolLift < 0.8 && e.buttons === 0 && vp.contains(e.target)) {
        const p = hitPlane(e);
        if (inLock(p)) this.sel = nearestPin(p.x);
      }
    };
    const onUp = () => {
      if (!this.drag) return;
      this.drag = null;
      if (this.toolMode === 'hook') this.liftTarget = 0;
    };
    vp.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    const noMenu = (e) => e.preventDefault();
    vp.addEventListener('contextmenu', noMenu);

    const onKey = (e) => {
      if (e.target.matches?.('input[type=text], input[type=number], textarea')) return;
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') {
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) { e.preventDefault(); e.target.blur?.(); }
        if (k === 'arrowleft' && this.toolLift < 0.8) this.sel = Math.min(this.sel + 1, this.pins.length - 1);
        if (k === 'arrowright' && this.toolLift < 0.8) this.sel = Math.max(this.sel - 1, 0);
        if (k === 'q') this.setTension(this.T * 100 - 4);
        if (k === 'e') this.setTension(this.T * 100 + 4);
        if (k === ' ') this.liftTarget = 0;
        if (k === 'r') this.newLock(this.diff);
        this.keys.add(k);
      } else this.keys.delete(k);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const c = this.stage.controls;
    const prevButtons = { ...c.mouseButtons };
    c.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.disposers.push(() => {
      vp.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      vp.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      Object.assign(c.mouseButtons, prevButtons);
    });
  }

  setTension(v) {
    v = THREE.MathUtils.clamp(Math.round(v), 0, 100);
    this.tension.value = v;
    this.T = v / 100;
  }

  // ============ 面板 ============
  buildUI() {
    const { ui } = this;
    ui.setLesson('弹子锁', LESSON, TASKS);
    ui.setStatus('施加一点张力，然后找出卡住的弹子', 'info');
    ui.setHint('鼠标移到锁上选择弹子 · <b>按住左键向上拖</b> 抬起 · <kbd>Q</kbd>/<kbd>E</kbd> 张力 · <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd> 键盘操作 · 右键拖动转视角');

    const c = ui.controls;
    const toolSeg = h(`<div class="seg" style="width:100%"><button class="seg-item" data-v="hook" style="flex:1">单针勾 · SPP</button><button class="seg-item" data-v="rake" style="flex:1">耙子 · Rake</button></div>`);
    const diffSeg = h(`<div class="seg" style="width:100%">${Object.entries(DIFFS).map(([k, d]) => `<button class="seg-item" data-v="${k}" style="flex:1">${d.label.split(' · ')[0]}</button>`).join('')}</div>`);
    const syncSegs = () => {
      toolSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === this.toolMode));
      diffSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === this.diff));
    };
    toolSeg.onclick = (e) => {
      const v = e.target.dataset.v;
      if (!v || this.demo) return;
      this.toolMode = v;
      this.liftTarget = 0; this.toolLift = 0;
      this.hook.visible = v === 'hook';
      this.rake.visible = v === 'rake';
      autoBtn.style.display = v === 'rake' ? '' : 'none';
      ui.setHint(v === 'hook'
        ? '鼠标移到锁上选择弹子 · <b>按住左键向上拖</b> 抬起 · <kbd>Q</kbd>/<kbd>E</kbd> 张力 · 右键拖动转视角'
        : '<b>按住左键左右来回拖</b> 刮动耙子，上下拖改变高度 · 张力保持在“合适”偏轻 · 或点“自动耙”');
      syncSegs();
    };
    diffSeg.onclick = (e) => {
      const v = e.target.dataset.v;
      if (!v || this.demo) return;
      this.setTension(0);
      this.newLock(v);
      syncSegs();
    };
    syncSegs();

    this.tension = zoneSlider({ label: '张力（扳手的扭力）', value: 0, zones: TENSION_ZONES, format: (v) => `${v} · ${tensionWord(v)}` });
    this.tension.input.addEventListener('input', () => { this.T = this.tension.value / 100; });
    this.tension.input.addEventListener('pointerup', () => this.tension.input.blur());

    const btnRow = h(`<div class="row"></div>`);
    const releaseBtn = h(`<button class="btn btn-sm">释放张力</button>`);
    releaseBtn.onclick = () => this.setTension(0);
    const autoBtn = h(`<button class="btn btn-sm" style="display:none">自动耙 3 秒</button>`);
    autoBtn.onclick = () => { this.autoRake = 3; if (this.T < 0.12) this.setTension(26); };
    const keyBtn = h(`<button class="btn btn-sm">钥匙原理演示</button>`);
    keyBtn.onclick = () => this.startKeyDemo();
    const newBtn = h(`<button class="btn btn-sm btn-primary">换一把锁</button>`);
    newBtn.onclick = () => { if (this.demo) return; this.setTension(0); this.newLock(this.diff); };
    btnRow.append(releaseBtn, autoBtn, keyBtn, newBtn);

    const toggles = h(`<div class="row" style="gap:18px"></div>`);
    toggles.append(
      toggle('教学提示', this.hints, (v) => { this.hints = v; }),
      toggle('剖面视图', this.cut, (v) => {
        this.cut = v;
        const hv = v ? this.houseGeos.cut : this.houseGeos.full;
        const pv = v ? this.plugGeos.cut : this.plugGeos.full;
        this.house.geometry = hv.geometry; this.house.material = hv.material;
        this.plugMesh.geometry = pv.geometry; this.plugMesh.material = pv.material;
      }),
    );

    this.statsEl = h(`<dl class="kv"></dl>`);
    c.append(
      h(`<span class="field-label">工具</span>`), toolSeg,
      h(`<span class="field-label">难度</span>`), diffSeg,
      this.tension.el, btnRow, toggles, h('<div class="divider"></div>'), this.statsEl,
    );

    // 视口左下：锁芯转角放大镜
    this.gauge = h(`<div class="overlay-card" style="min-width:180px">
      <h4>锁芯转角（放大显示）</h4>
      <div class="big-num"><span data-a>0.0</span><span style="font-size:15px;color:var(--text-3)">°</span></div>
      <div class="row" data-pins style="gap:5px;margin-top:8px"></div>
    </div>`);
    ui.overlay.append(this.gauge);

    ui.setViewTools([
      { label: '正面', onClick: () => this.stage.flyTo([16, 8, 108], [10, 3, 0]) },
      { label: '斜视', onClick: () => this.stage.flyTo([62, 34, 64], [4, 4, 0]) },
      { label: '特写当前弹子', onClick: () => { const x = this.xs[this.sel]; this.stage.flyTo([x + 6, 8, 34], [x, 5, 0]); } },
    ]);
    this.refreshStats = () => this.renderStats();
    this.renderStats();
  }

  renderStats() {
    if (!this.statsEl) return;
    const setN = this.pins.filter((p) => p.set).length;
    this.statsEl.innerHTML = `
      <dt>已设定</dt><dd>${setN} / ${this.pins.length}</dd>
      <dt>用时</dt><dd>${this.elapsed.toFixed(1)} 秒</dd>
      <dt>弹子掉落</dt><dd>${this.drops} 次</dd>
      <dt>当前锁</dt><dd>${DIFFS[this.diff].label}</dd>`;
    const pinsEl = this.gauge.querySelector('[data-pins]');
    const binding = this.bindingIndex();
    pinsEl.innerHTML = this.pins.map((p, i) => {
      let kind = '';
      if (p.overset) kind = 'danger';
      else if (p.set) kind = 'ok';
      else if (this.hints && i === binding) kind = 'warn';
      const ring = i === this.sel && this.toolMode === 'hook' ? 'box-shadow:0 0 0 2px var(--primary);' : '';
      return `<span class="dot ${kind}" style="width:11px;height:11px;${ring}" title="第 ${i + 1} 颗"></span>`;
    }).join('');
  }

  // ============ 物理 ============
  bindingIndex() {
    if (this.T < 0.06 || this.pins.some((p) => p.overset) || this.open) return -1;
    return this.order.find((i) => !this.pins[i].set) ?? -1;
  }

  resetPins(reason) {
    const had = this.pins.some((p) => p.set || p.overset || p.falseSet);
    for (const p of this.pins) { p.set = false; p.falseSet = false; p.overset = false; }
    if (had) {
      sfx.drop();
      this.drops++;
      this.ui.log(reason, 'warn');
      if (this.oversetHappened) { this.ui.check('overset'); this.oversetHappened = false; }
    }
  }

  // d = 工具把这颗下弹子往上推到的高度（相对静止位置）
  updatePin(p, d, dt, binding, rake) {
    const T = this.T;
    const maxLift = CH_TOP - 1.3 - Y_REST - p.Lk - LD;
    let feel = { v: 0.04, label: '空 · 没碰到弹子', kind: '' };
    const touching = d > p.h - 0.02 && d > 0.02;
    const prevH = p.h;

    if (p.overset) {
      // 下弹子越过剪切线被卡死在锁壳里
      if (touching) feel = { v: 0.95, label: '卡死 · 过度抬升了', kind: 'danger' };
    } else if (p.set) {
      p.h = d > p.h ? d : approach(p.h, Math.max(d, 0), 90 * dt);
      if (touching) feel = { v: 0.07, label: '松动 · 已设定，没有弹簧压力', kind: 'ok' };
      if (p.h > p.hSet + 1.15 && T >= 0.06 && (!rake || T > 0.45)) {
        p.overset = true; p.set = false; p.oversetH = p.h;
        sfx.jam();
        this.oversetHappened = true;
        this.ui.log(`第 ${p.i + 1} 颗被推过头：下弹子卡进了锁壳`, 'danger');
        this.ui.toast('过度抬升！下弹子卡在剪切线上方。稍微放松张力让它落回。', 'danger', 3600);
      }
    } else if (binding === p.i) {
      const want = Math.max(d, 0);
      if (T > 0.72) {
        // 张力太大，摩擦力超过工具能施加的力
        if (touching) feel = { v: 1, label: '太紧 · 摩擦太大，抬不动', kind: 'danger' };
        if (want < p.h) p.h = approach(p.h, want, 30 * dt);
      } else {
        const counterZone = p.spool && p.falseSet && want > p.hSet - 1.2;
        let cap = Infinity;
        if (counterZone && T > 0.24) cap = p.hSet - 1.2;
        const speed = rake ? 220 : 16 - T * 9;
        p.h = want > p.h ? Math.min(approach(p.h, want, speed * dt), cap) : approach(p.h, want, 60 * dt);
        p.v = (p.h - prevH) / dt;
        if (touching) {
          if (counterZone && T > 0.24) feel = { v: 0.9, label: '反向转动被张力挡住 · 减轻张力', kind: 'warn' };
          else if (counterZone) feel = { v: 0.62, label: '反向转动 · 锁芯在往回转', kind: 'warn' };
          else feel = { v: 0.48 + T * 0.5, label: '卡紧 · 这颗正在绑定', kind: 'warn' };
          this.bindTime += dt;
          if (this.bindTime > 0.35) this.ui.check('bind');
          if (want > p.h + 0.05) sfx.scrape(0.6 + T);
        }
        // 防盗弹子：腰部到达剪切线 → 假开
        if (p.spool && !p.falseSet && p.h >= p.hSet - WAIST) {
          p.falseSet = true;
          sfx.falseSet();
          this.flash = 0.5;
          this.ui.log(`第 ${p.i + 1} 颗：大幅转动！可能是假开（防盗弹子）`, 'warn');
        }
        // 到达剪切线
        // 耙子让弹子高速弹跳，接近剪切线就有机会被留住
        if (p.h >= p.hSet - (rake ? 0.5 : 0.08) && (!p.spool || p.falseSet)) {
          const tooFast = !rake && p.v > 9.5 && T > 0.4;
          const rakeOver = rake && T > 0.5 && Math.random() < 0.35;
          if (tooFast || rakeOver) {
            p.overset = true; p.oversetH = p.hSet + 0.9; p.h = p.oversetH;
            sfx.jam();
            this.oversetHappened = true;
            this.ui.log(`第 ${p.i + 1} 颗推得太快太猛，越过了剪切线`, 'danger');
            this.ui.toast('过度抬升！张力大的时候要慢慢推。', 'danger', 3200);
          } else if (rake && T < 0.12) {
            // 张力太小，耙子带上去又掉下来
          } else {
            p.set = true; p.falseSet = false;
            sfx.set();
            this.flash = 1;
            const n = this.pins.filter((q) => q.set).length;
            this.ui.log(`咔！第 ${p.i + 1} 颗到达剪切线（${n}/${this.pins.length}）`, 'ok');
            this.ui.check('set1');
          }
        }
      }
    } else {
      // 没有绑定：只有弹簧的力
      const w = Math.max(d, 0);
      p.h = w > p.h ? Math.min(w, maxLift) : approach(p.h, w, 70 * dt);
      if (touching) {
        feel = p.spool && p.falseSet
          ? { v: 0.3, label: '假开状态 · 腰部卡在剪切线', kind: 'warn' }
          : { v: 0.18 + 0.25 * (p.h / maxLift), label: '弹性 · 只有弹簧在顶', kind: '' };
      }
      if (prevH > 0.6 && p.h < 0.05) sfx.spring();
    }
    if (p.overset) p.h = p.oversetH;
    return feel;
  }

  layoutPins() {
    for (const p of this.pins) {
      const keyTop = Y_REST + p.h + p.Lk;
      let db = keyTop;
      if (p.set) db = Math.max(SHEAR, keyTop);
      else if (p.falseSet) db = Math.max(SHEAR - WAIST, keyTop);
      p.driverBottom = db;
      p.key.position.y = Y_REST + p.h;
      p.drv.position.y = db;
      const top = db + LD;
      p.spr.position.y = top;
      p.spr.scale.y = Math.max(CH_TOP - top, 0.6);
    }
  }

  update(dt) {
    if (!this.pins) return;
    const T = this.T;

    // 键盘抬升
    if (this.keys.has('arrowup')) this.liftTarget = Math.min(this.liftTarget + 4.5 * dt, 5.2);
    if (this.keys.has('arrowdown')) this.liftTarget = Math.max(this.liftTarget - 6 * dt, 0);

    if (this.demo) { this.updateDemo(dt); return; }

    if (!this.open && T > 0.02 && this.startTime === null) this.startTime = performance.now();
    if (this.startTime !== null && !this.open) this.elapsed = (performance.now() - this.startTime) / 1000;

    // 张力归零：所有已设定的弹子掉回
    if (T < 0.06 && !this.open) this.resetPins('张力释放：所有弹子掉回原位');

    // 自动耙
    if (this.autoRake > 0) {
      this.autoRake -= dt;
      const t = (this.rakeClock = (this.rakeClock || 0) + dt);
      this.rakeX = -1.5 + 9.5 * Math.sin(t * 9.5);
      this.liftTarget = 2.4 + 1.3 * Math.sin(t * 6.3 + 1) + rand(-0.4, 0.4);
      if (this.autoRake <= 0) this.liftTarget = 0;
    }

    const binding = this.bindingIndex();
    let feel = { v: 0.03, label: '空 · 没碰到弹子', kind: '' };
    const desired = approach(this.toolLift, this.liftTarget, (this.toolMode === 'rake' ? 60 : 40) * dt);

    if (!this.open) {
      if (this.toolMode === 'hook') {
        const sp = this.pins[this.sel];
        for (const p of this.pins) {
          if (p === sp) {
            feel = this.updatePin(p, desired - TOOL_GAP, dt, binding, false);
            // 弹子推不动时，工具也被挡住
            this.toolLift = Math.min(desired, p.h + TOOL_GAP);
          } else this.updatePin(p, 0, dt, binding, false);
        }
      } else {
        this.toolLift = desired;
        let best = feel;
        for (const p of this.pins) {
          const d = this.toolLift - 1.9 + rakeProfile(p.x - this.rakeX);
          const f = this.updatePin(p, d, dt, binding, true);
          if (f.v > best.v) best = f;
        }
        feel = best;
      }

      // 张力过轻：已设定的弹子可能掉下来
      const pushing = this.pins.some((p) => !p.set && p.h > 0.6);
      if (T >= 0.06 && T < 0.12 && pushing && this.pins.some((p) => p.set)) {
        this.lowTensionTimer += dt;
        if (this.lowTensionTimer > 1.1) {
          this.lowTensionTimer = 0;
          const setPins = this.pins.filter((p) => p.set);
          const p = setPins[(Math.random() * setPins.length) | 0];
          p.set = false;
          sfx.drop();
          this.drops++;
          this.ui.log(`张力太轻：第 ${p.i + 1} 颗掉了回去`, 'warn');
        }
      } else this.lowTensionTimer = 0;

      // 张力在合适区间
      if (T >= 0.12 && T <= 0.48) { this.tensionOkTime += dt; if (this.tensionOkTime > 1) this.ui.check('tension'); }

      // 过度抬升：轻微放松张力可以让它落回
      for (const p of this.pins) {
        if (p.overset && T >= 0.06 && T < 0.14) {
          p.overset = false; p.h = 0;
          sfx.drop();
          this.ui.log(`放松张力：第 ${p.i + 1} 颗落回，重新再来`, 'info');
          this.ui.check('overset');
          this.oversetHappened = false;
        }
      }

      // 全部设定 → 锁芯可以转动
      if (this.pins.every((p) => p.set) && T >= 0.06) this.unlock();
    }

    // 锁芯转角
    let target = 0;
    if (this.open) {
      this.openT = Math.min(this.openT + dt / 0.9, 1);
      target = 90 * (1 - Math.pow(1 - this.openT, 3));
      this.angle = target;
    } else {
      if (T >= 0.06) {
        target = 0.5 + T * 0.6 + this.pins.filter((p) => p.set).length * 0.75;
        for (const p of this.pins) {
          if (p.falseSet) {
            const prog = THREE.MathUtils.clamp((p.h - (p.hSet - 1.2)) / 1.2, 0, 1);
            target += 7 * (1 - prog);
          }
        }
      }
      this.angle += (target - this.angle) * Math.min(1, dt * 14);
    }
    this.plug.rotation.x = -THREE.MathUtils.degToRad(this.angle);

    // 工具摆放
    if (this.toolMode === 'hook') {
      const x = this.xs[this.sel];
      this.hookX = this.hookX === undefined ? x : this.hookX + (x - this.hookX) * Math.min(1, dt * 18);
      this.hook.position.set(this.hookX, Y_REST - TOOL_GAP + this.toolLift, 0);
      this.hook.rotation.z = -Math.atan(this.toolLift / (X_FRONT + 3 - this.hookX)) * 0.85;
    } else {
      this.rake.position.set(this.rakeX, Y_REST - 1.9 + this.toolLift, 0);
      this.rake.rotation.z = -Math.atan(this.toolLift / 30) * 0.5;
    }
    this.hook.visible = this.toolMode === 'hook' && !this.open;
    this.rake.visible = this.toolMode === 'rake' && !this.open;

    this.layoutPins();
    this.paintHints(binding);

    // 手感
    if (this.flash > 0) {
      feel = { v: 0.4 + this.flash * 0.6, label: '咔哒！', kind: 'ok' };
      this.flash = Math.max(0, this.flash - dt * 4);
    }
    if (this.open) feel = { v: 0.02, label: '锁已打开', kind: 'ok' };
    this.ui.feel(feel.v + rand(-0.015, 0.015), feel.label, feel.kind);

    // 状态与面板
    this.gauge.querySelector('[data-a]').textContent = this.angle.toFixed(1);
    this.statTimer = (this.statTimer || 0) + dt;
    if (this.statTimer > 0.12) { this.statTimer = 0; this.renderStats(); this.updateStatus(binding); }
  }

  updateStatus(binding) {
    const { ui } = this;
    if (this.open) return;
    if (this.pins.some((p) => p.overset)) return ui.setStatus('过度抬升：把张力放松到很轻（< 14）让它落回', 'danger');
    if (this.T < 0.06) return ui.setStatus('先用张力扳手施加一点扭力（E 键或滑块）', 'info');
    if (this.T > 0.72) return ui.setStatus('张力太大：弹子被死死压住，抬不动', 'danger');
    if (this.pins.some((p) => p.falseSet)) return ui.setStatus('锁芯大幅转动——这是假开！找那颗“反向转动”的弹子，减轻张力慢慢推', 'warn');
    const n = this.pins.filter((p) => p.set).length;
    if (this.T < 0.12) return ui.setStatus('张力偏轻：已设定的弹子容易掉下来', 'warn');
    if (n === 0) return ui.setStatus('逐个轻推每颗弹子，找出唯一“卡紧”的那颗', 'info');
    ui.setStatus(`已设定 ${n}/${this.pins.length}：继续找下一颗卡紧的弹子`, 'info');
  }

  paintHints(binding) {
    const on = this.hints;
    this.shearMark.visible = on || !!this.demo;
    for (const p of this.pins) {
      let kc = null, dc = null;
      if (on) {
        if (p.overset) kc = STATE.danger;
        else if (p.i === binding) { kc = STATE.binding; dc = STATE.binding; }
        if (p.set) dc = STATE.set;
        if (p.falseSet) dc = STATE.binding;
      }
      p.keyMat.emissive.copy(kc || BLACK);
      p.keyMat.emissiveIntensity = kc ? 0.55 : 0;
      p.drvMat.emissive.copy(dc || BLACK);
      p.drvMat.emissiveIntensity = dc ? 0.5 : 0;
      if (!on && p.spool) p.drvMat.color.set(0xd9dde3); else if (p.spool) p.drvMat.color.set(0x5b6472);
    }
  }

  unlock() {
    if (this.open) return;
    this.open = true;
    this.openT = 0;
    this.liftTarget = 0;
    sfx.open();
    setTimeout(() => sfx.success(), 350);
    const secs = this.elapsed.toFixed(1);
    this.ui.setStatus(`开锁成功！用时 ${secs} 秒，弹子掉落 ${this.drops} 次`, 'ok');
    this.ui.toast(`锁芯转动了！用时 ${secs} 秒`, 'ok', 3200);
    this.ui.log(`锁芯转开 · ${DIFFS[this.diff].label} · ${this.toolMode === 'hook' ? '单针' : '耙子'}`, 'ok');
    if (this.toolMode === 'hook') this.ui.check('spp');
    else this.ui.check('rake');
    if (this.diff === 'hard') this.ui.check('spool');
  }

  // ============ 钥匙演示 ============
  buildKey() {
    const top = (x) => {
      let y = 2.1;
      for (const p of this.pins) y = Math.min(y, Y_REST + p.hSet + Math.max(0, Math.abs(x - p.x) - 0.45) * 1.15);
      y = Math.min(y, -4.0 + (x + 15.5) * 1.3);
      return y;
    };
    const s = new THREE.Shape();
    s.moveTo(-15.5, -5.0);
    for (let x = -15.5; x <= 18.6; x += 0.2) s.lineTo(x, top(x));
    s.lineTo(18.6, 4.4);
    s.lineTo(20.5, 4.4);
    s.lineTo(20.5, -6.4);
    s.lineTo(18.6, -6.4);
    s.lineTo(18.6, -5.0);
    s.lineTo(-15.5, -5.0);
    const blade = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
    blade.translate(0, 0, -0.95);
    const bowShape = new THREE.Shape();
    bowShape.absarc(28, -1, 8.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(31.5, -1, 2.2, 0, Math.PI * 2, true);
    bowShape.holes.push(hole);
    const bow = new THREE.ExtrudeGeometry(bowShape, { depth: 2.4, bevelEnabled: true, bevelSize: 0.5, bevelThickness: 0.5, bevelSegments: 3, curveSegments: 48 });
    bow.translate(0, 0, -1.2);
    const key = new THREE.Group();
    key.add(new THREE.Mesh(blade, M.nickel), new THREE.Mesh(bow, M.nickel));
    key.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    key.userData.top = top;
    return key;
  }

  startKeyDemo() {
    if (this.demo) return;
    this.setTension(0);
    this.resetPins('演示开始：弹子复位');
    this.open = false;
    this.openT = 0;
    this.angle = 0;
    this.liftTarget = 0; this.toolLift = 0;
    this.hook.visible = this.rake.visible = false;
    const key = this.buildKey();
    this.plug.add(key);
    this.demo = { key, t: 0 };
    this.stage.flyTo([16, 8, 108], [10, 3, 0]);
    this.ui.setStatus('钥匙原理演示', 'info');
  }

  updateDemo(dt) {
    const d = this.demo;
    d.t += dt;
    const t = d.t;
    const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * THREE.MathUtils.clamp(k, 0, 1));
    let offset = 40, angle = 0, caption = '';
    if (t < 3) { offset = 40 * (1 - ease(t / 3)); caption = '① 钥匙插入：牙花的斜坡依次把每列弹子顶起'; }
    else if (t < 5) { offset = 0; caption = '② 完全插入：每一列上下弹子的交界都恰好落在<b>剪切线</b>上（蓝线）'; }
    else if (t < 6.2) { offset = 0; angle = 90 * ease((t - 5) / 1.2); caption = '③ 交界全部对齐，锁芯与锁壳之间没有东西阻挡——锁芯转动'; }
    else if (t < 7.6) { offset = 0; angle = 90; caption = '③ 锁芯转过 90°，尾部拨片带动锁舌'; }
    else if (t < 8.8) { offset = 0; angle = 90 * (1 - ease((t - 7.6) / 1.2)); caption = '④ 转回原位'; }
    else if (t < 11) { offset = 40 * ease((t - 8.8) / 2.2); caption = '④ 拔出钥匙，弹簧把弹子压回去：开锁就是在没有钥匙的情况下，逐列复现这一刻'; }
    else {
      this.plug.remove(d.key);
      disposeTree(d.key);
      this.demo = null;
      this.angle = 0;
      this.ui.check('key');
      this.ui.setHint('鼠标移到锁上选择弹子 · <b>按住左键向上拖</b> 抬起 · <kbd>Q</kbd>/<kbd>E</kbd> 张力 · 右键拖动转视角');
      this.updateStatus(-1);
      return;
    }
    d.key.position.x = offset;
    this.plug.rotation.x = -THREE.MathUtils.degToRad(angle);
    this.angle = angle;
    const top = d.key.userData.top;
    for (const p of this.pins) {
      const lx = p.x - offset;
      const lift = lx >= -15.5 && lx <= 18.6 ? Math.max(0, top(lx) - Y_REST) : 0;
      p.h = lift;
    }
    this.layoutPins();
    this.paintHints(-1);
    this.ui.setHint(caption);
    this.gauge.querySelector('[data-a]').textContent = angle.toFixed(1);
    this.ui.feel(0.05, '演示中', '');
  }
}

// ============ 课程内容 ============
const LESSON = [
  {
    id: 'principle', title: '原理', html: `
    <h3>弹子锁是怎么锁住的</h3>
    <p>黄铜色的<span class="term">锁芯</span>可以在银色的<span class="term">锁壳</span>里转动。两者之间的缝隙叫<span class="term">剪切线</span>（图中蓝线）。</p>
    <p>每个弹子孔里从下到上是：<b>下弹子</b>（黄铜，长短不一）、<b>上弹子</b>（钢）、<b>弹簧</b>。平时弹簧把上弹子压过剪切线，锁芯被“销”住，转不动。</p>
    <p>正确的钥匙把每列的下弹子顶到恰好的高度，让<b>每一列的上下交界同时落在剪切线上</b>，锁芯就能转了。点操作台里的「钥匙原理演示」看一遍。</p>
    <h3>漏洞：制造公差</h3>
    <p>弹子孔不可能钻得绝对共线。当你给锁芯一点扭力时，偏得最多的那一列会<b>先被夹住</b>（绑定），其他列仍然松松的。</p>
    <p>把这颗绑定的弹子推到剪切线，上弹子会搁在锁芯边缘的小台阶上，锁芯随之微微一转——然后<b>下一颗</b>开始绑定。</p>
    <div class="note">“同时猜对 5 颗”被拆成了“依次找对 5 次”。这就是开锁最核心的思想：把乘法变成加法。</div>`,
  },
  {
    id: 'technique', title: '技法', html: `
    <h3>单针挑拨（SPP）</h3>
    <ol>
      <li><b>轻张力</b>：滑块到绿色区（约 15–35）。很多新手的问题都是张力太大。</li>
      <li><b>逐个探测</b>：轻推每一颗。只有弹簧阻力、一推就动的是“弹性”；有明显摩擦、推起来发涩的就是<b>绑定</b>的那颗。</li>
      <li><b>慢慢推</b>绑定的弹子，直到听见“咔”一声、感到锁芯微转。</li>
      <li>重复，直到所有弹子设定，锁芯转开。</li>
    </ol>
    <h3>常见错误</h3>
    <ul>
      <li><b>张力过重</b>（红区）：绑定的弹子被压死，抬不动。</li>
      <li><b>推得太快太猛</b>：下弹子冲过剪切线，卡进锁壳 = <span class="term">过度抬升</span>。解决：把张力放到很轻（6–13），让它掉下来。</li>
      <li><b>张力过轻</b>（黄区）：刚设定好的弹子会掉回去。</li>
      <li><b>完全松手</b>：所有弹子一起复位，从头再来。</li>
    </ul>
    <h3>防盗弹子与假开</h3>
    <p>“防盗”难度里藏着中间细腰的<span class="term">线轴弹子</span>。腰部到达剪切线时，锁芯会<b>大幅</b>转动，看起来像快开了——这是<b>假开</b>。</p>
    <p>此时继续推那颗弹子会感到<b>锁芯往回转</b>（反向转动）。要把张力减轻到 24 以下（但别低于 12），让锁芯被推回去一点，弹子才能越过台阶真正设定。</p>
    <h3>耙子</h3>
    <p>耙子靠快速来回刮动，让弹子随机跳动，碰巧到达剪切线的就被张力留住。对便宜锁很快，对防盗弹子基本无效。</p>`,
  },
  {
    id: 'feynman', title: '费曼', html: `
    <h3>费曼的方法论</h3>
    <p>费曼在回忆录里讲过自己研究锁的经历：他先认真读锁的原理、亲手拆装，弄清楚每一个零件<b>到底允许多大的误差</b>，然后才去设计“攻击”。</p>
    <p>对于弹子锁，这种思维的结论是：</p>
    <ul>
      <li>锁的安全性不是“钥匙有多少种牙花”，而是<b>攻击者每一步能得到多少反馈</b>。</li>
      <li>只要每颗弹子都能被单独确认，5 颗、每颗 7 种高度的锁，最多试 <span class="math">5 × 7 = 35</span> 次，而不是 <span class="math">7⁵ = 16807</span> 次。</li>
      <li>好锁（防盗弹子、侧杆、更小公差）的设计目标，就是<b>让反馈变得模糊</b>。</li>
    </ul>
    <div class="note">练习建议：先开着「教学提示」，熟悉“弹性 / 卡紧 / 松动”三种手感的曲线差别；然后关掉提示，只看手感曲线和锁芯转角来开锁。</div>`,
  },
];

const TASKS = [
  { id: 'key', text: '看一遍「钥匙原理演示」' },
  { id: 'tension', text: '把张力保持在“合适”区间 1 秒' },
  { id: 'bind', text: '找到正在绑定（卡紧）的弹子' },
  { id: 'set1', text: '听到第一声“咔”——设定一颗弹子' },
  { id: 'spp', text: '用单针勾打开一把锁' },
  { id: 'overset', text: '体验一次过度抬升，并通过放松张力恢复' },
  { id: 'rake', text: '用耙子打开一把锁' },
  { id: 'spool', text: '打开含防盗弹子的锁（处理假开）' },
];
