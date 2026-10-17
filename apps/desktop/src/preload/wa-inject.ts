/**
 * WhatsApp Web 注入脚本 —— **接线层**（需求 5.3.7 / FR-3.22 ~ FR-3.30）。
 *
 * 运行位置：`WebContentsView.webPreferences.preload`，**隔离世界**
 * （`contextIsolation: true` + `sandbox: true`）。
 *   - 与官方页面共享 DOM，因此能读消息、插译文节点、改输入框；
 *   - JS 作用域互相不可见，所以官方页面拿不到我们的任何变量与 IPC；
 *   - 只用 `require('electron').ipcRenderer`，**不引入任何 Node 内置模块**
 *     （沙箱下本来也拿不到，且打包后 `require` 只认 electron 等少数内置模块）。
 *
 * 本文件只做两件事：把主进程的 IPC 接成 `InjectorPort`，把配置转发给注入器。
 * 全部 DOM 逻辑在 `wa-dom.ts`，与 Electron 解耦，因而能在 jsdom 下被测试
 * （真实页面结构无法在开发机上复现，那是唯一必须真机核对的环节）。
 *
 * ⚠️ 构建约束（改动前先读 `packages/shared/src/translate.ts` 里 INJECT_IPC 的说明）：
 * 本文件的**运行时依赖图必须与 `preload/index.ts` 不相交**，否则打包器会抽出公共
 * chunk，而沙箱 preload 的 `require` 加载不到相对路径文件 —— 失败只在用户机器上出现。
 * `scripts/check-preload.mjs` 会在构建期把这件事断言掉。
 */
import { INJECT_IPC, type TranslateRuntimeConfig } from '@cd/shared';
import { createInjector, type InjectorPort } from './wa-dom';

// electron-vite 把 preload 打成 CJS，'electron' 保持外部依赖
const { ipcRenderer } = require('electron') as typeof import('electron');

const port: InjectorPort = {
  translate: (req) => ipcRenderer.invoke(INJECT_IPC.REQUEST, req),
  log: (level, message) => {
    ipcRenderer.send(INJECT_IPC.LOG, { level, message });
  },
};

const injector = createInjector(port);

// 配置由主进程下发：页面加载完成后一次、使用者保存设置后再一次（FR-3.29 即时生效）
ipcRenderer.on(INJECT_IPC.CONFIG, (_event, payload: unknown) => {
  if (!payload || typeof payload !== 'object') return;
  injector.applyConfig(payload as TranslateRuntimeConfig);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => injector.start(), { once: true });
} else {
  injector.start();
}
