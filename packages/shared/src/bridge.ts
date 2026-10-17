/**
 * 渲染进程可见的桥接接口（技术方案 4.3）。
 *
 * preload 通过 contextBridge 暴露 `window.cd`，其形状与本接口一致。
 * 放在 shared 是为了让渲染层拿到类型时**不依赖 electron**（渲染层不装 electron 类型）。
 */
import type { AppInfo, LogPayload, ToastPayload } from './ipc';
import type { WaStatusPayload, WaViewSyncPayload } from './wa-status';
import type { SaveSettingsResult, WATranslateSettings } from './translate-settings';
import type { TranslateStatusPayload } from './translate';

export interface CdBridge {
  /** WhatsApp 模块（FR-3.1~3.21） */
  readonly wa: {
    /** 首次进入模块：创建内嵌视图并开始加载；重复调用无副作用 */
    activate(): Promise<void>;
    /** 重新加载内嵌官方页面（FR-3.13 手动入口） */
    reload(): Promise<void>;
    /** 解除绑定：清除本机该分区登录态并回到加载态（FR-3.17 / 3.18） */
    unbind(): Promise<void>;
    /** 订阅运行状态；返回取消订阅函数 */
    onStatus(cb: (payload: WaStatusPayload) => void): () => void;
    /** 同步内嵌区矩形与遮挡状态（渲染 → 主） */
    syncView(payload: WaViewSyncPayload): void;
  };

  /** 账号备注（FR-3.7，人工填写，本机存储） */
  readonly memo: {
    get(): Promise<string>;
    set(value: string): Promise<void>;
  };

  /** 翻译设置（FR-3.20 / 3.21；V1.4 起保存即时生效，FR-3.29） */
  readonly settings: {
    get(): Promise<WATranslateSettings>;
    save(cfg: WATranslateSettings): Promise<SaveSettingsResult>;
    reset(): Promise<void>;
  };

  /** 翻译可用性（FR-3.32：连续失败时界面要能提示一次） */
  readonly translate: {
    /** 订阅翻译状态；返回取消订阅函数 */
    onStatus(cb: (payload: TranslateStatusPayload) => void): () => void;
  };

  /** 操作提示条（O2 Toast） */
  toast(payload: ToastPayload): void;

  /** 应用与运行环境信息（排障） */
  appInfo(): Promise<AppInfo>;

  /** 渲染层日志上报（写入本地日志文件） */
  log(payload: LogPayload): void;
}

declare global {
  interface Window {
    readonly cd: CdBridge;
  }
}
