'use strict';
/* =========================================================================
 * S0 · 外圈渲染逻辑（我们的 DOM，无任何注入——注入属 S1+ 的圈一）
 *
 * 关键行为：
 *   1. 启动取账号列表（main 进程），默认选当前账号
 *   2. 按账号创建 <webview>：partition = persist:wa-<id>（登录态随 partition 落盘）
 *   3. 切号 = 重建 webview 元素（partition 是创建期属性，改属性无效）
 *   4. 网页版加载状态显性展示（失败不静默——SHELL-ROUTE §5.1 纪律的 S0 版）
 * ========================================================================= */

const WA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

let boot = null;

function el(id) { return document.getElementById(id); }

function setHostState(text, cls) {
  const s = el('hostState');
  s.textContent = text;
  s.className = 'host-state' + (cls ? ' ' + cls : '');
}

function shortName(account) {
  return (account.label || account.id).trim().charAt(0).toUpperCase() || '?';
}

function renderRail() {
  const box = el('acctList');
  box.innerHTML = '';
  boot.accounts.forEach(a => {
    const d = document.createElement('div');
    d.className = 'acct' + (a.id === boot.current ? ' on' : '');
    d.textContent = shortName(a);
    d.title = a.label + '（' + boot.partitions[a.id] + '）';
    d.addEventListener('click', () => switchAccount(a.id));
    box.appendChild(d);
  });
}

function createWebview(accountId) {
  const body = el('hostBody');
  body.innerHTML = '';
  const wv = document.createElement('webview');
  wv.setAttribute('src', boot.waUrl);
  wv.setAttribute('partition', boot.partitions[accountId]);
  wv.setAttribute('useragent', WA_UA);
  wv.addEventListener('dom-ready', () => setHostState('已加载（未登录时显示官方扫码页）', 'ok'));
  wv.addEventListener('did-fail-load', e => {
    if (e.isMainFrame) setHostState('加载失败：' + e.errorDescription, 'err');
  });
  body.appendChild(wv);

  el('hostPart').textContent = 'partition: ' + boot.partitions[accountId];
  el('sideFoot').textContent = '当前账号：' +
    (boot.accounts.find(a => a.id === accountId) || {}).label + ' · ' + boot.partitions[accountId];
  setHostState('加载中…', '');
}

async function switchAccount(id) {
  if (id === boot.current) return;
  const res = await window.shell.switchAccount(id);
  boot.current = res.current;
  boot.partitions[res.current] = res.partition;
  renderRail();
  createWebview(res.current);
}

function bindSidePanel() {
  const side = el('side');
  el('toolCust').addEventListener('click', () => {
    side.classList.toggle('collapsed');
    el('toolCust').classList.toggle('on', !side.classList.contains('collapsed'));
  });
  document.querySelectorAll('.side-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.side-tab').forEach(x => x.classList.toggle('on', x === t));
      document.querySelectorAll('.pane').forEach(p =>
        p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
    });
  });
  document.querySelectorAll('.tool.dim').forEach(t => {
    t.addEventListener('click', () => {
      const foot = el('sideFoot');
      foot.textContent = t.dataset.reserved;
    });
  });
}

(async function init() {
  boot = await window.shell.bootstrap();
  renderRail();
  bindSidePanel();
  createWebview(boot.current);
})();
