import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = true;
evaluator.consolidateGroups = true;

function toBrush(geo, mat, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  // 统一只保留 position / normal，避免属性不一致
  const clean = new THREE.BufferGeometry();
  clean.setAttribute('position', g.getAttribute('position'));
  clean.setAttribute('normal', g.getAttribute('normal'));
  const b = new Brush(clean, mat);
  b.position.set(...pos);
  b.rotation.set(...rot);
  b.updateMatrixWorld();
  return b;
}

// 布尔建模：base 依次与 ops 做加/减。op: { geo, pos, rot, mode: 'sub' | 'add', mat }
// 被减去的面会使用 op.mat（例如剖面用哑光材质），返回 { geometry, material[] }
export function csg(base, mat, ops) {
  let res = toBrush(base, mat);
  for (const op of ops) {
    const b = toBrush(op.geo, op.mat || mat, op);
    res = evaluator.evaluate(res, b, op.mode === 'add' ? ADDITION : SUBTRACTION);
    res.updateMatrixWorld();
  }
  res.geometry.computeBoundingSphere();
  return { geometry: res.geometry, material: res.material };
}

export function csgMesh(base, mat, ops) {
  const r = csg(base, mat, ops);
  const m = new THREE.Mesh(r.geometry, r.material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// 轴沿 X 的圆柱
export function cylX(r, len, seg = 64) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}
// 轴沿 Z 的圆柱
export function cylZ(r, len, seg = 64) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}
