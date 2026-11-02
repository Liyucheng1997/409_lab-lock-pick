import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { csgMesh, cylZ } from '../core/csg.js';
import { M, STATE, ghost } from '../core/materials.js';
import { sfx } from '../core/audio.js';
import { disposeTree } from '../core/stage.js';
import { h, toggle } from '../ui.js';

// ---- 机构参数（单位：拨盘刻度，0–99） ----
const H = 49.5;        // 空转半程：驱动销要走将近一整圈才能带动下一片
const TOL = 2.4;       // 栅栏容差：拨到 ±2 以内都算对
const CAM_N = 0;       // 驱动凸轮缺口对着 0
const RETRACT = 9;     // 落入缺口后，再向右转 9 格把锁栓拉回
const DIAL_Y = 12;
const WHEEL_R = 16;
const CAM_R = 15.4;
const RIM = DIAL_Y + WHEEL_R;      // 轮片顶端高度（栅栏搁在这里）
const CAM_RIM = DIAL_Y + CAM_R;
const WHEEL_Z = [-17.5, -14.5, -11.5]; // 第 1、2、3 片（离拨盘由远到近）
const CAM_Z = -8.5;

const mod = (a, n = 100) => ((a % n) + n) % n;
const wrapS = (a) => { const m = mod(a); return m > 50 ? m - 100 : m; };
const fmt = (v) => mod(v).toFixed(1).padStart(4, '0');
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = THREE.MathUtils.clamp;

const STORIES = [
  {
    id: 'e', combo: [27, 18, 28], title: '数学家的柜子',
    text: '这位同事是个数学爱好者，办公室黑板上写满了公式。费曼的第一反应：人们喜欢用自己熟悉的数字当密码。他先试了 π，没开；接着试了另一个著名常数……',
    hint: '自然对数的底 e = 2.718281828…，两位一组切开。',
  },
  {
    id: 'pi', combo: [31, 41, 59], title: '物理学家的柜子',
    text: '这只柜子的主人是位理论物理学家，桌上的草稿纸里到处是圆和周期。费曼认为，一个每天和某个常数打交道的人，很可能就用它当密码。',
    hint: '圆周率 π = 3.14159…，去掉开头的 3，两位一组。',
  },
  {
    id: 'factory', combo: [50, 25, 50], title: '新到的保险柜',
    text: '仓库里刚搬来几只新柜子，负责人说“密码都设好了”。费曼注意到很多人从不修改出厂设置——而出厂密码往往是几个固定的整齐数字。',
    hint: '出厂密码常见的样子是 50-25-50 或 25-0-25。',
  },
];

// 生成一组对这把锁“可拨”的密码（避开会互相干扰的区域）
function randomCombo() {
  for (;;) {
    const c = [0, 0, 0].map(() => (Math.random() * 100) | 0);
    const dR = mod(c[0] - c[1]);
    const dL = mod(c[2] - c[1]);
    if (dR < 8 || dR > 88 || dL < 8 || dL > 88) continue;
    if (c[2] < 14 || c[2] > 86) continue;
    return c;
  }
}

