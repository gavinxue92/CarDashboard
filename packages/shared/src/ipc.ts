/**
 * IPC 通道名 —— 主进程与渲染进程的单一来源（技术方案 4.7）。
 *
 * 改通道名只改这里；两侧引用的都是常量，不会出现「一边改了一边没改」的错位。
 *
 * 契约对应关系（技术方案 4.6）：
 *   wa.reload()                  → IPC.WA_RELOAD
 *   wa.onStatus(cb)              → IPC.WA_STATUS（主 → 渲染 推送）
 *   wa.unbind()                  → IPC.WA_UNBIND
 *   memo.get() / memo.set(v)     → IPC.MEMO_GET / IPC.MEMO_SET
 *   settings.get()/save()/reset() → IPC.SETTINGS_GET / SAVE / RESET
 */
export const IPC = {
  /** 首次进入 WhatsApp 模块：创建内嵌视图并开始加载（技术方案 3.2 步骤 1） */
  WA_ACTIVATE: 'wa:activate',
  /** 重新加载内嵌官方页面（FR-3.13 的手动触发入口） */
  WA_RELOAD: 'wa:reload',
  /** 解除绑定：清空该分区登录态后重新加载（FR-3.17 / 3.18） */
  WA_UNBIND: 'wa:unbind',
  /** 运行状态推送：主 → 渲染 */
  WA_STATUS: 'wa:status',
  /** 内嵌区布局同步：渲染 → 主（bounds + 是否被遮挡） */
  WA_VIEW_SYNC: 'wa:view-sync',

  /** 账号备注读取 / 写入（FR-3.7） */
  MEMO_GET: 'memo:get',
  MEMO_SET: 'memo:set',

  /** 翻译设置：读取 / 保存 / 恢复默认（FR-3.20 / 3.21，接口预留壳） */
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_RESET: 'settings:reset',

  /** 操作提示条（O2 Toast）：渲染 → 主 → 浮层窗口 */
  TOAST_SHOW: 'toast:show',
  /** 应用与运行环境信息（排障用，展示在设置/关于处） */
  APP_INFO: 'app:info',
  /** 渲染层日志上报（写入本地日志文件，替代第三方监控） */
  LOG_WRITE: 'log:write',

  // ── 双向注入式翻译（V1.4，5.3.7）────────────────────────────────
  //
  // ⚠️ 这里**只有**主 → 渲染层的状态推送。
  // 注入脚本用的 REQUEST / CONFIG / LOG 三个通道刻意放在 `translate.ts` 的
  // `INJECT_IPC` 里 —— 原因是构建约束（两个 preload 不能共享运行时模块，
  // 否则沙箱 preload 会 require 不到公共 chunk）。详见 `translate.ts` 的说明。
  /** 翻译可用性推送（send，主 → 渲染层） */
  TRANSLATE_STATUS: 'translate:status',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Toast 类型（交互说明 7.2） */
export type ToastType = 'success' | 'warning';

export interface ToastPayload {
  message: string;
  type: ToastType;
}

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  /** 应用数据目录，卸载时会被一并清除（FR-1.7） */
  userDataPath: string;
  /** 日志文件所在目录 */
  logPath: string;
  /** WhatsApp 会话分区名（不含 persist: 前缀），排障时用于核对隔离维度 */
  waPartitionId: string;
  /** 当前生效的代理出口，空 = 直连 */
  waProxy: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogPayload {
  level: LogLevel;
  scope: string;
  message: string;
}
