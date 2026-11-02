// 用 WebAudio 现场合成的机械声：没有音频文件
let ctx = null;
let muted = false;
let noiseBuf = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setMuted(v) { muted = v; }
export function isMuted() { return muted; }

// 一次带通滤波的噪声脉冲 = 金属"咔"
function burst({ freq = 3000, q = 6, dur = 0.04, gain = 0.4, delay = 0 }) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function tone({ freq = 220, dur = 0.12, gain = 0.15, type = 'sine', delay = 0, slide = 0 }) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let lastTick = 0;
export const sfx = {
  unlock() { ac(); },
  // 弹子到达剪切线
  set() { burst({ freq: 4200, q: 9, dur: 0.035, gain: 0.55 }); burst({ freq: 1800, q: 4, dur: 0.05, gain: 0.25, delay: 0.004 }); },
  // 防盗弹子假开：更"空"更大的一下
  falseSet() { burst({ freq: 1400, q: 3, dur: 0.09, gain: 0.5 }); tone({ freq: 160, dur: 0.12, gain: 0.12 }); },
  // 摩擦 / 卡住的轻微刮擦
  scrape(intensity = 0.5) {
    const now = performance.now();
    if (now - lastTick < 55) return;
    lastTick = now;
    burst({ freq: 2400 + Math.random() * 1500, q: 2, dur: 0.02, gain: 0.08 * intensity });
  },
  // 弹簧回弹
  spring() { tone({ freq: 900, dur: 0.08, gain: 0.04, type: 'triangle', slide: 0.6 }); },
  // 弹子全部掉回
  drop() { for (let i = 0; i < 4; i++) burst({ freq: 2600 + i * 500, q: 5, dur: 0.03, gain: 0.25, delay: i * 0.035 }); },
  // 过度抬升卡死
  jam() { burst({ freq: 700, q: 2, dur: 0.12, gain: 0.45 }); },
  // 锁芯转开 / 门打开
  open() { burst({ freq: 900, q: 1.5, dur: 0.18, gain: 0.6 }); tone({ freq: 110, dur: 0.3, gain: 0.2, slide: 0.7 }); burst({ freq: 3000, q: 6, dur: 0.05, gain: 0.3, delay: 0.12 }); },
  // 拨盘/数字轮的刻度声
  detent(soft = false) {
    const now = performance.now();
    if (now - lastTick < 18) return;
    lastTick = now;
    burst({ freq: soft ? 3200 : 5200, q: 10, dur: 0.012, gain: soft ? 0.12 : 0.18 });
  },
  // 接触点 / 落入缺口的闷响
  thunk() { burst({ freq: 600, q: 2, dur: 0.07, gain: 0.45 }); },
  success() { tone({ freq: 660, dur: 0.12, gain: 0.08 }); tone({ freq: 880, dur: 0.18, gain: 0.08, delay: 0.1 }); },
};
