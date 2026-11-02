// 首页：费曼的开锁哲学 + 三把锁的入口
const ICONS = {
  pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v7M10 9.5h4"/></svg>',
  safe: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v2.5"/></svg>',
  wheel: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="7" width="18" height="10" rx="3"/><path d="M8 7v10M12 7v10M16 7v10"/></svg>',
};

export function renderHome(el, go) {
  el.innerHTML = `<div class="home-inner">
    <div class="eyebrow">开锁实验室 · Lockpicking Lab</div>
    <h1>像费曼一样，<br/>把锁拆开来理解。</h1>
    <p class="lead">费曼在洛斯阿拉莫斯参与原子弹项目期间，把撬保险柜当成了业余爱好。他从不靠蛮力或神秘手法——而是认真研究锁的构造，找到设计与制造中的“漏洞”，把看似不可能的搜索空间缩小到几分钟就能试完。这里用 3D 剖面把三种最常见的锁拆给你看，并让你亲手试一试。</p>
    <div class="hero-actions">
      <button class="btn btn-primary btn-lg" data-go="pin">从弹子锁开始</button>
      <button class="btn btn-lg" data-go="safe">直接挑战费曼的保险柜</button>
    </div>

    <h2 class="section">三把锁，三种思路</h2>
    <div class="lock-cards">
      <button class="lock-card" data-go="pin">
        <span class="ico-box" style="background:#0071e3">${ICONS.pin}</span>
        <h3>弹子锁</h3>
        <p>家门、抽屉上最常见的锁。学习张力扳手 + 单针挑拨（SPP）、耙子快速开锁、防盗弹子带来的“假开”，以及过度抬升的陷阱。</p>
        <span class="go">剖开来看 →</span>
      </button>
      <button class="lock-card" data-go="safe">
        <span class="ico-box" style="background:#c93400">${ICONS.safe}</span>
        <h3>保险柜拨盘锁</h3>
        <p>费曼最得意的战场。理解轮片组、空转与栅栏，学会“左四右三左二”的拨号法，再用费曼的三招把 100 万种组合砍到 20 次。</p>
        <span class="go">挑战费曼 →</span>
      </button>
      <button class="lock-card" data-go="wheel">
        <span class="ico-box" style="background:#248a3d">${ICONS.wheel}</span>
        <h3>数字轮密码锁</h3>
        <p>行李箱、自行车上的 4 位密码锁。用拉力找出“卡住”的那一轮，或者从缝隙里看到内套的缺口——一万种组合只需不到十次尝试。</p>
        <span class="go">动手解码 →</span>
      </button>
    </div>

    <h2 class="section">贯穿所有锁的四条原理</h2>
    <div class="principles">
      <div class="principle"><h3>1 · 公差就是漏洞</h3><p>没有两个零件是完美对齐的。孔位偏差让弹子“一次只卡一颗”，拨盘缺口的宽度让附近几个数字也能开锁。每一个毫米级的误差都在帮你。</p></div>
      <div class="principle"><h3>2 · 一次只解决一个</h3><p>好锁要求所有零件<b>同时</b>正确；而公差让你可以<b>逐个</b>确认。把“同时猜对”变成“依次猜对”，搜索空间从相乘变成相加。</p></div>
      <div class="principle"><h3>3 · 让锁告诉你答案</h3><p>咔哒声、锁芯的微转、拨盘接触点的宽窄——锁一直在“泄露信息”。开锁的本领就是学会读懂这些微弱信号。</p></div>
      <div class="principle"><h3>4 · 人才是最弱的一环</h3><p>出厂默认密码、写在抽屉里的数字、用物理常数当密码……费曼打开过的很多柜子，靠的根本不是技术，而是对人的观察。</p></div>
    </div>

    <div class="ethics">
      <span class="dot warn" style="margin-top:9px"></span>
      <div><b>开锁运动的两条规矩：</b>只开属于你自己的锁；不开正在使用中的锁（例如唯一一把还锁着门的锁）。这里的一切都是模拟，用来理解机械原理、学会挑选更安全的锁，而不是去打开别人的东西。</div>
    </div>
  </div>`;
  el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}
