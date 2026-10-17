/**
 * 主窗口（技术方案 4.1 / 4.2）。
 *
 * 标题栏策略：`titleBarStyle: 'hidden'` + `titleBarOverlay`。
 * 标题栏的内容由我方渲染（L1 工作台框架要求），但最小化/最大化/关闭三个按钮
 * 保留系统原生绘制——自绘这三个按钮要处理最大化状态、贴边、多显示器 DPI 等一堆细节，
 * 收益为零。`titleBarOverlay.height` 与前端 CSS 里的标题栏高度必须一致（TITLE_BAR_HEIGHT）。
 */
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { TITLE_BAR_HEIGHT } from '@cd/shared';
import { log } from './logger';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4f5f7',
    title: '海外获客沟通工作台',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#334155',
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全基线（技术方案 3.5）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // 我方界面里的外链一律交给系统浏览器，不在应用内新开窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });

  // 我方界面本身也不允许被导航走（dev server 与本地文件除外）
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    void openExternal(url);
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    log('info', 'window', `加载开发服务器：${devUrl}`);
    void win.loadURL(devUrl);
  } else {
    const file = join(__dirname, '../renderer/index.html');
    log('info', 'window', `加载本地页面：${file}`);
    void win.loadFile(file);
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    log('error', 'window', `主界面渲染进程退出：${details.reason}`);
  });

  return win;
}

async function openExternal(rawUrl: string): Promise<void> {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    await shell.openExternal(rawUrl);
  } catch {
    // 忽略非法 URL
  }
}
