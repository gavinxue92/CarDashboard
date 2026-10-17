/**
 * preload —— 我方 UI 与主进程之间唯一的桥（技术方案 4.3）。
 *
 * 纪律：
 *   - 只通过 `contextBridge` 暴露白名单 API，**不暴露 `require`、不暴露 `ipcRenderer` 本体**；
 *   - 渲染进程拿不到任何 Node 能力（`nodeIntegration: false` + `sandbox: true`）；
 *   - 通道名全部取自 `@cd/shared`。
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '@cd/shared';
import type {
  AppInfo,
  CdBridge,
  LogPayload,
  SaveSettingsResult,
  ToastPayload,
  TranslateStatusPayload,
  WATranslateSettings,
  WaStatusPayload,
  WaViewSyncPayload,
} from '@cd/shared';

const bridge: CdBridge = {
  wa: {
    activate: () => ipcRenderer.invoke(IPC.WA_ACTIVATE) as Promise<void>,
    reload: () => ipcRenderer.invoke(IPC.WA_RELOAD) as Promise<void>,
    unbind: () => ipcRenderer.invoke(IPC.WA_UNBIND) as Promise<void>,

    onStatus: (cb: (payload: WaStatusPayload) => void) => {
      const handler = (_event: IpcRendererEvent, payload: WaStatusPayload): void => cb(payload);
      ipcRenderer.on(IPC.WA_STATUS, handler);
      return () => {
        ipcRenderer.off(IPC.WA_STATUS, handler);
      };
    },

    syncView: (payload: WaViewSyncPayload) => {
      ipcRenderer.send(IPC.WA_VIEW_SYNC, payload);
    },
  },

  memo: {
    get: () => ipcRenderer.invoke(IPC.MEMO_GET) as Promise<string>,
    set: (value: string) => ipcRenderer.invoke(IPC.MEMO_SET, value) as Promise<void>,
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<WATranslateSettings>,
    save: (cfg: WATranslateSettings) =>
      ipcRenderer.invoke(IPC.SETTINGS_SAVE, cfg) as Promise<SaveSettingsResult>,
    reset: () => ipcRenderer.invoke(IPC.SETTINGS_RESET) as Promise<void>,
  },

  translate: {
    onStatus: (cb: (payload: TranslateStatusPayload) => void) => {
      const handler = (_event: IpcRendererEvent, payload: TranslateStatusPayload): void =>
        cb(payload);
      ipcRenderer.on(IPC.TRANSLATE_STATUS, handler);
      return () => {
        ipcRenderer.off(IPC.TRANSLATE_STATUS, handler);
      };
    },
  },

  toast: (payload: ToastPayload) => {
    ipcRenderer.send(IPC.TOAST_SHOW, payload);
  },

  appInfo: () => ipcRenderer.invoke(IPC.APP_INFO) as Promise<AppInfo>,

  log: (payload: LogPayload) => {
    ipcRenderer.send(IPC.LOG_WRITE, payload);
  },
};

contextBridge.exposeInMainWorld('cd', bridge);