// ---------- 纹理 ----------
function dialTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2;
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0, '#2a2d31'); grd.addColorStop(0.8, '#1a1c1f'); grd.addColorStop(1, '#111214');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.translate(cx, cx);
  for (let n = 0; n < 100; n++) {
    const a = (n / 100) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.fillStyle = '#e9e9ec';
    const len = n % 10 === 0 ? 58 : n % 5 === 0 ? 40 : 24;
    const w = n % 10 === 0 ? 7 : n % 5 === 0 ? 5 : 3;
    g.fillRect(-w / 2, -cx + 22, w, len);
    if (n % 10 === 0) {
      g.font = '600 64px -apple-system, "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), 0, -cx + 128);
    }
    g.restore();
  }
  g.beginPath(); g.arc(0, 0, 150, 0, Math.PI * 2); g.fillStyle = '#0f1012'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b8954d'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = 'rgba(60,40,10,.6)'; g.lineWidth = 6; g.strokeRect(10, 10, 492, 108);
  g.fillStyle = 'rgba(50,32,8,.85)';
  g.font = '600 46px -apple-system, "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('绝密 · 档案柜 No.7', 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SafeDialLock {
  constructor({ stage, ui }) {
    this.stage = stage;
    this.ui = ui;
    this.root = new THREE.Group();
    this.disposers = [];
    this.D = 0;            // 拨盘累计位置（展开的，不取模）
    this.w = [0, 0, 0];    // 三片轮片位置
    this.G = [0, 0, 0];    // 三片轮片缺口位置
    this.combo = [0, 0, 0];
    this.engaged = false;
    this.retract = 0;
    this.unlocked = false;
    this.doorAngle = 0;
    this.doorTarget = 0;
    this.drop = 0;
    this.xray = true;
    this.hints = true;
    this.runner = [];
    this.mode = 'learn';
    this.dirAccum = 0;
    this.lastDir = 0;
    this.tries = 0;
  }

  mount() {
    const { stage } = this;
    stage.scene.add(this.root);
    stage.setShadowFrame({ center: [0, 0, -30], size: 95, groundY: -56 });
    stage.setLimits({ minDistance: 40, maxDistance: 520 });
    stage.jumpTo([150, 60, 260], [0, 2, -10]);
    stage.flyTo([70, 34, 200], [0, 4, -10], 1.4);
    this.build();
    this.buildUI();
    this.bindInput();
    this.setMode('learn');
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
    // 柜体：外壳挖空
    const bodyMat = M.paint.clone(); bodyMat.userData = {};
    bodyMat.color.set(0x4a5258);
    bodyMat.transparent = true;
    this.bodyMat = bodyMat;
    // 柜体占 z ∈ [-72, 0]，前面挖出门洞和内腔
    const body = csgMesh(new RoundedBoxGeometry(92, 104, 72, 4, 3).translate(0, 0, -36), bodyMat, [
      { geo: new THREE.BoxGeometry(78, 90, 70), pos: [0, 0, -33] },
    ]);
    root.add(body);
    this.bodyMesh = body;

    for (const [x, z] of [[-38, -8], [38, -8], [-38, -64], [38, -64]]) {
      const foot = new THREE.Mesh(new RoundedBoxGeometry(10, 4, 10, 2, 1), M.paintDark);
      foot.position.set(x, -54, z);
      foot.castShadow = true;
      root.add(foot);
    }
    for (const y of [-30, 30]) {
      const hinge = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 12, 24), M.steelDark);
      hinge.position.set(-39.5, y, 0.5);
      root.add(hinge);
    }
    // 柜内的“机密文件”
    const paper = new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.9 });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(58, 1.6, 44), paper);
      f.position.set(rand(-2, 2), -42 + i * 1.8, -36 + rand(-2, 2));
      f.rotation.y = rand(-0.05, 0.05);
      f.castShadow = f.receiveShadow = true;
      root.add(f);
    }
    const folder = new THREE.Mesh(new THREE.BoxGeometry(56, 1.2, 42), new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.85 }));
    folder.position.set(1, -36.4, -35);
    folder.rotation.y = 0.04;
    root.add(folder);

    // 门：绕左侧铰链转动
    this.door = new THREE.Group();
    this.door.position.set(-38, 0, 0);
    root.add(this.door);
    const mech = new THREE.Group();
    mech.position.set(38, 0, 0);
    this.door.add(mech);
    this.mech = mech;

    this.doorMat = M.paint.clone(); this.doorMat.userData = {};
    this.doorMat.color.set(0x565e65);
    this.doorMat.transparent = true;
    const slab = new THREE.Mesh(new RoundedBoxGeometry(76, 88, 6, 3, 1.2), this.doorMat);
    slab.position.set(0, 0, -3);
    slab.castShadow = true;
    mech.add(slab);
    this.slab = slab;

    // 铭牌
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshStandardMaterial({ map: plateTexture(), metalness: 0.7, roughness: 0.45 }));
    plate.position.set(0, -10, 0.05);
    mech.add(plate);

    // 拨盘、刻度圈、指针
    const bezel = csgMesh(cylZ(13.2, 1.4, 96), M.nickel, [{ geo: cylZ(10.3, 4, 96) }]);
    bezel.position.set(0, DIAL_Y, 0.7);
    mech.add(bezel);
    const index = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 3), M.brass);
    index.rotation.z = Math.PI;
    index.position.set(0, DIAL_Y + 11.6, 1.6);
    mech.add(index);

    this.dial = new THREE.Group();
    this.dial.position.set(0, DIAL_Y, 0);
    mech.add(this.dial);
    const knurl = new THREE.Mesh(cylZ(10, 4.2, 72), M.black);
    knurl.geometry.translate(0, 0, 2.6);
    knurl.castShadow = true;
    const face = new THREE.Mesh(new THREE.CircleGeometry(9.9, 96), new THREE.MeshStandardMaterial({ map: dialTexture(), metalness: 0.25, roughness: 0.45 }));
    face.position.z = 4.72;
    const knob = new THREE.Mesh(cylZ(3.6, 4, 48), M.nickel);
    knob.geometry.translate(0, 0, 6.6);
    knob.castShadow = true;
    const grip = new THREE.Mesh(new RoundedBoxGeometry(1.6, 6.4, 3.2, 2, 0.5), M.nickel);
    grip.position.set(0, 0, 7.4);
    this.dial.add(knurl, face, knob, grip);
    this.dialPick = [knurl, face, knob, grip];

    // 把手
    this.handle = new THREE.Group();
    this.handle.position.set(24, -22, 0);
    const hub = new THREE.Mesh(cylZ(3.4, 3, 32), M.nickel);
    hub.geometry.translate(0, 0, 1.5);
    const bar = new THREE.Mesh(new RoundedBoxGeometry(3.2, 16, 3, 2, 1), M.nickel);
    bar.position.set(0, -7, 3.2);
    this.handle.add(hub, bar);
    this.handle.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mech.add(this.handle);

    // 锁盒（半透明）
    this.caseMat = ghost(M.paintDark, 0.16);
    const lockCase = new THREE.Mesh(new RoundedBoxGeometry(50, 50, 17, 2, 1.2), this.caseMat);
    lockCase.position.set(6, 15, -14);
    mech.add(lockCase);
    this.lockCase = lockCase;

    // 转轴
    const spindle = new THREE.Mesh(cylZ(1.3, 22, 24), M.steel);
    spindle.position.set(0, DIAL_Y, -10);
    mech.add(spindle);

    // 驱动凸轮：V 形缺口
    const camMesh = csgMesh(cylZ(CAM_R, 2, 96), M.steel, [
      { geo: new THREE.BoxGeometry(4.8, 4.8, 4), pos: [0, CAM_R, 0], rot: [0, 0, Math.PI / 4], mat: M.cutSteel },
    ]);
    this.cam = new THREE.Group();
    this.cam.add(camMesh);
    const pin = new THREE.Mesh(cylZ(0.8, 2.2, 16), M.brass);
    pin.position.set(0, -11, -1.8);
    this.cam.add(pin);
    this.cam.position.set(0, DIAL_Y, CAM_Z);
    mech.add(this.cam);

    // 三片轮片：每片有一个缺口（gate）和一个拨片（fly）
    this.wheels = WHEEL_Z.map((z, k) => {
      const mat = M.aluminum.clone(); mat.userData = {};
      const mesh = csgMesh(cylZ(WHEEL_R, 1.8, 120), mat, [
        { geo: cylZ(2.4, 4, 24) },
        { geo: new THREE.BoxGeometry(6.2, 6.4, 4), pos: [0, WHEEL_R, 0], mat: M.cutNickel },
        ...[0, 1, 2, 3].map((i) => ({ geo: cylZ(2.4 + (i % 2) * 0.8, 4, 24), pos: [Math.cos(i * 1.57 + 0.7) * 9, Math.sin(i * 1.57 + 0.7) * 9, 0] })),
      ]);
      const g = new THREE.Group();
      g.add(mesh);
      const fly = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, 1.4), M.brassDark);
      fly.position.set(0, -12.5, 1.4);
      g.add(fly);
      g.position.set(0, DIAL_Y, z);
      mech.add(g);
      return { g, mat, k };
    });
    // 轮片间垫圈
    for (const z of [-13, -16, -10]) {
      const washer = new THREE.Mesh(cylZ(5, 1.2, 32), M.steelDark);
      washer.position.set(0, DIAL_Y, z);
      mech.add(washer);
    }

    // 锁栓 + 杠杆（栅栏）
    this.bolt = new THREE.Group();
    mech.add(this.bolt);
    const boltBar = new THREE.Mesh(new RoundedBoxGeometry(28, 6, 5, 2, 1), M.steel);
    boltBar.position.set(30, RIM + 4.5, -9);
    boltBar.castShadow = true;
    this.bolt.add(boltBar);
    this.lever = new THREE.Group();
    this.bolt.add(this.lever);
    const leverMat = M.steelDark;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(18, 2.2, 1.4), leverMat);
    arm.position.set(8.4, RIM + 4.6, CAM_Z);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(2.2, RIM + 4.6 - CAM_RIM, 1.6), leverMat);
    nose.position.set(0, (CAM_RIM + 0.25 + RIM + 4.6) / 2, CAM_Z);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 8.6), leverMat);
    bridge.position.set(0, RIM + 4.6, -12.6);
    this.fenceMat = M.steel.clone(); this.fenceMat.userData = {};
    const fence = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.4, 9.6), this.fenceMat);
    fence.position.set(0, RIM + 0.25 + 2.2, -14.5);
    this.lever.add(arm, nose, bridge, fence);
    this.lever.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.setXray(true);
  }

  setXray(v) {
    this.xray = v;
    this.doorMat.opacity = v ? 0.2 : 1;
    this.doorMat.depthWrite = !v;
    this.caseMat.opacity = v ? 0.14 : 1;
    this.caseMat.depthWrite = !v;
    this.slab.castShadow = !v;
    this.bodyMat.opacity = v ? 0.28 : 1;
    this.bodyMat.depthWrite = !v;
  }

  // ============ 机械模拟 ============
  aligned() { return this.w.map((w, k) => Math.abs(wrapS(w - this.G[k])) <= TOL); }

  // 拨盘移动到新位置，带动轮片（空转模型）
  // 每片轮片的空转是否已经走完（被带动）：+1 向左带动，-1 向右带动，0 空转中
  links() {
    const lim = (o) => (Math.abs(o) >= H - 1e-6 ? Math.sign(o) : 0);
    return [lim(this.w[1] - this.w[0]), lim(this.w[2] - this.w[1]), lim(this.D - this.w[2])];
  }

  carried() {
    const l = this.links();
    let n = 0;
    for (let k = 2; k >= 0; k--) { if (l[k] === this.lastDir && this.lastDir) n++; else break; }
    return n;
  }

  applyD(nd, quiet = false) {
    const prevL = this.links();
    if (this.engaged) {
      const c = wrapS(nd - CAM_N);
      if (c < -RETRACT) nd = this.D - (wrapS(this.D - CAM_N) + RETRACT); // 锁栓到底，拨盘停住
    }
    const delta = nd - this.D;
    if (Math.abs(delta) < 1e-6) return;
    const dir = Math.sign(delta);
    if (!quiet) {
      if (Math.floor(nd) !== Math.floor(this.D)) sfx.detent(true);
      if (dir !== this.lastDir) { this.lastDir = dir; this.dirAccum = 0; }
      this.dirAccum += Math.abs(delta);
    }
    this.D = nd;
    this.w[2] = clamp(this.w[2], this.D - H, this.D + H);
    this.w[1] = clamp(this.w[1], this.w[2] - H, this.w[2] + H);
    this.w[0] = clamp(this.w[0], this.w[1] - H, this.w[1] + H);
    if (!quiet) {
      this.movedT = 0.15;
      const l = this.links();
      for (let k = 2; k >= 0; k--) {
        if (l[k] && l[k] !== prevL[k]) { sfx.thunk(); this.ui.log(`驱动销带上了第 ${k + 1} 片轮片（读数 ${fmt(this.D)}）`, 'info'); }
      }
    }

    const c = wrapS(this.D - CAM_N);
    const al = this.aligned();
    if (!quiet && !this.engaged && al.every(Boolean) && Math.abs(c) < 1.5 && !this.doorOpenDemo) {
      this.engaged = true;
      if (!quiet) { sfx.thunk(); this.ui.log('栅栏落入三片缺口，杠杆钩住凸轮！', 'ok'); }
    } else if (this.engaged && c > 1.5) {
      this.engaged = false;
    }
    this.retract = this.engaged ? clamp(-c / RETRACT, 0, 1) : 0;
    if (this.retract >= 0.995 && !this.unlocked && !this.doorOpenDemo) this.onUnlocked(quiet);

    // 接触区：杠杆鼻子碰到凸轮缺口的两壁
    if (!quiet && !this.engaged) {
      const hw = this.contactHalfWidth();
      const inZone = Math.abs(c) < hw;
      if (inZone !== this.inContact) {
        this.inContact = inZone;
        if (Math.abs(c) < 6) {
          sfx.thunk();
          const side = c > 0 ? '左' : '右';
          this.ui.log(`${side}接触点 ≈ ${fmt(this.D)}`, 'info');
        }
      }
    }
  }

  // 栅栏越接近缺口，杠杆鼻子在凸轮缺口里落得越深 → 两个接触点越近
  contactHalfWidth(w = this.w) {
    let depth = 0;
    for (let k = 0; k < 3; k++) depth += Math.max(0, 1 - Math.abs(wrapS(w[k] - this.G[k])) / 6.5);
    const noise = Math.sin(w[0] * 12.9898 + w[1] * 78.233 + w[2] * 37.719) * 0.03;
    return 3.4 - 0.32 * depth + noise;
  }

  // 生成锁：随机初始位置 → 按正确方法拨一次 → 记录每片的缺口位置
  setCombo(combo) {
    this.combo = combo;
    this.engaged = false; this.retract = 0; this.unlocked = false;
    this.D = rand(0, 100);
    this.w = [rand(0, 100), rand(0, 100), rand(0, 100)];
    this.dialInstant(combo);
    this.G = this.w.map((x) => mod(x));
    this.scramble();
  }

  dialInstant([a, b, c]) {
    const r = () => mod(this.D);
    const go = (dist) => { const steps = Math.ceil(Math.abs(dist)); for (let i = 1; i <= steps; i++) this.applyD(this.D + dist / steps, true); };
    go((mod(a - r()) || 100) + 300);
    go(-((mod(r() - b) || 100) + 200));
    go((mod(c - r()) || 100) + 100);
  }

  scramble() {
    this.engaged = false; this.retract = 0; this.unlocked = false;
    const dist = rand(250, 450) * (Math.random() < 0.5 ? 1 : -1);
    const steps = Math.ceil(Math.abs(dist));
    for (let i = 1; i <= steps; i++) this.applyD(this.D + dist / steps, true);
  }

  onUnlocked(quiet) {
    this.unlocked = true;
    this.doorTarget = 1;
    this.runner = [];
    if (quiet) return;
    sfx.open();
    setTimeout(() => sfx.success(), 300);
    this.ui.setStatus('锁栓收回——柜门打开了！', 'ok');
    this.ui.toast('柜门打开了！', 'ok', 2600);
    this.ui.log(`开锁成功 · 密码 ${this.combo.map(pad2).join('-')}`, 'ok');
    this.onOpen?.();
  }

  closeDoor() {
    this.doorTarget = 0;
    this.doorOpenDemo = false;
    this.scramble();
  }

  // ============ 自动拨号脚本 ============
  // 段落：{ dir, dist } 匀速转一段；{ until, dir, speed } 转到条件成立；{ wait }；{ call }
  run(segments) { this.runner = segments.map((s) => ({ ...s })); }

  dialScript([a, b, c], speed = 140, captions = false) {
    const r = () => mod(this.D);
    const cap = (t) => (captions ? { call: () => this.ui.setHint(t) } : null);
    return [
      cap(`① 向<b>左</b>（逆时针）转 4 圈，第 4 次停在 <b>${pad2(a)}</b>：把三片轮片都“捡起来”，最远的第 1 片停在位`),
      { dirFn: () => ({ dist: (mod(a - r()) || 100) + 300 }), speed },
      { wait: 0.4 },
      cap(`② 向<b>右</b>转 3 圈，第 3 次停在 <b>${pad2(b)}</b>：第 1 片不动，第 2 片停在位`),
      { dirFn: () => ({ dist: -((mod(r() - b) || 100) + 200) }), speed },
      { wait: 0.4 },
      cap(`③ 向<b>左</b>转 2 圈，第 2 次停在 <b>${pad2(c)}</b>：只有最近的第 3 片在转`),
      { dirFn: () => ({ dist: (mod(c - r()) || 100) + 100 }), speed },
      { wait: 0.4 },
      cap('④ 向<b>右</b>一直转到停：若三个缺口都对齐，栅栏落下，杠杆被凸轮钩住，锁栓被拉回'),
      { dirFn: () => ({ dist: -(mod(r() - CAM_N) + RETRACT + 2) }), speed: speed * 0.6 },
      { wait: 0.3 },
    ].filter(Boolean);
  }

  stepRunner(dt) {
    const seg = this.runner[0];
    if (!seg) return;
    if (seg.call) { this.runner.shift(); seg.call(); return; }
    if (seg.wait !== undefined) { seg.wait -= dt; if (seg.wait <= 0) this.runner.shift(); return; }
    if (seg.dirFn) { Object.assign(seg, seg.dirFn()); delete seg.dirFn; }
    if (seg.left === undefined) seg.left = seg.dist;
    if (seg.until) {
      const step = seg.dir * seg.speed * dt;
      const n = Math.max(1, Math.ceil(Math.abs(step) / 0.2));
      for (let i = 0; i < n; i++) {
        this.applyD(this.D + step / n);
        if (seg.until()) { this.runner.shift(); seg.done?.(); return; }
      }
      return;
    }
    const step = Math.sign(seg.left) * Math.min(Math.abs(seg.left), seg.speed * dt);
    const before = this.D;
    const n = Math.max(1, Math.ceil(Math.abs(step) / 0.4));
    for (let i = 0; i < n; i++) this.applyD(this.D + step / n);
    const moved = this.D - before;
    seg.left -= step;
    // 锁栓到底拨盘被挡住，或走完
    if (Math.abs(seg.left) < 1e-6 || Math.abs(moved) < Math.abs(step) * 0.5) { this.runner.shift(); seg.done?.(); }
  }

  // ============ 交互 ============
  bindInput() {
    const vp = this.stage.container;
    const center = () => {
      const p = new THREE.Vector3();
      this.dial.getWorldPosition(p);
      return this.stage.toScreen(p);
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      const hit = this.stage.raycast(e.clientX, e.clientY, this.dialPick, false);
      if (!hit.length || this.runner.length) return;
      e.stopPropagation(); e.preventDefault();
      const c = center();
      this.drag = { c, a: Math.atan2(-(e.clientY - c.y), e.clientX - c.x) };
      vp.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      if (this.drag) {
        const { c } = this.drag;
        const a = Math.atan2(-(e.clientY - c.y), e.clientX - c.x);
        let da = a - this.drag.a;
        if (da > Math.PI) da -= Math.PI * 2;
        if (da < -Math.PI) da += Math.PI * 2;
        this.drag.a = a;
        this.turnBy((da / (Math.PI * 2)) * 100);
        return;
      }
      if (vp.contains(e.target)) {
        const hit = this.stage.raycast(e.clientX, e.clientY, this.dialPick, false);
        vp.style.cursor = hit.length ? 'grab' : '';
      }
    };
    const onUp = () => { if (this.drag) { this.drag = null; vp.style.cursor = ''; } };
    const onWheel = (e) => {
      const hit = this.stage.raycast(e.clientX, e.clientY, this.dialPick, false);
      if (!hit.length || this.runner.length) return;
      e.preventDefault(); e.stopPropagation();
      this.turnBy(e.deltaY > 0 ? -1 : 1);
    };
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      const step = e.shiftKey ? 10 : 1;
      if (k === 'arrowleft' || k === 'a') { e.preventDefault(); this.turnBy(step); }
      if (k === 'arrowright' || k === 'd') { e.preventDefault(); this.turnBy(-step); }
    };
    vp.addEventListener('pointerdown', onDown, true);
    vp.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    this.disposers.push(() => {
      vp.removeEventListener('pointerdown', onDown, true);
      vp.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      vp.style.cursor = '';
    });
  }

  turnBy(dist) {
    if (this.runner.length || this.doorAngle > 0.02 && !this.doorOpenDemo) return;
    const n = Math.max(1, Math.ceil(Math.abs(dist) / 0.25));
    for (let i = 0; i < n; i++) this.applyD(this.D + dist / n);
    this.manualMoved = true;
  }

  // ============ 面板 ============
  buildUI() {
    const { ui } = this;
    ui.setLesson('保险柜拨盘锁', LESSON, TASKS);
    ui.setHint(DEFAULT_HINT);
    const c = ui.controls;
    this.modeSeg = h(`<div class="seg" style="width:100%">
      <button class="seg-item" data-v="learn" style="flex:1;padding:0 6px">学拨号</button>
      <button class="seg-item" data-v="peek" style="flex:1;padding:0 6px">费曼偷看</button>
      <button class="seg-item" data-v="guess" style="flex:1;padding:0 6px">猜密码</button>
      <button class="seg-item" data-v="manip" style="flex:1;padding:0 6px">操控</button>
    </div>`);
    this.modeSeg.onclick = (e) => { const v = e.target.dataset.v; if (v) this.setMode(v); };
    this.modePanel = h('<div class="controls"></div>');
    const toggles = h('<div class="row" style="gap:18px"></div>');
    toggles.append(
      toggle('透视柜门', this.xray, (v) => this.setXray(v)),
      toggle('教学提示', this.hints, (v) => { this.hints = v; }),
    );
    c.append(this.modeSeg, this.modePanel, h('<div class="divider"></div>'), toggles);

    this.hud = h(`<div class="overlay-card" style="min-width:210px">
      <h4>拨盘读数</h4>
      <div class="big-num" data-r>00.0</div>
      <div class="status-line" style="margin-top:4px" data-dir></div>
      <div class="row" style="margin-top:8px;gap:12px" data-wheels></div>
      <div class="status-line" style="margin-top:6px" data-lamp></div>
    </div>`);
    ui.overlay.append(this.hud);

    ui.setViewTools([
      { label: '正面', onClick: () => this.stage.flyTo([0, 10, 190], [0, 6, -10]) },
      { label: '斜视', onClick: () => this.stage.flyTo([70, 34, 200], [0, 4, -10]) },
      { label: '机构特写', onClick: () => this.stage.flyTo([-50, 96, 52], [0, 18, -13]) },
      { label: '侧面看轮片', onClick: () => this.stage.flyTo([-96, 36, -12], [0, 16, -13]) },
    ]);
  }

  setMode(mode) {
    this.mode = mode;
    this.runner = [];
    this.onOpen = null;
    this.onPickup = null;
    this.doorOpenDemo = false;
    this.doorTarget = 0;
    this.unlocked = false;
    this.tries = 0;
    this.modeSeg.querySelectorAll('.seg-item').forEach((b) => b.classList.toggle('active', b.dataset.v === mode));
    this.modePanel.innerHTML = '';
    this.chart = null;
    this.lampFor = null;
    clearInterval(this.scanTimer); this.scanTimer = null;
    this.ui.setHint(DEFAULT_HINT);
    ({ learn: () => this.modeLearn(), peek: () => this.modePeek(), guess: () => this.modeGuess(), manip: () => this.modeManip() })[mode]();
  }

  // ---- 模式 1：学拨号 ----
  modeLearn() {
    const { ui } = this;
    this.setCombo(randomCombo());
    const p = this.modePanel;
    const comboTxt = () => this.combo.map(pad2).join(' - ');
    p.append(h(`<div><span class="field-label">这只柜子的密码</span><div class="big-num" style="margin-top:4px" data-combo>${comboTxt()}</div></div>`));
    p.append(h(`<p class="muted" style="margin:0;line-height:1.6">标准拨号法：<b>左 4 圈</b>到第一个数 → <b>右 3 圈</b>到第二个数 → <b>左 2 圈</b>到第三个数 → <b>向右转到停</b>。先看演示，再自己拨一次。</p>`));
    const row = h('<div class="row"></div>');
    const demo = h('<button class="btn btn-sm btn-primary">自动演示拨号</button>');
    demo.onclick = () => {
      if (this.unlocked) this.closeDoor();
      this.manualMoved = false;
      this.run([...this.dialScript(this.combo, 110, true), { call: () => { ui.setHint('演示结束。现在关上门，自己按同样的步骤拨一次。'); ui.check('demo'); } }]);
      this.stage.flyTo([-50, 96, 52], [0, 18, -13]);
    };
    const close = h('<button class="btn btn-sm">关门并打乱</button>');
    close.onclick = () => { this.closeDoor(); this.manualMoved = false; ui.setHint(DEFAULT_HINT); };
    const fresh = h('<button class="btn btn-sm">换个密码</button>');
    fresh.onclick = () => { this.doorTarget = 0; this.setCombo(randomCombo()); p.querySelector('[data-combo]').textContent = comboTxt(); };
    row.append(demo, close, fresh);
    p.append(row);
    this.onOpen = () => { if (this.manualMoved) ui.check('manual'); };
    ui.setStatus('先看一遍自动演示，留意轮片是怎么被一片片“捡起来”的', 'info');
  }

  // ---- 模式 2：费曼偷看最后两位 ----
  modePeek() {
    const { ui } = this;
    this.setCombo(randomCombo());
    // 柜门开着：密码刚刚拨过，轮片还停在开锁位置
    this.dialInstant(this.combo);
    this.run([]);
    const steps = Math.ceil(mod(this.D - CAM_N) + RETRACT);
    for (let i = 0; i < steps; i++) this.applyD(this.D - 1, true);
    this.unlocked = false;
    this.doorOpenDemo = true;
    this.engaged = false;
    this.doorTarget = 0.28;
    this.found = [null, null];
    const p = this.modePanel;
    p.append(h(`<p style="margin:0;line-height:1.65">同事的柜子<b>开着</b>，他刚好走开。费曼假装闲聊，随手拨弄拨盘——此时轮片还停在开锁的位置上。</p>`));
    const rec = h(`<div class="overlay-card" style="box-shadow:none;background:var(--panel-2)"><h4>费曼的小纸条</h4><div class="big-num" data-rec>?? - ?? - ??</div></div>`);
    p.append(rec);
    const row = h('<div class="row"></div>');
    const b1 = h('<button class="btn btn-sm btn-primary">① 摸出最后一位</button>');
    const b2 = h('<button class="btn btn-sm" disabled>② 摸出第二位</button>');
    row.append(b1, b2);
    p.append(row);
    const grid = h(`<div style="display:none"><span class="field-label">③ 几天后柜子锁上了。利用 ±2 的容差，第一位只需每隔 5 试一次：</span><div class="num-grid" style="margin-top:8px">${Array.from({ length: 20 }, (_, i) => `<button class="btn" data-n="${i * 5}">${pad2(i * 5)}</button>`).join('')}</div><div class="status-line" style="margin-top:8px" data-tries></div></div>`);
    p.append(grid);
    const showRec = () => { rec.querySelector('[data-rec]').textContent = `?? - ${this.found[0] ?? '??'} - ${this.found[1] ?? '??'}`; };

    // 指示灯：栅栏还能落进缺口吗（= 关键轮片还停在缺口处）
    this.lampFor = [0, 1, 2];
    this.stage.flyTo([-50, 96, 52], [0, 18, -13]);
    ui.setStatus('柜门开着。点「摸出最后一位」看费曼的手法', 'info');

    b1.onclick = () => {
      if (this.runner.length) return;
      b1.disabled = true;
      this.lampFor = [0, 1, 2];
      ui.setHint('向<b>左</b>慢慢转：第 3 片轮片暂时不动（空转）。一旦驱动销“捡起”它，它离开缺口，栅栏被顶起——那一刻的读数就是最后一位');
      const free = this.w[2] + H - this.D - 5;
      this.run([
        { dist: Math.max(free, 0), speed: 60 },
        { until: () => !this.lampOn(), dir: 1, speed: 8, done: () => {
          const n = Math.round(mod(this.D - TOL));
          this.found[1] = pad2(n); showRec();
          sfx.thunk();
          ui.log(`最后一位 ≈ ${pad2(n)}（栅栏在 ${fmt(this.D)} 被顶起，减去容差）`, 'ok');
          ui.setHint(`记下：最后一位约是 <b>${pad2(n)}</b>。再用类似手法摸第二位。`);
          b2.disabled = false;
        } },
      ]);
    };
    b2.onclick = () => {
      if (this.runner.length) return;
      b2.disabled = true;
      this.lampFor = [0, 1];
      ui.setHint('向<b>右</b>转：先空转近一圈，再带着第 3 片走，直到第 2 片被捡起、离开缺口——那一刻的读数就是第二位');
      const free = this.D - (this.w[1] - 2 * H) - 5;
      this.run([
        { dist: -Math.max(free, 0), speed: 90 },
        { until: () => !this.lampOn(), dir: -1, speed: 8, done: () => {
          const n = Math.round(mod(this.D + TOL));
          this.found[0] = pad2(n); showRec();
          sfx.thunk();
          ui.log(`第二位 ≈ ${pad2(n)}`, 'ok');
          ui.check('peek');
          ui.setHint('拿到了后两位！柜门关上、密码被打乱。现在只差第一位——最多 20 次。');
          setTimeout(() => { this.doorOpenDemo = false; this.closeDoor(); this.lampFor = null; grid.style.display = ''; }, 900);
        } },
      ]);
    };
    const triesEl = grid.querySelector('[data-tries]');
    grid.onclick = (e) => {
      const n = e.target.dataset.n;
      if (n === undefined || this.runner.length) return;
      if (this.unlocked) { this.doorTarget = 0; this.unlocked = false; this.scramble(); }
      e.target.classList.add('tried');
      this.tries++;
      triesEl.innerHTML = `<span class="dot info"></span>已尝试 ${this.tries} 次（最多 20 次）`;
      const combo = [+n, +this.found[0], +this.found[1]];
      ui.setHint(`试拨 ${combo.map(pad2).join('-')} …`);
      this.run(this.dialScript(combo, 480));
    };
    this.onOpen = () => {
      ui.check('feynman');
      ui.setHint(`打开了！第 ${this.tries} 次。没有偷看时要试 8000 种（20³），偷看后只要 ≤ 20 次——这就是费曼的“魔术”。`);
      ui.toast(`真实密码是 ${this.combo.map(pad2).join('-')}`, 'ok', 4000);
    };
  }

  lampOn() {
    if (!this.lampFor) return false;
    const al = this.aligned();
    return this.lampFor.every((k) => al[k]);
  }

  // ---- 模式 3：猜密码 ----
  modeGuess() {
    const { ui } = this;
    const story = STORIES[(this.storyIdx = ((this.storyIdx ?? -1) + 1) % STORIES.length)];
    this.setCombo(story.combo);
    const p = this.modePanel;
    p.append(h(`<div><div class="field-label">${story.title}</div><p style="margin:6px 0 0;line-height:1.65">${story.text}</p></div>`));
    const inputs = h(`<div class="combo-inputs">
      <input class="input" maxlength="2" inputmode="numeric" placeholder="00"/>–<input class="input" maxlength="2" inputmode="numeric" placeholder="00"/>–<input class="input" maxlength="2" inputmode="numeric" placeholder="00"/>
      <button class="btn btn-sm btn-primary">拨号</button></div>`);
    const [i1, i2, i3] = inputs.querySelectorAll('input');
    const go = inputs.querySelector('button');
    const row = h('<div class="row"></div>');
    const hintBtn = h('<button class="btn btn-sm">给我一点提示</button>');
    const next = h('<button class="btn btn-sm">换一个柜子</button>');
    const out = h('<div class="status-line"></div>');
    row.append(hintBtn, next);
    p.append(inputs, row, out);
    hintBtn.onclick = () => { out.innerHTML = `<span class="dot warn"></span>${story.hint}`; };
    next.onclick = () => this.setMode('guess');
    go.onclick = () => {
      if (this.runner.length) return;
      const combo = [i1, i2, i3].map((x) => clamp(parseInt(x.value, 10) || 0, 0, 99));
      if (this.unlocked) { this.doorTarget = 0; this.unlocked = false; this.scramble(); }
      this.tries++;
      out.innerHTML = `<span class="dot info"></span>第 ${this.tries} 次：拨 ${combo.map(pad2).join('-')} …`;
      this.run([...this.dialScript(combo, 420), { call: () => { if (!this.unlocked) out.innerHTML = `<span class="dot danger"></span>${combo.map(pad2).join('-')} 打不开。再想想柜子主人是什么样的人。`; } }]);
    };
    this.onOpen = () => {
      ui.check('guess');
      out.innerHTML = `<span class="dot ok"></span>打开了！密码就是 ${story.combo.map(pad2).join('-')}。最弱的一环往往是人。`;
    };
    ui.setStatus('观察柜子的主人，猜猜他会用什么密码', 'info');
  }

  // ---- 模式 4：接触点操控 ----
  modeManip() {
    const { ui } = this;
    this.setCombo(randomCombo());
    const p = this.modePanel;
    p.append(h(`<p style="margin:0;line-height:1.65">密码未知。把三片轮片都停在同一个数 X，再测量凸轮缺口两侧的<b>接触点</b>。哪片轮片的缺口接近栅栏，接触点间距就会变窄。</p>`));
    const chartWrap = h(`<div><div class="row between"><span class="field-label">接触点间距 vs. 停放位置</span><span class="muted tabular" data-cur></span></div><canvas style="width:100%;height:150px;display:block;margin-top:6px;border-radius:12px;background:var(--panel-2)"></canvas></div>`);
    p.append(chartWrap);
    this.chart = { canvas: chartWrap.querySelector('canvas'), pts: [] };
    const row = h('<div class="row"></div>');
    const scan = h('<button class="btn btn-sm btn-primary">自动扫描 0→98</button>');
    const one = h(`<div class="combo-inputs"><input class="input" maxlength="2" placeholder="X"/><button class="btn btn-sm">停放并测量</button></div>`);
    row.append(scan);
    p.append(row, one);
    const tryRow = h(`<div><span class="field-label">根据低谷猜密码（顺序和偏移需要试）</span><div class="combo-inputs" style="margin-top:6px">
      <input class="input" maxlength="2" placeholder="00"/>–<input class="input" maxlength="2" placeholder="00"/>–<input class="input" maxlength="2" placeholder="00"/><button class="btn btn-sm">试开</button></div>
      <div class="status-line" style="margin-top:6px" data-out></div></div>`);
    p.append(tryRow);
    const reveal = h('<button class="btn btn-sm">揭晓答案</button>');
    p.append(reveal);
    reveal.onclick = () => { tryRow.querySelector('[data-out]').innerHTML = `<span class="dot warn"></span>答案：${this.combo.map(pad2).join('-')}`; };

    const measure = (x) => {
      // 左 4 圈停在 X：三片轮片都被向左带动
      const w = [x - 3 * H, x - 2 * H, x - H];
      const hw = this.contactHalfWidth(w);
      return { x, width: 2 * hw };
    };
    one.querySelector('button').onclick = () => {
      const x = clamp(parseInt(one.querySelector('input').value, 10) || 0, 0, 99);
      if (this.runner.length) return;
      this.run([
        { dirFn: () => ({ dist: (mod(x - mod(this.D)) || 100) + 300 }), speed: 480 },
        { dirFn: () => ({ dist: -(mod(mod(this.D) - CAM_N) - 3.8) }), speed: 160 },
        { call: () => { const m = measure(x); this.addPoint(m); chartWrap.querySelector('[data-cur]').textContent = `X=${pad2(x)} 间距 ${m.width.toFixed(2)}`; } },
      ]);
    };
    scan.onclick = () => {
      if (this.scanTimer) return;
      this.chart.pts = [];
      let x = 0;
      this.scanTimer = setInterval(() => {
        const m = measure(x);
        this.addPoint(m);
        chartWrap.querySelector('[data-cur]').textContent = `X=${pad2(x)} 间距 ${m.width.toFixed(2)}`;
        this.D = x; this.w = [x - 3 * H, x - 2 * H, x - H];
        sfx.detent();
        x += 2;
        if (x > 98) { clearInterval(this.scanTimer); this.scanTimer = null; ui.check('graph'); ui.setHint('看图找低谷：每个低谷对应一片轮片的缺口。用这几个数排列组合去试。'); }
      }, 70);
    };
    this.disposers.push(() => clearInterval(this.scanTimer));
    const [t1, t2, t3] = tryRow.querySelectorAll('input');
    tryRow.querySelector('button').onclick = () => {
      if (this.runner.length) return;
      const combo = [t1, t2, t3].map((x) => clamp(parseInt(x.value, 10) || 0, 0, 99));
      if (this.unlocked) { this.doorTarget = 0; this.unlocked = false; this.scramble(); }
      this.tries++;
      tryRow.querySelector('[data-out]').innerHTML = `<span class="dot info"></span>第 ${this.tries} 次：${combo.map(pad2).join('-')}`;
      this.run([...this.dialScript(combo, 460), { call: () => { if (!this.unlocked) tryRow.querySelector('[data-out]').innerHTML = `<span class="dot danger"></span>${combo.map(pad2).join('-')} 没开（第 ${this.tries} 次）`; } }]);
    };
    this.onOpen = () => { ui.check('manip'); tryRow.querySelector('[data-out]').innerHTML = `<span class="dot ok"></span>操控成功！用了 ${this.tries} 次尝试。`; };
    ui.setStatus('点「自动扫描」画出接触点曲线，找三个低谷', 'info');
    this.drawChart();
  }

  addPoint(m) {
    const pts = this.chart.pts.filter((p) => p.x !== m.x);
    pts.push(m);
    pts.sort((a, b) => a.x - b.x);
    this.chart.pts = pts;
    this.drawChart();
  }

  drawChart() {
    const ch = this.chart;
    if (!ch) return;
    const cv = ch.canvas;
    const dpr = Math.min(devicePixelRatio, 2);
    const W = cv.clientWidth || 300, Hh = cv.clientHeight || 150;
    cv.width = W * dpr; cv.height = Hh * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(document.documentElement);
    const line = cs.getPropertyValue('--line').trim(), t3 = cs.getPropertyValue('--text-3').trim(), pri = cs.getPropertyValue('--primary').trim();
    const pad = { l: 30, r: 8, t: 10, b: 20 };
    const yMin = 5.6, yMax = 7.0;
    const X = (x) => pad.l + (x / 100) * (W - pad.l - pad.r);
    const Y = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (Hh - pad.t - pad.b);
    g.font = '10px ' + getComputedStyle(document.body).fontFamily;
    g.fillStyle = t3; g.strokeStyle = line; g.lineWidth = 1;
    for (let x = 0; x <= 100; x += 20) { g.beginPath(); g.moveTo(X(x) + 0.5, pad.t); g.lineTo(X(x) + 0.5, Hh - pad.b); g.stroke(); g.fillText(String(x), X(x) - 5, Hh - 6); }
    for (const y of [6.0, 6.5]) { g.beginPath(); g.moveTo(pad.l, Y(y) + 0.5); g.lineTo(W - pad.r, Y(y) + 0.5); g.stroke(); g.fillText(y.toFixed(1), 4, Y(y) + 3); }
    if (!ch.pts.length) return;
    g.strokeStyle = pri; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath();
    ch.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.width)) : g.moveTo(X(p.x), Y(p.width))));
    g.stroke();
    g.fillStyle = pri;
    for (const p of ch.pts) { g.beginPath(); g.arc(X(p.x), Y(p.width), 2, 0, Math.PI * 2); g.fill(); }
  }

  // ============ 每帧 ============
  update(dt) {
    this.stepRunner(dt);

    // 门
    this.doorAngle += (this.doorTarget - this.doorAngle) * Math.min(1, dt * 3.2);
    this.door.rotation.y = -this.doorAngle * THREE.MathUtils.degToRad(100);
    const handleT = this.unlocked || this.doorOpenDemo ? 1 : 0;
    this.handle.rotation.z += ((handleT * -Math.PI) / 2 - this.handle.rotation.z) * Math.min(1, dt * 8);

    // 拨盘与轮片
    this.dial.rotation.z = (this.D / 100) * Math.PI * 2;
    this.cam.rotation.z = ((this.D - CAM_N) / 100) * Math.PI * 2;
    const al = this.aligned();
    this.wheels.forEach((wh, k) => {
      wh.g.rotation.z = ((this.w[k] - this.G[k]) / 100) * Math.PI * 2;
      const on = this.hints && al[k];
      wh.mat.emissive.copy(on ? STATE.set : BLACK);
      wh.mat.emissiveIntensity = on ? 0.35 : 0;
    });

    // 杠杆下落深度
    const c = wrapS(this.D - CAM_N);
    let dropT = 0;
    if (this.engaged || (this.doorOpenDemo && this.lampOn())) dropT = 2.6;
    else if (Math.abs(c) < 4) dropT = clamp((3.4 - this.contactHalfWidth()) * 0.9, 0, 0.6) * (1 - Math.abs(c) / 4);
    this.drop += (dropT - this.drop) * Math.min(1, dt * 14);
    this.lever.position.y = -this.drop;
    const retract = this.doorOpenDemo ? 1 : this.retract;
    this.bolt.position.x += (-10 * retract - this.bolt.position.x) * Math.min(1, dt * 12);
    this.fenceMat.emissive.copy(this.hints && al.every(Boolean) ? STATE.set : BLACK);
    this.fenceMat.emissiveIntensity = 0.4;

    // HUD
    const hud = this.hud;
    hud.querySelector('[data-r]').textContent = fmt(this.D);
    const dirTxt = this.lastDir > 0 ? '向左 ↺' : this.lastDir < 0 ? '向右 ↻' : '—';
    hud.querySelector('[data-dir]').innerHTML = `<span class="dot info"></span>${dirTxt} · 本方向已转 ${(this.dirAccum / 100).toFixed(2)} 圈`;
    hud.querySelector('[data-wheels]').innerHTML = [0, 1, 2].map((k) => `<span class="status-line"><span class="dot ${this.hints ? (al[k] ? 'ok' : '') : ''}"></span>轮片 ${k + 1}</span>`).join('');
    const lamp = hud.querySelector('[data-lamp]');
    if (this.lampFor) lamp.innerHTML = `<span class="dot ${this.lampOn() ? 'ok' : 'danger'}"></span>栅栏${this.lampOn() ? '仍在缺口里' : '被顶起了'}`;
    else lamp.innerHTML = this.engaged ? '<span class="dot ok"></span>杠杆已钩住凸轮，继续向右' : Math.abs(c) < 4 ? '<span class="dot warn"></span>在凸轮接触区' : '';

    // 手感
    let feel = { v: 0.05, label: '拨盘空转', kind: '' };
    if (this.engaged) feel = { v: 0.55 + this.retract * 0.4, label: '在拉锁栓', kind: 'ok' };
    else if (Math.abs(c) < this.contactHalfWidth() + 0.4 && Math.abs(c) > this.contactHalfWidth() - 0.4) feel = { v: 0.8, label: '接触点 · 鼻子碰到缺口壁', kind: 'warn' };
    else if (Math.abs(c) < 4) feel = { v: 0.3, label: '接触区', kind: 'warn' };
    else if (this.movedT > 0) {
      const n = this.carried();
      feel = { v: 0.1 + n * 0.08, label: n ? `正在带动 ${n} 片轮片` : '空转（还没碰到轮片）', kind: '' };
    }
    this.movedT = Math.max(0, (this.movedT || 0) - dt);
    this.ui.feel(feel.v + (Math.random() - 0.5) * 0.02, feel.label, feel.kind);
  }
}

