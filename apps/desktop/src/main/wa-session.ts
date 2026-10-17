/**
 * WhatsApp 会话分区（技术方案 3.2）。
 *
 * 分区名由 partition.ts 统一提供；这里只负责三件事：
 *   1) 覆写 User-Agent 为常规 Chrome（避免被官方判定为不受支持的客户端）
 *   2) 该分区单独设代理出口（办公网络不可达时唯一救法，只影响本分区）
 *   3) 解绑时清空该分区（FR-3.17 / 3.18）
 *
 * ⚠️ 我方**不读取**该分区内的任何登录凭证内容，也不解析页面 DOM。
 */
import { session, type Session } from 'electron';
import { getWaPartitionName } from './partition';
import { log } from './logger';

/** 官方页面入口 */
export const WA_URL = 'https://web.whatsapp.com';

let activeProxy = '';

/**
 * 构造一个不含 Electron 标识的常规 Chrome UA。
 * 直接复刻 Electron 默认 UA 会带 `Electron/44.7.0` 字样，官方据此可能拒绝服务。
 */
function chromeUserAgent(): string {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return (
    `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${process.versions.chrome} Safari/537.36`
  );
}

export function getWaSession(): Session {
  return session.fromPartition(getWaPartitionName());
}

export function getActiveProxy(): string {
  return activeProxy;
}

export async function configureWaSession(proxy: string): Promise<void> {
  const s = getWaSession();
  s.setUserAgent(chromeUserAgent());

  if (proxy) {
    try {
      await s.setProxy({ proxyRules: proxy });
      activeProxy = proxy;
      log('info', 'wa-session', `该分区已启用代理出口：${proxy}`);
    } catch (err) {
      activeProxy = '';
      log('error', 'wa-session', `代理设置失败，按直连继续：${String(err)}`);
    }
  } else {
    activeProxy = '';
    log('info', 'wa-session', '该分区走直连（未配置 VITE_WA_PROXY）');
  }

  log('info', 'wa-session', `分区 ${getWaPartitionName()} 就绪，UA 已覆写为 Chrome/${process.versions.chrome}`);
}

/**
 * 权限放行。
 *
 * 目标是「官方页面全功能原样可用」：WhatsApp Web 的语音消息要麦克风、
 * 拍照要摄像头、新消息要通知，剪贴板要读写。默认全部拒绝会让这些功能静默失效。
 * 白名单之外一律拒绝。
 */
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
]);

export function installWaPermissionHandler(): void {
  const s = getWaSession();

  s.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission);
    log('debug', 'wa-session', `权限请求：${permission} → ${allowed ? '允许' : '拒绝'}`);
    callback(allowed);
  });

  s.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

/**
 * 解除绑定：清空该分区全部站点数据与缓存。
 * 清完必须重新加载页面，官方页面才会回到「关联设备」二维码（FR-3.18）。
 */
export async function clearWaSession(): Promise<void> {
  const s = getWaSession();
  await s.clearStorageData();
  await s.clearCache();
  log('info', 'wa-session', '该分区数据已清空（解除绑定）');
}
