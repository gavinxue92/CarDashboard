/**
 * 导航与窗口打开白名单（安全基线，技术方案 3.5）。
 *
 * 内嵌视图里跑的是第三方页面，必须假设它可能导航到任意地址。
 * 规则：
 *   - 主框架只允许停留在 web.whatsapp.com；
 *   - 其余 http/https 一律交给系统浏览器打开（不阻断用户，但不让第三方页面在应用窗口内漫游）；
 *   - 非 http/https 协议直接丢弃。
 */
import { shell, type WebContents } from 'electron';
import { log } from './logger';

/** 允许在内嵌视图主框架内停留的域名 */
const ALLOWED_HOSTS = new Set(['web.whatsapp.com']);

export function hardenWebContents(wc: WebContents, tag: string): void {
  // 页面里的 window.open / target=_blank：一律不在应用内开新窗口
  wc.setWindowOpenHandler(({ url }) => {
    void openExternal(url, tag);
    return { action: 'deny' };
  });

  // 主框架导航
  wc.on('will-navigate', (event, url) => {
    if (isAllowed(url)) return;
    event.preventDefault();
    void openExternal(url, tag);
  });

  // 不允许第三方页面再内嵌 webview
  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
    log('warn', tag, '已拦截页面内的 webview 挂载');
  });
}

function isAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

async function openExternal(rawUrl: string, tag: string): Promise<void> {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    log('info', tag, `跳转系统浏览器：${rawUrl}`);
    await shell.openExternal(rawUrl);
  } catch {
    // 非法 URL 直接忽略
  }
}
