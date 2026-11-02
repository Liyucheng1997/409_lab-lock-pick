import * as THREE from 'three';
import { csgMesh, cylX } from '../core/csg.js';
import { M, STATE, ghost } from '../core/materials.js';
import { sfx } from '../core/audio.js';
import { disposeTree } from '../core/stage.js';
import { h, toggle } from '../ui.js';

// ---- 尺寸：轴沿 X，数字轮朝 +Z 显示读数 ----
const N = 4;
const PITCH = 8;
const XS = Array.from({ length: N }, (_, i) => -12 + i * PITCH); // 轮心
const W_R = 9.2;          // 十边形数字面半径
const W_W = 6.2;          // 轮宽
const S_IN = 3.0, S_OUT = 5.0, S_W = 7.2; // 内套
const STEP = Math.PI / 5; // 36°
const OPEN_TRAVEL = 34;

const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const mod10 = (n) => ((Math.round(n) % 10) + 10) % 10;

function digitTexture() {
  const cw = 256, ch = 256;
  const c = document.createElement('canvas');
  c.width = cw * 10; c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2e33';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 10; i++) {
    const x0 = i * cw;
    g.fillStyle = i % 2 ? '#2f3237' : '#2a2d31';
    g.fillRect(x0, 0, cw, ch);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(x0, 0, 3, ch);
    g.save();
    g.translate(x0 + cw / 2, ch / 2);
    g.rotate(-Math.PI / 2);
    g.fillStyle = '#f2f2f4';
    g.font = '600 168px -apple-system, "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i), 0, 8);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// 钢缆从左端锁体出发，在锁后方绕一圈，接到锁头末端
function cableCurve(pull) {
  const end = 32 + pull;
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-23.5, 0, 0), new THREE.Vector3(-31, 0, -1), new THREE.Vector3(-41, -3, -12),
    new THREE.Vector3(-40, -6, -32), new THREE.Vector3(-12, -8, -44), new THREE.Vector3(24, -7, -42),
    new THREE.Vector3(Math.max(44, end + 12), -4, -24), new THREE.Vector3(end + 9, -1, -5), new THREE.Vector3(end - 0.5, 0, 0),
  ], false, 'catmullrom', 0.5);
}

export class WheelComboLock {
  constructor({ stage, ui }) {
    this.stage = stage;
    this.ui = ui;
    this.root = new THREE.Group();
    this.disposers = [];
    this.sel = 0;
    this.tension = false;
    this.hints = true;
    this.ghosted = false;
    this.pull = 0;
    this.open = false;
    this.tries = 0;
    this.mode = 'tension';
  }

  mount() {
    const { stage } = this;
    stage.scene.add(this.root);
    stage.setShadowFrame({ center: [0, 0, -16], size: 60, groundY: -14 });
    stage.setLimits({ minDistance: 14, maxDistance: 300 });
    stage.jumpTo([40, 60, 120], [0, 0, -8]);
    stage.flyTo([16, 38, 116], [0, -1, -10], 1.4);
    this.build();
    this.newLock();
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
  build() {
    const root = this.root;
    this.digitMap = digitTexture();
    this.capMat = M.zinc;

    // 两端锁体
    const capL = csgMesh(cylX(8.6, 8, 64), M.zinc, [{ geo: cylX(9.4, 1.2, 64), pos: [-3.2, 0, 0], mode: 'add' }]);
    capL.position.x = XS[0] - W_W / 2 - 1.2 - 4;
    const capR = csgMesh(cylX(8.6, 8, 64), M.zinc, [
      { geo: cylX(9.4, 1.2, 64), pos: [3.2, 0, 0], mode: 'add' },
      { geo: cylX(2.6, 12, 32), mat: M.cutSteel },
    ]);
    capR.position.x = XS[N - 1] + W_W / 2 + 1.2 + 4;
    this.caps = [capL, capR];
    root.add(capL, capR);
    // 读数指示（两端的白色小三角）
    for (const x of [capL.position.x + 3, capR.position.x - 3]) {
      const tri = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 3), new THREE.MeshStandardMaterial({ color: 0xf2f2f4, roughness: 0.5 }));
      tri.rotation.set(Math.PI / 2, 0, x < 0 ? -Math.PI / 2 : Math.PI / 2);
      tri.position.set(x + (x < 0 ? 1.4 : -1.4), 0, 8.7);
      root.add(tri);
    }