const BLACK = new THREE.Color(0);
const DEFAULT_HINT = '拖动拨盘旋转（或在拨盘上滚轮） · <kbd>←</kbd>/<kbd>A</kbd> 向左 · <kbd>→</kbd>/<kbd>D</kbd> 向右 · 按住 <kbd>Shift</kbd> 每次 10 格';
function rand(a, b) { return a + Math.random() * (b - a); }

const LESSON = [
  {
    id: 'principle', title: '原理', html: `
    <h3>拨盘锁的内部</h3>
    <p>拨盘通过转轴带动最前面的<span class="term">驱动凸轮</span>。凸轮后面依次套着三片<span class="term">轮片</span>（打开「透视柜门」，从「机构特写」看），每片边缘都有一个<span class="term">缺口</span>。</p>
    <p>轮片上方压着一根<span class="term">栅栏</span>（杠杆的一部分）。只有当三片轮片的缺口<b>同时</b>转到正上方，栅栏才能落下，杠杆的“鼻子”才能被凸轮缺口钩住，把锁栓拉回来。</p>
    <h3>空转：为什么要转那么多圈</h3>
    <p>轮片之间不是刚性连接：凸轮上的销子要转将近<b>一整圈</b>才会碰到第 3 片的拨片，第 3 片又要再转一圈才会带动第 2 片……</p>
    <ul>
      <li><b>左 4 圈</b>：把三片全部“捡起来”，第 4 次到达第一个数时，最远的<b>第 1 片</b>停在位。</li>
      <li><b>右 3 圈</b>：换方向后先空转，再依次带动第 3、第 2 片；第 1 片不受影响。</li>
      <li><b>左 2 圈</b>：只转动最近的<b>第 3 片</b>。</li>
      <li><b>向右到停</b>：缺口对齐时，杠杆落入凸轮，锁栓被拉回。</li>
    </ul>
    <div class="note">拨盘时留意右侧手感曲线和“咔”声：每当一片轮片被带动，你都会听到一下。</div>`,
  },
  {
    id: 'feynman', title: '费曼三招', html: `
    <h3>① 容差：100 万 → 8000</h3>
    <p>费曼发现，他们用的档案柜拨盘锁并不要求精确对准：<b>偏差 ±2 以内都能打开</b>。所以每个数只需每隔 5 试一次，每片只有 20 个有效位置。</p>
    <p class="math">100 × 100 × 100 = 1,000,000 &nbsp;→&nbsp; 20 × 20 × 20 = 8,000</p>
    <h3>② 偷看后两位：8000 → 20</h3>
    <p>柜子开着时，轮片还停在开锁位置。费曼一边和主人聊天，一边随手拨弄拨盘，通过锁栓的手感摸出了<b>最后一个数</b>，再用类似办法摸出<b>倒数第二个数</b>。回头再来时，只剩第一个数——最多 20 次。</p>
    <p>在「费曼偷看」模式里，指示灯代替了他指尖感受到的锁栓松紧。</p>
    <h3>③ 人：直接猜</h3>
    <p>很多人从不改出厂密码，或者用自己熟悉的数字当密码。费曼就用数学常数打开过同事的柜子。「猜密码」模式里有三个这样的柜子。</p>
    <div class="note">费曼的结论：安全感很多时候是错觉。真正的问题不是“锁有多复杂”，而是“它在每一步泄露了多少信息”。</div>`,
  },
  {
    id: 'manip', title: '操控法', html: `
    <h3>不偷看也能开：接触点</h3>
    <p>专业开锁匠会在凸轮缺口附近来回轻转拨盘，感受杠杆鼻子碰到缺口两壁的位置——<span class="term">左接触点</span>和<span class="term">右接触点</span>。</p>
    <p>栅栏压在轮片边缘上。当某片轮片的缺口<b>靠近</b>栅栏时，栅栏能稍微往下沉一点，鼻子在凸轮缺口里落得更深，两个接触点的间距就会<b>变窄</b>一点点。</p>
    <ol>
      <li>左 4 圈，把三片都停在同一个数 X；</li>
      <li>向右转到接触区，记录两个接触点；</li>
      <li>换 X（每次加 2–3），画出“间距 vs. X”曲线；</li>
      <li>曲线上的<b>低谷</b>就是各片缺口的位置。再用排列组合确认顺序。</li>
    </ol>
    <div class="note">低谷的位置和真实密码可能差一两个数：第 2 片在真实拨号时是向右带动的，拨片有宽度，换方向会产生一点偏移。好在容差是 ±2，必要时在低谷附近 ±2 再试一下。</div>`,
  },
];

const TASKS = [
  { id: 'demo', text: '看一遍自动拨号演示' },
  { id: 'manual', text: '自己手动拨号打开柜子' },
  { id: 'peek', text: '用费曼的手法摸出后两位' },
  { id: 'feynman', text: '在 20 次以内试出第一位，打开柜子' },
  { id: 'guess', text: '靠观察主人猜中一组密码' },
  { id: 'graph', text: '画出一条完整的接触点曲线' },
  { id: 'manip', text: '用操控法打开柜子' },
];
