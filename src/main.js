import './styles/tokens.css';
import './styles/app.css';
import { Stage } from './core/stage.js';
import { createUI } from './ui.js';
import { sfx, setMuted, isMuted } from './core/audio.js';
import { renderHome } from './home.js';

const LOCKS = {
  pin: () => import('./locks/pinTumbler.js').then((m) => m.PinTumblerLock),
  safe: () => import('./locks/safeDial.js').then((m) => m.SafeDialLock),
  wheel: () => import('./locks/wheelLock.js').then((m) => m.WheelComboLock),
};

const ui = createUI();
const stage = new Stage(document.getElementById('viewport'));
const homeEl = document.getElementById('home');
const loadingEl = document.getElementById('loading');
let current = null;
let currentTab = null;
let switchToken = 0;

// 主题
const themeBtn = document.getElementById('btn-theme');
const soundBtn = document.getElementById('btn-sound');
const ICON = {
  sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  sound: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 10l5 5M21 10l-5 5"/></svg>',
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.innerHTML = theme === 'dark' ? ICON.sun : ICON.moon;
  try { localStorage.setItem('lockpick.theme', theme); } catch { /* 私密模式 */ }
  ui.themeChanged();
}
let savedTheme = null;
try { savedTheme = localStorage.getItem('lockpick.theme'); } catch { /* ignore */ }
applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

function renderSoundBtn() { soundBtn.innerHTML = isMuted() ? ICON.mute : ICON.sound; }
soundBtn.onclick = () => { setMuted(!isMuted()); renderSoundBtn(); };
renderSoundBtn();
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// 页签切换
async function go(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  const token = ++switchToken;
  document.querySelectorAll('#tabs .seg-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  try { history.replaceState(null, '', '#' + tab); } catch { /* ignore */ }

  // 首页盖住视口时暂停渲染
  stage.paused = tab === 'home';
  if (tab === 'home') {
    homeEl.classList.add('show');
    return;
  }
  homeEl.classList.remove('show');
  if (current) { current.dispose(); current = null; }
  ui.reset();
  loadingEl.classList.add('show');
  const Cls = await LOCKS[tab]();
  await new Promise((r) => setTimeout(r, 30)); // 让加载提示先画出来
  if (token !== switchToken) return;
  current = new Cls({ stage, ui });
  current.mount();
  if (import.meta.env.DEV) window.__lock = current;
  loadingEl.classList.remove('show');
}

document.querySelectorAll('#tabs .seg-item').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
renderHome(homeEl, go);

const initial = location.hash.slice(1);
go(LOCKS[initial] ? initial : 'home');
window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1);
  if (LOCKS[t] || t === 'home') go(t);
});