    // 拉杆（锁头）：中心轴 + 每个内套左侧的一个齿 + 末端金属头
    this.shaft = new THREE.Group();
    root.add(this.shaft);
    const rod = new THREE.Mesh(cylX(2.0, 44, 24), M.steel);
    rod.position.x = 1;
    const head = csgMesh(cylX(5.6, 8, 48), M.steel, [{ geo: cylX(6.2, 1.2, 48), pos: [-3.4, 0, 0], mode: 'add' }]);
    head.position.x = capR.position.x + 4 + 4.2;
    this.shaft.add(rod, head);
    this.teethHolder = new THREE.Group();
    this.shaft.add(this.teethHolder);
    rod.castShadow = true;

    // 钢缆
    this.cableMat = new THREE.MeshPhysicalMaterial({ color: 0x1d4e89, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.25 });
    this.cable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve(0), 160, 2.6, 16, false), this.cableMat);
    this.cable.castShadow = true;
    root.add(this.cable);
    this.cablePull = 0;

    // 数字轮
    this.wheels = XS.map((x, i) => {
      const g = new THREE.Group();
      g.position.x = x;
      root.add(g);
      const faceMat = new THREE.MeshStandardMaterial({ map: this.digitMap, metalness: 0.45, roughness: 0.42 });
      const face = new THREE.Mesh(new THREE.CylinderGeometry(W_R, W_R, W_W - 1.6, 10, 1, false, -STEP / 2), faceMat);
      face.geometry.rotateZ(-Math.PI / 2);
      const ribMat = M.zinc.clone(); ribMat.userData = {};
      const ribs = [];
      for (const s of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(W_R + 0.45, W_R + 0.45, 0.8, 40, 1, false), ribMat);
        rib.geometry.rotateZ(-Math.PI / 2);
        rib.position.x = s * (W_W / 2 - 0.4);
        ribs.push(rib);
      }
      // 轮子内孔挡板（让轮片看起来是实心的环）
      const web = csgMesh(cylX(W_R * 0.93, W_W - 1.7, 40), ribMat, [{ geo: cylX(S_OUT + 0.15, W_W + 2, 40) }]);
      g.add(face, ...ribs, web);
      [face, ...ribs].forEach((m) => { m.castShadow = true; });
      // 内套：随轮子一起转，有一个贯通的缺口
      const sleeveHolder = new THREE.Group();
      g.add(sleeveHolder);
      return { g, face, faceMat, ribMat, sleeveHolder, d: 0, target: 0, i };
    });
  }

  // 随机一把锁：密码、缝隙偏移 K、受力顺序
  newLock() {
    this.code = Array.from({ length: N }, () => (Math.random() * 10) | 0);
    this.K = 1 + ((Math.random() * 9) | 0);
    this.order = shuffle([...Array(N).keys()]);
    this.open = false;
    this.pull = 0;
    this.tries = 0;
    this.observed = null;
    // 重建内套和齿（缺口位置依赖密码）
    for (const wh of this.wheels) {
      wh.sleeveHolder.clear();
      const slotAngle = (this.code[wh.i] - this.K) * STEP;
      const sleeve = csgMesh(cylX(S_OUT, S_W, 48), M.brass, [
        { geo: cylX(S_IN, S_W + 2, 32), mat: M.cutBrass },
        { geo: new THREE.BoxGeometry(S_W + 2, 2.4, 4.2), pos: [0, 0, 3.6], mat: M.cutBrass },
      ]);
      sleeve.rotation.x = slotAngle;
      wh.sleeveHolder.add(sleeve);
      let d;
      do { d = (Math.random() * 10) | 0; } while (d === this.code[wh.i]);
      wh.d = wh.target = d;
    }
    this.teethHolder.clear();
    for (const x of XS) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 2.2), M.steelDark);
      tooth.geometry.translate(0, 0, 2.9);
      tooth.position.x = x - S_W / 2 - 0.45;
      tooth.rotation.x = -this.K * STEP;
      this.teethHolder.add(tooth);
    }
    this.ui.log('换了一把新锁', 'info');
  }

  // ============ 机械 ============
  digit(wh) { return mod10(wh.d); }
  atGate(i) { return this.digit(this.wheels[i]) === this.code[i] && Math.abs(this.wheels[i].d - Math.round(this.wheels[i].d)) < 0.2; }
  setCount() { let n = 0; for (const i of this.order) { if (this.atGate(i)) n++; else break; } return n; }
  bindingWheel() {
    if (!this.tension || this.open) return -1;
    return this.order.find((i) => !this.atGate(i)) ?? -1;
  }
  isLockedByTension(i) {
    if (!this.tension || this.open) return false;
    const n = this.setCount();
    return this.order.indexOf(i) < n;
  }

  // 用户转动第 i 个轮子 delta 格
  rotate(i, delta) {
    if (this.open) return;
    const wh = this.wheels[i];
    const binding = this.bindingWheel();
    if (this.isLockedByTension(i)) {
      this.feelOverride = { v: 1, label: '锁死 · 齿卡在缺口里，转不动', kind: 'ok', t: 0.25 };
      sfx.scrape(1);
      return;
    }
    const k = i === binding ? 0.45 : 1;
    const before = wh.d;
    wh.d += delta * k;
    wh.target = Math.round(wh.d);
    if (Math.floor(before + 0.5) !== Math.floor(wh.d + 0.5)) sfx.detent(i !== binding);
    if (i === binding) {
      this.feelOverride = { v: 0.75, label: '发涩 · 这一轮正在受力', kind: 'warn', t: 0.2 };
      sfx.scrape(0.7);
      this.ui.check('bind');
      // 转到缺口：齿滑进去，"咔"
      if (mod10(wh.d) === this.code[i] && Math.abs(wh.d - Math.round(wh.d)) < 0.3) {
        wh.d = wh.target = Math.round(wh.d);
        sfx.set();
        this.flash = 1;
        this.ui.log(`咔！第 ${i + 1} 轮落入缺口（读数 ${this.code[i]}），锁头往外动了一点`, 'ok');
        this.ui.check('click');
      }
    } else if (this.tension) {
      this.feelOverride = { v: 0.12, label: '顺滑 · 这一轮没受力', kind: '', t: 0.15 };
    }
  }

  tryOpen() {
    if (this.open) return;
    this.tries++;
    if (this.code.every((c, i) => this.atGate(i))) {
      this.open = true;
      sfx.open();
      setTimeout(() => sfx.success(), 320);
      this.ui.setStatus(`打开了！密码 ${this.code.join('')}`, 'ok');
      this.ui.toast('锁头拔出来了！', 'ok');
      this.ui.log(`开锁成功 · ${this.code.join('')} · 第 ${this.tries} 次尝试`, 'ok');
      if (this.mode === 'tension') this.ui.check('tension');
      if (this.mode === 'look') this.ui.check('look');
      return true;
    }
    sfx.jam();
    return false;
  }

  relock() {
    this.open = false;
    this.pull = 0;
    for (const wh of this.wheels) { wh.d = wh.target = Math.round(wh.d) + 3 + ((Math.random() * 6) | 0); }
    this.ui.setStatus('重新锁上，并打乱了数字', 'info');
  }

  // ============ 交互 ============
  bindInput() {
    const vp = this.stage.container;
    const faces = () => this.wheels.map((w) => w.face);
    const pickWheel = (e) => {
      const hit = this.stage.raycast(e.clientX, e.clientY, [...faces(), ...this.wheels.flatMap((w) => w.g.children)], true);
      if (!hit.length) return -1;
      let o = hit[0].object;
      while (o && !this.wheels.some((w) => w.g === o)) o = o.parent;
      return o ? this.wheels.findIndex((w) => w.g === o) : -1;
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      const i = pickWheel(e);
      if (i < 0) return;
      e.stopPropagation(); e.preventDefault();
      this.sel = i;
      const wpp = this.stage.worldPerPixel(this.wheels[i].g.position);
      this.drag = { i, y: e.clientY, wpp };
      vp.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (this.drag) {
        const dy = e.clientY - this.drag.y;
        this.drag.y = e.clientY;
        // 向下拖 = 正面往下滚 = 数字减小
        this.rotate(this.drag.i, -(dy * this.drag.wpp) / (2 * W_R * Math.sin(STEP / 2)));
        return;
      }
      if (vp.contains(e.target)) {
        const i = pickWheel(e);
        this.hover = i;
        vp.style.cursor = i >= 0 ? 'ns-resize' : '';
      }
    };
    const onUp = () => { if (this.drag) { this.drag = null; vp.style.cursor = ''; } };
    const onWheel = (e) => {
      const i = pickWheel(e);
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      this.sel = i;
      this.rotate(i, e.deltaY > 0 ? -1 : 1);
    };
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key;
      if (e.type === 'keyup') {
        if (k === ' ') { e.preventDefault(); this.setTension(false); }
        return;
      }
      if (k === 'ArrowLeft') { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); }
      if (k === 'ArrowRight') { e.preventDefault(); this.sel = Math.min(N - 1, this.sel + 1); }
      if (k === 'ArrowUp') { e.preventDefault(); this.rotate(this.sel, 1); }
      if (k === 'ArrowDown') { e.preventDefault(); this.rotate(this.sel, -1); }
      if (k === ' ') { e.preventDefault(); if (!e.repeat) this.setTension(true); }
      if (k === 'Enter') { e.preventDefault(); this.tryOpen(); }
    };
    vp.addEventListener('pointerdown', onDown, true);
    vp.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    this.disposers.push(() => {
      vp.removeEventListener('pointerdown', onDown, true);
      vp.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      vp.style.cursor = '';
    });
  }

  setTension(v) {
    if (this.tension === v) return;
    this.tension = v;
    this.tensionBtn?.classList.toggle('btn-primary', v);
    if (this.tensionBtn) this.tensionBtn.textContent = v ? '正在拉住锁头（再点松开）' : '拉住锁头（按住空格）';
    if (v) { this.ui.check('pull'); sfx.thunk(); }
  }

  setGhost(v) {
    this.ghosted = v;
    for (const wh of this.wheels) {
      for (const m of [wh.faceMat, wh.ribMat]) {
        m.transparent = v;
        m.opacity = v ? 0.16 : 1;
        m.depthWrite = !v;
        m.needsUpdate = true;
      }
    }
  }

  // ============ 面板 ============
  buildUI() {
    const { ui } = this;
    ui.setLesson('数字轮密码锁', LESSON, TASKS);
    ui.setHint('在数字轮上<b>上下拖动</b>或滚轮转动 · <kbd>←</kbd><kbd>→</kbd> 选轮 <kbd>↑</kbd><kbd>↓</kbd> 转动 · 按住 <kbd>空格</kbd> 拉住锁头 · <kbd>Enter</kbd> 试开');
    const c = ui.controls;
    this.modeSeg = h(`<div class="seg" style="width:100%"><button class="seg-item" data-v="tension" style="flex:1">张力法</button><button class="seg-item" data-v="look" style="flex:1">观察法</button></div>`);
    this.modeSeg.onclick = (e) => { const v = e.target.dataset.v; if (v) this.setMode(v); };
    this.modePanel = h('<div class="controls"></div>');
    const row = h('<div class="row"></div>');
    this.tensionBtn = h('<button class="btn btn-sm">拉住锁头（按住空格）</button>');
    this.tensionBtn.onclick = () => this.setTension(!this.tension);
    const openBtn = h('<button class="btn btn-sm">试开（Enter）</button>');
    openBtn.onclick = () => { if (!this.tryOpen()) this.ui.log(`${this.wheels.map((w) => this.digit(w)).join('')} 打不开`, 'danger'); };
    const relock = h('<button class="btn btn-sm">锁上并打乱</button>');
    relock.onclick = () => this.relock();
    const fresh = h('<button class="btn btn-sm btn-primary">换一把锁</button>');
    fresh.onclick = () => { this.setTension(false); this.newLock(); this.setMode(this.mode); };
    row.append(this.tensionBtn, openBtn, relock, fresh);
    const toggles = h('<div class="row" style="gap:18px"></div>');
    toggles.append(
      toggle('教学提示', this.hints, (v) => { this.hints = v; }),
      toggle('透视数字轮', false, (v) => this.setGhost(v)),
    );
    this.statsEl = h('<dl class="kv"></dl>');
    c.append(this.modeSeg, this.modePanel, row, toggles, h('<div class="divider"></div>'), this.statsEl);

    this.hud = h(`<div class="overlay-card"><h4>当前读数</h4><div class="big-num" data-r>0000</div><div class="status-line" style="margin-top:6px" data-s></div></div>`);
    ui.overlay.append(this.hud);

    ui.setViewTools([
      { label: '正面', onClick: () => this.stage.flyTo([16, 38, 116], [0, -1, -10]) },
      { label: '缝隙特写', onClick: () => this.stage.flyTo([XS[1] + 4, 3, 26], [XS[1] + 4, 0, 0]) },
      { label: '内部结构', onClick: () => { this.setGhost(true); this.stage.flyTo([30, 34, 50], [0, 0, 0]); } },
    ]);
    this.setMode('tension');
  }

  setMode(mode) {
    this.mode = mode;
    this.modeSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === mode));
    const p = this.modePanel;
    p.innerHTML = '';
    const { ui } = this;
    if (mode === 'tension') {
      p.append(h(`<p style="margin:0;line-height:1.65">按住空格（或点「拉住锁头」）向外拉锁头，然后逐个转动数字轮。<b>发涩</b>的那一轮正在受力——慢慢转它，直到“咔”一声落入缺口，锁头会往外动一点。再找下一轮。</p>`));
      ui.setStatus('拉住锁头，找出那个转起来“发涩”的数字轮', 'info');
    } else {
      p.append(h(`<p style="margin:0;line-height:1.65">点右上角「缝隙特写」，从两个数字轮之间的缝隙往里看。转动每个轮子，直到黄铜内套上的<b>缺口</b>正对着你。记下此时的读数，然后点下面的按钮。</p>`));
      const rec = h('<button class="btn btn-sm btn-primary">把当前读数记为“缺口读数”</button>');
      const out = h('<div class="status-line"></div>');
      const grid = h(`<div style="display:none"><span class="field-label">真实密码 = 缺口读数 + 同一个偏移 K。逐个试 K：</span><div class="num-grid" style="margin-top:8px">${Array.from({ length: 10 }, (_, k) => `<button class="btn" data-k="${k}">+${k}</button>`).join('')}</div></div>`);
      rec.onclick = () => {
        this.observed = this.wheels.map((w) => this.digit(w));
        const visible = this.wheels.map((w, i) => mod10(w.d) === mod10(this.code[i] - this.K));
        out.innerHTML = `<span class="dot ${visible.every(Boolean) ? 'ok' : 'warn'}"></span>缺口读数：<b class="tabular">${this.observed.join(' ')}</b>${visible.every(Boolean) ? '' : '（有的轮子缺口好像没对准，再看看？）'}`;
        grid.style.display = '';
      };
      grid.onclick = (e) => {
        const k = e.target.dataset.k;
        if (k === undefined || !this.observed) return;
        e.target.classList.add('tried');
        if (this.open) this.relock();
        this.wheels.forEach((w, i) => { w.d = w.target = (this.observed[i] + +k) % 10; });
        const ok = this.tryOpen();
        if (!ok) ui.log(`偏移 +${k}：${this.wheels.map((w) => this.digit(w)).join('')} 打不开`, 'danger');
        else ui.toast(`偏移 K = ${k}，一共试了 ${this.tries} 次`, 'ok', 3200);
      };
      p.append(rec, out, grid);
      ui.setStatus('从缝隙里找黄铜内套的缺口', 'info');
    }
  }

  // ============ 每帧 ============
  update(dt) {
    const binding = this.bindingWheel();
    for (const wh of this.wheels) {
      if (!this.drag || this.drag.i !== wh.i) wh.d += (wh.target - wh.d) * Math.min(1, dt * 16);
      wh.g.rotation.x = -wh.d * STEP;
      let col = null;
      if (this.hints && this.tension && !this.open) {
        if (wh.i === binding) col = STATE.binding;
        else if (this.isLockedByTension(wh.i)) col = STATE.set;
      }
      if (!col && (wh.i === this.sel || wh.i === this.hover)) col = STATE.select;
      wh.ribMat.emissive.copy(col || BLACK);
      wh.ribMat.emissiveIntensity = col ? (col === STATE.select ? 0.25 : 0.6) : 0;
    }

    // 锁头位置：受力时每落入一轮往外动一点；打开时整个抽出
    let target = 0;
    if (this.open) target = OPEN_TRAVEL;
    else if (this.tension) target = 0.25 + this.setCount() * 0.3;
    this.pull += (target - this.pull) * Math.min(1, dt * (this.open ? 3 : 14));
    this.shaft.position.x = this.pull;
    if (Math.abs(this.pull - this.cablePull) > 0.05) {
      this.cablePull = this.pull;
      this.cable.geometry.dispose();
      this.cable.geometry = new THREE.TubeGeometry(cableCurve(this.pull), 160, 2.6, 16, false);
    }

    // HUD / 状态
    this.hud.querySelector('[data-r]').textContent = this.wheels.map((w) => this.digit(w)).join('');
    const sc = this.setCount();
    this.hud.querySelector('[data-s]').innerHTML = this.open
      ? '<span class="dot ok"></span>已打开'
      : this.tension ? `<span class="dot warn"></span>拉住中 · 已落入 ${sc}/${N}` : '<span class="dot"></span>未施力';
    this.statTimer = (this.statTimer || 0) + dt;
    if (this.statTimer > 0.2) {
      this.statTimer = 0;
      this.statsEl.innerHTML = `<dt>尝试次数</dt><dd>${this.tries}</dd><dt>暴力枚举</dt><dd>10⁴ = 10000 种，约 5.5 小时</dd><dt>张力法</dt><dd>最多约 4 × 10 = 40 次转动</dd><dt>观察法</dt><dd>最多 10 次尝试</dd>`;
      if (!this.open && this.mode === 'tension') {
        if (!this.tension) this.ui.setStatus('拉住锁头（空格），找出转起来发涩的数字轮', 'info');
        else if (sc === N) this.ui.setStatus('四轮都落入缺口——按 Enter 拔出锁头！', 'ok');
        else this.ui.setStatus(`已落入 ${sc}/${N}：继续找下一个发涩的轮子`, 'info');
      }
    }

    // 手感
    let feel = { v: 0.04, label: this.tension ? '拉住中' : '没有施力', kind: '' };
    if (this.feelOverride && this.feelOverride.t > 0) { feel = this.feelOverride; this.feelOverride.t -= dt; }
    if (this.flash > 0) { feel = { v: 0.5 + this.flash * 0.5, label: '咔！落入缺口', kind: 'ok' }; this.flash -= dt * 3; }
    if (this.open) feel = { v: 0.02, label: '已打开', kind: 'ok' };
    this.ui.feel(feel.v + (Math.random() - 0.5) * 0.02, feel.label, feel.kind);
  }
}

