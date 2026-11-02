import * as THREE from 'three';

function std(params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.shared = true;
  return m;
}

// 共享 PBR 材质。改变透明度等会影响所有使用者，所以需要单独控制的地方用 .clone()
export const M = {
  brass: std({ color: 0xd4a94f, metalness: 1, roughness: 0.3 }),
  brassDark: std({ color: 0xb08a3a, metalness: 1, roughness: 0.42 }),
  nickel: std({ color: 0xc9ccd2, metalness: 1, roughness: 0.34 }),
  steel: std({ color: 0xd9dde3, metalness: 1, roughness: 0.22 }),
  steelDark: std({ color: 0x6d737c, metalness: 1, roughness: 0.38 }),
  blued: std({ color: 0x5b6472, metalness: 1, roughness: 0.3 }),
  spring: std({ color: 0xe6e8ec, metalness: 1, roughness: 0.18 }),
  rubber: std({ color: 0x1f2124, metalness: 0, roughness: 0.7 }),
  paint: std({ color: 0x3d4247, metalness: 0.35, roughness: 0.55 }),
  paintDark: std({ color: 0x24272b, metalness: 0.3, roughness: 0.6 }),
  black: std({ color: 0x141518, metalness: 0.2, roughness: 0.5 }),
  aluminum: std({ color: 0xb9bec6, metalness: 1, roughness: 0.4 }),
  zinc: std({ color: 0x8e949c, metalness: 1, roughness: 0.48 }),
  // 剖面：哑光，和零件表面区分开
  cutNickel: std({ color: 0x9aa0a8, metalness: 0.55, roughness: 0.62 }),
  cutBrass: std({ color: 0xb8924a, metalness: 0.6, roughness: 0.55 }),
  cutSteel: std({ color: 0x80868e, metalness: 0.55, roughness: 0.6 }),
};

// 可单独控制透明度的材质
export function ghost(base, opacity = 0.25) {
  const m = base.clone();
  m.userData = {};
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  return m;
}

// 状态高亮（只用于表达状态：卡住 / 已设定 / 当前选择）
export const STATE = {
  binding: new THREE.Color(0xff9f0a),
  set: new THREE.Color(0x30d158),
  select: new THREE.Color(0x0a84ff),
  danger: new THREE.Color(0xff453a),
};
