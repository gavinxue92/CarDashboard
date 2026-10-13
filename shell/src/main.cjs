'use strict';
/* =========================================================================
 * S0 · Electron 主进程（design/SHELL-ROUTE.md §六 S0）
 *
 * 职责（只有这些，注入/翻译/拦截都是后续阶段）：
 *   1. 开一个 BrowserWindow（webviewTag: true —— <webview> 是硬约束，见 §三）
 *   2. 账号配置存取（userData/accounts.json；一号一 persist partition）
 *   3. IPC：渲染进程取账号列表 / 切号（切号 = 渲染进程重建 webview）
 *   4. --smoke：窗口加载完我们的 index.html 即退出 0（CI/自测用，不依赖外网）
 *
 * 安全边界（不抄拓译，见 SHELL-ROUTE §七）：
 *   contextIsolation + sandbox + nodeIntegration=false，不开 webSecurity 口子。
 * ========================================================================= */

const { app, BrowserWindow, ipcMain } = require('electron');
/* 注意：ELECTRON_RUN_AS_NODE 必须在「启动 Electron 之前」清掉（见 scripts/launch.cjs），
 * 进程起来后再删已无意义。 */
const path = require('node:path');
const fs = require('node:fs');
const { defaultAccounts, normalizeAccounts, partitionFor, resolveCurrent } = require('./accounts.cjs');
const { parseFlags } = require('./cli.cjs');

const flags = parseFlags(process.argv.slice(1));
if (flags.smoke) {
  /* smoke 只验证「壳能起来 + 本地页面加载」，不验证渲染性能；
   * 在受限环境（无 GPU 沙箱/远程会话）里 GPU 进程会崩，直接禁掉。
   * 部分机器驱动上 disable-gpu 后 GPU 进程仍会被拉起再崩，一并禁掉 GPU 沙箱。 */
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('no-sandbox');
  app.disableHardwareAcceleration();
}
const WA_URL = 'https://web.whatsapp.com';
/* 网页版对 UA 有区分；Electron 默认 UA 含 Electron 字样，声明为 Chrome 形态（拓译同款做法） */
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

let state = { accounts: defaultAccounts(), current: 'main' };

function accountsFile() {
  return path.join(app.getPath('userData'), 'accounts.json');
}

function loadAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(accountsFile(), 'utf8'));
    state.accounts = normalizeAccounts(raw.accounts);
    state.current = resolveCurrent(state.accounts, raw.current);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      /* 配置坏了要显性失败——但 S0 阶段先回落出厂账号并把原因打到 stderr，不弹窗打断 */
      console.error('[accounts] 配置读取失败，回落出厂账号：', err.message);
    }
    state.accounts = defaultAccounts();
    state.current = state.accounts[0].id;
  }
}

function saveAccounts() {
  fs.mkdirSync(path.dirname(accountsFile()), { recursive: true });
  fs.writeFileSync(accountsFile(), JSON.stringify(state, null, 2), 'utf8');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 680,
    title: '海外汽车服务工作台',
    backgroundColor: '#111b21',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true /* <webview> 承载官方网页版；WebContentsView 会压住我们的确认层，见 SHELL-ROUTE §三 */
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (flags.smoke) {
    /* smoke：我们的 index.html 加载完即退出。不等待网页版（不依赖外网） */
    win.webContents.on('did-finish-load', () => {
      console.log('[smoke] did-finish-load');
      setTimeout(() => {
        console.log('[smoke] renderer loaded, quitting');
        app.exit(0);
      }, 800);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error('[smoke] did-fail-load:', code, desc, url);
      if (String(url).startsWith('file://')) app.exit(1);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[smoke] render-process-gone:', details.reason);
      app.exit(1);
    });
    /* 兜底：20 秒还没加载完按失败退出（不悬挂） */
    setTimeout(() => {
      console.error('[smoke] 超时未完成加载');
      app.exit(2);
    }, 20000).unref();
  }
  return win;
}

app.whenReady().then(() => {
  app.userAgentFallback = CHROME_UA;
  loadAccounts();

  ipcMain.handle('shell:bootstrap', () => ({
    accounts: state.accounts,
    current: state.current,
    partitions: Object.fromEntries(state.accounts.map(a => [a.id, partitionFor(a.id)])),
    waUrl: WA_URL
  }));

  ipcMain.handle('shell:switch-account', (_e, id) => {
    state.current = resolveCurrent(state.accounts, id);
    saveAccounts();
    return { current: state.current, partition: partitionFor(state.current) };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