const BLACK = new THREE.Color(0);

const LESSON = [
  {
    id: 'principle', title: '原理', html: `
    <h3>里面是什么</h3>
    <p>每个数字轮里套着一个黄铜<span class="term">内套</span>，内套上有一个<span class="term">缺口</span>。锁头的拉杆上有一排<span class="term">齿</span>，每个齿正好挡在一个内套的左侧。</p>
    <p>只有四个内套的缺口<b>同时</b>对准齿，拉杆才能整个抽出来。打开「透视数字轮」或点「内部结构」看一看。</p>
    <h3>两个漏洞</h3>
    <ul>
      <li><b>受力不均</b>：拉住锁头时，齿压在内套上。由于公差，总有一个齿先压紧——那个轮子转起来就会<b>发涩</b>，其他轮子却很顺滑。</li>
      <li><b>缝隙</b>：轮子之间有缝，能直接看到内套。内套缺口和读数之间的偏移，对四个轮子是<b>同一个数</b>。</li>
    </ul>
    <div class="note">4 位密码有 10000 种组合，按 2 秒一次要试 5 个多小时。两个漏洞都能把它变成几十秒。</div>`,
  },
  {
    id: 'technique', title: '技法', html: `
    <h3>方法一：张力法</h3>
    <ol>
      <li>按住空格，向外拉住锁头（不要太用力）。</li>
      <li>逐个拨动数字轮，找<b>最涩</b>的那个。</li>
      <li>慢慢转它，到某个数字会“咔”一下变松，锁头往外动一点——这一位找到了。</li>
      <li>它现在被齿卡住转不动了。去找下一个发涩的轮子，重复。</li>
    </ol>
    <h3>方法二：观察法</h3>
    <ol>
      <li>点「缝隙特写」，从轮子之间往里看黄铜内套。</li>
      <li>转动每个轮子，直到内套上的缺口正对你。</li>
      <li>记下这时的四个读数，例如 3 8 1 6。</li>
      <li>真实密码 = 每一位都加同一个偏移 K（0–9，进位舍去）。最多试 10 次。</li>
    </ol>
    <div class="note">买锁的启示：有“防窥”假缺口、更紧公差、轮子之间没有缝隙的锁，这两招都会失效。</div>`,
  },
  {
    id: 'feynman', title: '费曼', html: `
    <h3>化整为零</h3>
    <p>费曼开保险柜时反复使用同一个思路：<b>别去猜整个组合，想办法一次确认一位</b>。</p>
    <p class="math">同时猜 4 位：10 × 10 × 10 × 10 = 10000<br/>逐位确认：10 + 10 + 10 + 10 = 40</p>
    <p>张力法利用的是“受力顺序”泄露的信息；观察法利用的是“所有轮子共用一个偏移”这个设计上的偷懒。两者本质相同：<b>把乘法变成加法</b>。</p>
    <div class="note">这也是为什么密码学里要避免“部分正确也能被察觉”的设计——一旦攻击者能逐位验证，长密码就形同虚设。</div>`,
  },
];

const TASKS = [
  { id: 'pull', text: '拉住锁头（按住空格）' },
  { id: 'bind', text: '找到一个转起来“发涩”的轮子' },
  { id: 'click', text: '听到“咔”——让一个轮子落入缺口' },
  { id: 'tension', text: '用张力法打开锁' },
  { id: 'look', text: '用观察法打开锁（≤ 10 次尝试）' },
];
