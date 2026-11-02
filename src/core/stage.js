import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// 共享的 3D 舞台：渲染器、相机、轨道控制、灯光、阴影地面。每把锁挂一个 root 组上来。
export class Stage {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.dom = renderer.domElement;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);
    this.camera.position.set(0, 20, 120);

    const controls = new OrbitControls(this.camera, this.dom);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    this.controls = controls;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a92, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(40, 90, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    this.keyLight = key;
    const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
    rim.position.set(-70, 40, -60);
    scene.add(rim);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 1200),
      new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    this.frameFns = new Set();
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.tween = null;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 竖屏时保持水平视角不变，避免锁被左右裁掉
    const a = w / h, base = 32, ref = 1.3;
    this.camera.fov = a >= ref ? base : THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(base / 2)) * ref) / a));
    this.camera.updateProjectionMatrix();
  }

  // 每把锁设置自己的阴影范围与地面高度
  setShadowFrame({ center = [0, 0, 0], size = 60, groundY = -30 }) {
    const c = new THREE.Vector3(...center);
    this.ground.position.y = groundY;
    const cam = this.keyLight.shadow.camera;
    cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
    this.keyLight.target.position.copy(c);
    this.keyLight.position.copy(c).add(new THREE.Vector3(50, 110, 80));
  }

  setLimits({ minDistance = 10, maxDistance = 400 } = {}) {
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
  }

  // 平滑飞到某个视角
  flyTo(pos, target, dur = 0.9) {
    this.tween = {
      t: 0, dur,
      p0: this.camera.position.clone(), p1: new THREE.Vector3(...pos),
      t0: this.controls.target.clone(), t1: new THREE.Vector3(...target),
    };
  }

  jumpTo(pos, target) {
    this.tween = null;
    this.camera.position.set(...pos);
    this.controls.target.set(...target);
    this.controls.update();
  }

  onFrame(fn) { this.frameFns.add(fn); return () => this.frameFns.delete(fn); }

  ndc(clientX, clientY) {
    const r = this.dom.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  raycast(clientX, clientY, objects, recursive = true) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  // 把一个世界坐标点投到屏幕像素坐标
  toScreen(v) {
    const p = v.clone().project(this.camera);
    const r = this.dom.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }

  // 在某个世界点附近，1 屏幕像素对应多少世界单位
  worldPerPixel(at) {
    const d = this.camera.position.distanceTo(at);
    const h = this.dom.clientHeight || 1;
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (this.paused) return;
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = Math.min(tw.t / tw.dur, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.lerpVectors(tw.p0, tw.p1, e);
      this.controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (k >= 1) this.tween = null;
    }
    for (const fn of this.frameFns) fn(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// 递归释放一个对象树的几何与材质（共享材质由 materials.js 管理，这里跳过）
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData.shared) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}
