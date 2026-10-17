/**
 * IPC 注册（技术方案 4.6 / 4.7）。
 *
 * 两条纪律：
 *   1) 通道名与类型全部取自 `@cd/shared`，不在两侧各写一份字符串；
 *   2) **每个入口都校验参数**——渲染进程虽然是我方代码，但它是被第三方页面
 *      影响得最多的一层，不能假设传进来的东西一定合法。
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import {
  IPC,
  INJECT_IPC,
  type AppInfo,
  type LogLevel,
  type LogPayload,
  type SaveSettingsResult,
  type ToastPayload,
  type TranslateRequest,
  type TranslateResult,
  type WaViewSyncPayload,
} from '@cd/shared';
import {
  getMemo,
  getTranslateSettings,
  resetTranslateSettings,
  saveTranslateSettings,
  setMemo,
} from './store';
import { getLogDir, log } from './logger';
import { getWaPartitionId } from './partition';
import { getActiveProxy } from './wa-session';
import { showToast } from './toast-window';
import {
  clearTranslateCache,
  notifyTranslateConfigChanged,
  translateRequest,
} from './translate';
import type { WaEmbedView } from './embed-view';

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  getEmbed: () => WaEmbedView | null;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export function registerIpc(deps: IpcDeps): void {
  /**
   * 设置变更后把新的运行时配置推给注入脚本（FR-3.29：改动即时生效，无需重启）。
   * 顺带广播一次状态给渲染层，让界面上的「翻译未启用 / 不可用」提示保持同步。
   */
  function pushTranslateConfig(): void {
    notifyTranslateConfigChanged();
    deps.getEmbed()?.pushTranslateConfig();
  }

  // ── WhatsApp 模块 ────────────────────────────────────────────

  ipcMain.handle(IPC.WA_ACTIVATE, () => {
    deps.getEmbed()?.activate();
  });

  ipcMain.handle(IPC.WA_RELOAD, () => {
    deps.getEmbed()?.reload();
  });

  ipcMain.handle(IPC.WA_UNBIND, async (): Promise<void> => {
    // 换号后旧译文没有复用价值，一并清掉去重缓存（FR-3.27）
    clearTranslateCache();
    await deps.getEmbed()?.unbind();
  });

  // 内嵌区布局同步：高频、无返回值，用 send/on
  ipcMain.on(IPC.WA_VIEW_SYNC, (_event, payload: unknown) => {
    const embed = deps.getEmbed();
    if (!embed) return;
    if (!isValidViewSync(payload)) {
      log('warn', 'ipc', 'wa:view-sync 载荷非法，已忽略');
      return;
    }
    embed.setOccluded(payload.occluded);
    embed.setBounds(payload.bounds);
  });

  // ── 账号备注（FR-3.7） ────────────────────────────────────────

  ipcMain.handle(IPC.MEMO_GET, (): string => getMemo());

  ipcMain.handle(IPC.MEMO_SET, (_event, value: unknown): void => {
    if (typeof value !== 'string') {
      log('warn', 'ipc', 'memo:set 载荷非法，已忽略');
      return;
    }
    setMemo(value.trim());
  });

  // ── 翻译设置（FR-3.20 / 3.21；V1.4 起保存即时生效，FR-3.29） ────────

  ipcMain.handle(IPC.SETTINGS_GET, () => getTranslateSettings());

  ipcMain.handle(IPC.SETTINGS_SAVE, (_event, cfg: unknown): SaveSettingsResult => {
    if (!cfg || typeof cfg !== 'object') {
      log('warn', 'ipc', 'settings:save 载荷非法，已忽略');
      return { ok: false, localOnly: true };
    }
    saveTranslateSettings(cfg);
    pushTranslateConfig();
    return { ok: true, localOnly: true };
  });

  ipcMain.handle(IPC.SETTINGS_RESET, (): void => {
    resetTranslateSettings();
    pushTranslateConfig();
  });

  // ── 双向注入式翻译（V1.4，需求 5.3.7） ──────────────────────────
  //
  // 这一组通道的两端是**注入脚本 ↔ 主进程**，不经过渲染层。
  // ⚠️ 注入脚本所在页面是第三方远程内容，因此每个入口都要先确认
  //    「请求确实来自我们的内嵌视图」，不认「谁发来的都接」。

  ipcMain.handle(INJECT_IPC.REQUEST, async (event, payload: unknown): Promise<TranslateResult> => {
    const embed = deps.getEmbed();
    if (!embed || !embed.ownsWebContents(event.sender.id)) {
      log('warn', 'ipc', 'translate:request 来自非内嵌视图，已拒绝');
      return { seq: -1, ok: false, text: '', error: 'unknown' };
    }
    if (!isValidTranslateRequest(payload)) {
      log('warn', 'ipc', 'translate:request 载荷非法，已拒绝');
      return { seq: -1, ok: false, text: '', error: 'unknown' };
    }
    return translateRequest(payload);
  });

  ipcMain.on(INJECT_IPC.LOG, (event, payload: unknown) => {
    const embed = deps.getEmbed();
    if (!embed || !embed.ownsWebContents(event.sender.id)) return;
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Partial<LogPayload>;
    if (typeof p.message !== 'string') return;
    const level: LogLevel = LOG_LEVELS.includes(p.level as LogLevel) ? (p.level as LogLevel) : 'info';
    log(level, 'wa-inject', p.message.slice(0, 500));
  });

  // ── 通用 ────────────────────────────────────────────────────

  ipcMain.on(IPC.TOAST_SHOW, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Partial<ToastPayload>;
    if (typeof p.message !== 'string' || !p.message.trim()) return;
    const host = deps.getWindow();
    if (!host) return;
    showToast(host, {
      message: p.message.slice(0, 200),
      type: p.type === 'warning' ? 'warning' : 'success',
    });
  });

  ipcMain.handle(IPC.APP_INFO, (): AppInfo => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userDataPath: app.getPath('userData'),
    logPath: getLogDir(),
    waPartitionId: getWaPartitionId(),
    waProxy: getActiveProxy(),
  }));

  ipcMain.on(IPC.LOG_WRITE, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Partial<LogPayload>;
    if (typeof p.message !== 'string') return;
    const level: LogLevel = LOG_LEVELS.includes(p.level as LogLevel) ? (p.level as LogLevel) : 'info';
    const scope = typeof p.scope === 'string' ? p.scope.slice(0, 40) : 'app';
    log(level, `renderer:${scope}`, p.message.slice(0, 500));
  });
}

function isValidViewSync(payload: unknown): payload is WaViewSyncPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<WaViewSyncPayload>;
  if (typeof p.occluded !== 'boolean') return false;
  const b = p.bounds;
  if (!b || typeof b !== 'object') return false;
  return (
    Number.isFinite(b.x) &&
    Number.isFinite(b.y) &&
    Number.isFinite(b.width) &&
    Number.isFinite(b.height)
  );
}

/** 长度上限：与 shared 的 TRANSLATE_MAX_CHARS 同量级，超出的在调度器里会被判 too-long */
const MAX_TRANSLATE_PAYLOAD_CHARS = 20_000;

function isValidTranslateRequest(payload: unknown): payload is TranslateRequest {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<TranslateRequest>;
  if (typeof p.seq !== 'number' || !Number.isFinite(p.seq)) return false;
  if (typeof p.text !== 'string' || p.text.length > MAX_TRANSLATE_PAYLOAD_CHARS) return false;
  return p.direction === 'in' || p.direction === 'out';
}
