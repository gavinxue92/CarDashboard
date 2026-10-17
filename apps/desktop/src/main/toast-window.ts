/**
 * 操作提示条（O2 Toast，交互说明 7.2）。
 *
 * 为什么不画在主窗口的 HTML 里：内嵌的官方页面是原生 `WebContentsView`，
 * 永远绘制在我方 HTML 之上。主窗口里画的 Toast 会被它整块盖住，看不见。
 * 因此 Toast 必须是**独立的透明浮层窗口**，才能实现设计要求的
 * 「内容区右下角、停留 3 秒后淡出」。
 *
 * 浮层窗口设置为鼠标穿透（setIgnoreMouseEvents），不会干扰官方页面的点击。
 */
import { BrowserWindow } from 'electron';
import type { ToastPayload } from '@cd/shared';
import { log } from './logger';

const TOAST_WIDTH = 340;
const TOAST_HEIGHT = 64;
/** 与设计一致：停留 3 秒（交互说明 7.2） */
const TOAST_DURATION_MS = 3_000;
const MARGIN = 24;

let current: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;

export function showToast(host: BrowserWindow, payload: ToastPayload): void {
  if (host.isDestroyed()) return;
  closeToast();

  // 定位到主窗口内容区右下角
  const content = host.getContentBounds();
  const x = Math.round(content.x + content.width - TOAST_WIDTH - MARGIN);
  const y = Math.round(content.y + content.height - TOAST_HEIGHT - MARGIN);

  const win = new BrowserWindow({
    width: TOAST_WIDTH,
    height: TOAST_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  // Toast 不需要交互，鼠标穿透以免挡住官方页面
  win.setIgnoreMouseEvents(true);

  win.on('closed', () => {
    if (current === win) current = null;
  });

  void win.loadURL(toastDataUrl(payload));
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });

  current = win;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    closeToast();
  }, TOAST_DURATION_MS);

  log('debug', 'toast', `提示条：${payload.message}`);
}

export function closeToast(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  const win = current;
  current = null;
  if (win && !win.isDestroyed()) win.close();
}

function toastDataUrl(payload: ToastPayload): string {
  const success = payload.type === 'success';
  const accent = success ? '#16a34a' : '#d97706';
  const glyph = success ? '✓' : '!';
  const text = escapeHtml(payload.message);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 12px;
    padding: 0 16px;
    font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    background: #ffffff;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-left: 4px solid ${accent};
    border-radius: 12px;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
    animation: toast-in 180ms ease-out;
  }
  .glyph {
    flex: 0 0 auto;
    width: 24px; height: 24px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: ${accent}; color: #fff;
    font-size: 14px; font-weight: 700; line-height: 1;
  }
  .text {
    flex: 1 1 auto;
    font-size: 13px; color: #0f172a; line-height: 1.4;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body>
  <span class="glyph">${glyph}</span>
  <span class="text">${text}</span>
</body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
