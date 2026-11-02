// 右侧面板与视口浮层的 UI 工具。各把锁通过它说话。
const $ = (id) => document.getElementById(id);

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return null; }
  return null;
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function createUI() {
  const statusEl = $('status');
  const hintEl = $('hint');
  const toastsEl = $('toasts');
  const logEl = $('log');
  const feelLabel = $('feel-label');
  const feelCanvas = $('feel-canvas');
  const lessonTabs = $('lesson-tabs');
  const lessonBody = $('lesson-body');
  const lessonTitle = $('lesson-title');

  const samples = new Array(180).fill(0);
  let feelKind = '';
  let colors = {};
  let tasksState = { key: '', items: [], done: new Set() };
  let lesson = null;
  let activeLessonTab = null;
  const t0 = performance.now();

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = {
      line: cs.getPropertyValue('--line').trim(),
      text3: cs.getPropertyValue('--text-3').trim(),
      primary: cs.getPropertyValue('--primary').trim(),
      warning: cs.getPropertyValue('--warning').trim(),
      success: cs.getPropertyValue('--success').trim(),
      danger: cs.getPropertyValue('--danger').trim(),
    };
  }
  readColors();

  function drawFeel() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = feelCanvas.clientWidth, hgt = feelCanvas.clientHeight;
    if (feelCanvas.width !== w * dpr) { feelCanvas.width = w * dpr; feelCanvas.height = hgt * dpr; }
    const c = feelCanvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, hgt);
    c.strokeStyle = colors.line;
    c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((hgt / 4) * i) + 0.5;
      c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
    }
    const col = { warn: colors.warning, ok: colors.success, danger: colors.danger }[feelKind] || colors.primary;
    c.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = (i / (samples.length - 1)) * w;
      const y = hgt - 6 - samples[i] * (hgt - 12);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.stroke();
    c.lineTo(w, hgt); c.lineTo(0, hgt); c.closePath();
    c.globalAlpha = 0.1; c.fillStyle = col; c.fill(); c.globalAlpha = 1;
    c.fillStyle = colors.text3;
    c.font = '10px ' + getComputedStyle(document.body).fontFamily;
    c.fillText('阻力', 6, 13);
  }

  function renderLesson() {
    if (!lesson) return;
    lessonTabs.innerHTML = '';
    for (const tab of lesson.tabs) {
      const b = h(`<button class="seg-item${tab.id === activeLessonTab ? ' active' : ''}">${tab.title}</button>`);
      b.onclick = () => { activeLessonTab = tab.id; renderLesson(); };
      lessonTabs.appendChild(b);
    }
    const tab = lesson.tabs.find((t) => t.id === activeLessonTab) || lesson.tabs[0];
    if (tab.id === 'tasks') {
      const done = tasksState.done;
      lessonBody.innerHTML = `<div class="task-meta">已完成 ${[...done].filter((d) => tasksState.items.some((t) => t.id === d)).length} / ${tasksState.items.length} · 进度自动保存在本机</div>
        <ul class="tasks">${tasksState.items.map((t) => `<li data-id="${t.id}" class="${done.has(t.id) ? 'done' : ''}"><span class="check"></span><span class="task-text">${t.text}</span></li>`).join('')}</ul>`;
    } else {
      lessonBody.innerHTML = tab.html;
    }
  }

  const ui = {
    controls: $('controls'),
    overlay: $('overlay'),
    viewTools: $('view-tools'),

    themeChanged() { readColors(); },

    setStatus(text, kind = 'info') {
      statusEl.querySelector('.dot').className = 'dot ' + kind;
      statusEl.querySelector('.pill-text').textContent = text;
    },

    setHint(html) {
      hintEl.innerHTML = html ? `<div class="hint">${html}</div>` : '';
    },

    toast(text, kind = 'info', ms = 2400) {
      const el = h(`<div class="toast"><span class="dot ${kind}"></span><span></span></div>`);
      el.lastChild.textContent = text;
      toastsEl.appendChild(el);
      while (toastsEl.children.length > 3) toastsEl.firstChild.remove();
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
    },

    log(text, kind = 'info') {
      const s = ((performance.now() - t0) / 1000).toFixed(1).padStart(5, ' ');
      const li = h(`<li><span class="t">${s}s</span><span class="dot ${kind}"></span><span></span></li>`);
      li.lastChild.textContent = text;
      logEl.prepend(li);
      while (logEl.children.length > 40) logEl.lastChild.remove();
    },

    clearLog() { logEl.innerHTML = ''; },

    // 每帧调用：value 0..1 表示指尖感到的阻力
    feel(value, label, kind = '') {
      samples.push(Math.max(0, Math.min(1, value)));
      samples.shift();
      feelKind = kind;
      if (label !== undefined && feelLabel.dataset.v !== label + kind) {
        feelLabel.dataset.v = label + kind;
        feelLabel.innerHTML = `<span class="dot ${kind || 'info'}"></span>${label}`;
      }
      drawFeel();
    },

    setLesson(title, tabs, tasks) {
      lessonTitle.textContent = title;
      lesson = { tabs: [...tabs, { id: 'tasks', title: '任务' }] };
      activeLessonTab = tabs[0].id;
      const key = 'lockpick.tasks.' + title;
      tasksState = { key, items: tasks, done: new Set(store(key) || []) };
      renderLesson();
    },

    showLessonTab(id) { activeLessonTab = id; renderLesson(); },

    check(id) {
      if (tasksState.done.has(id)) return;
      const item = tasksState.items.find((t) => t.id === id);
      if (!item) return;
      tasksState.done.add(id);
      store(tasksState.key, [...tasksState.done]);
      ui.toast('任务完成：' + item.text.replace(/<[^>]+>/g, ''), 'ok', 2800);
      if (activeLessonTab === 'tasks') {
        renderLesson();
        lessonBody.querySelector(`li[data-id="${id}"]`)?.classList.add('just-done');
      }
    },

    // 视口右上角的工具按钮
    setViewTools(items) {
      ui.viewTools.innerHTML = '';
      for (const it of items) {
        const b = h(`<button class="tool-btn${it.active ? ' active' : ''}">${it.label}</button>`);
        b.onclick = () => {
          const r = it.onClick(b);
          if (it.toggle) b.classList.toggle('active', !!r);
        };
        ui.viewTools.appendChild(b);
      }
    },

    reset() {
      ui.controls.innerHTML = '';
      ui.overlay.innerHTML = '';
      ui.viewTools.innerHTML = '';
      ui.setHint('');
      ui.clearLog();
      samples.fill(0);
      drawFeel();
    },
  };
  return ui;
}

// 带区间着色的滑块（例如张力：过轻 / 合适 / 过重）
export function zoneSlider({ label, min = 0, max = 100, value = 0, zones = [], format = (v) => v }) {
  const el = h(`<div class="slider-wrap">
    <div class="slider-top"><span class="field-label">${label}</span><span class="slider-val"></span></div>
    <input type="range" min="${min}" max="${max}" value="${value}" step="1" />
    <div class="zone-bar">${zones.map((z) => `<span style="left:${((z.from - min) / (max - min)) * 100}%;width:${((z.to - z.from) / (max - min)) * 100}%;background:var(${z.color});opacity:${z.opacity ?? 0.55}"></span>`).join('')}</div>
  </div>`);
  const input = el.querySelector('input');
  const val = el.querySelector('.slider-val');
  const update = () => { val.textContent = format(+input.value); };
  input.addEventListener('input', update);
  update();
  return {
    el, input,
    get value() { return +input.value; },
    set value(v) { input.value = v; update(); },
  };
}

export function toggle(label, checked, onChange) {
  const el = h(`<label class="toggle"><input type="checkbox" ${checked ? 'checked' : ''}/><span class="switch"></span><span>${label}</span></label>`);
  el.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
  return el;
}
