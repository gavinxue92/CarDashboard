/**
 * 测试环境用的 `electron` 模块替身。
 *
 * 为什么需要它：主进程里几处模块（logger / store / key-store / translate）在
 * 导入期就会碰 `electron.app`、`electron.session`。测试跑在纯 Node 里，
 * 没有 Electron 运行时，因此由 vitest 的 alias 把 `electron` 指到本文件
 * （见 `vitest.config.ts`）。
 *
 * 两条纪律：
 *   1) 替身必须**如实反映**我们要测的那部分契约，不能为了让测试通过而放宽行为；
 *   2) 钩子挂在 `globalThis` 上，而不是模块作用域 —— 测试常常要 `vi.resetModules()`
 *      重新导入被测模块，模块实例会被换掉，挂在 `globalThis` 上的状态才活得下来。
 *
 * 明确不提供的能力（要用就得先想清楚）：真实窗口、真实网络、真实 IPC。
 * 会话的 `fetch` 由测试注入（`setSessionFetch`），这样「一次翻译请求」的全链路
 * （选渠道 → 拼 URL → 发请求 → 解析响应 → 缓存）可以在无网络下被完整测到。
 */
import os from 'node:os';
import path from 'node:path';

export type SessionFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface TestHooks {
  /** `app.getPath('userData')` 返回的目录 */
  userData: string;
  /** 会话网络出口；未设置时任何请求都会失败（避免测试意外打到真实网络） */
  sessionFetch: SessionFetch | null;
}

const HOOK_KEY = '__CD_TEST_HOOKS__';

function hooks(): TestHooks {
  const g = globalThis as unknown as Record<string, TestHooks | undefined>;
  let h = g[HOOK_KEY];
  if (!h) {
    h = { userData: path.join(os.tmpdir(), 'cd-test-userdata'), sessionFetch: null };
    g[HOOK_KEY] = h;
  }
  return h;
}

/** 指定测试用的用户数据目录（对应 `<userData>`） */
export function setTestUserData(dir: string): void {
  hooks().userData = dir;
}

export function getTestUserData(): string {
  return hooks().userData;
}

/** 注入会话网络出口。传 null 表示「任何请求都失败」 */
export function setSessionFetch(fn: SessionFetch | null): void {
  hooks().sessionFetch = fn;
}

/** 每个用例前重置，避免用例之间互相污染 */
export function resetElectronStub(): void {
  hooks().userData = path.join(os.tmpdir(), 'cd-test-userdata');
  hooks().sessionFetch = null;
}

// ── app ──────────────────────────────────────────────────────────────

const noop = (): void => undefined;

export const app = {
  getPath(name: string): string {
    const userData = hooks().userData;
    if (name === 'userData') return userData;
    if (name === 'appData') return path.dirname(userData);
    if (name === 'temp') return os.tmpdir();
    if (name === 'home') return os.homedir();
    if (name === 'logs') return path.join(userData, 'logs');
    return userData;
  },
  getVersion: (): string => '0.1.1-test',
  getName: (): string => 'CarDashboard',
  setName: noop,
  getAppPath: (): string => process.cwd(),
  isPackaged: false,
  whenReady: (): Promise<void> => Promise.resolve(),
  on: (): unknown => app,
  once: (): unknown => app,
  quit: noop,
  exit: noop,
  disableHardwareAcceleration: noop,
  requestSingleInstanceLock: (): boolean => true,
  commandLine: { appendSwitch: noop },
};

// ── session ──────────────────────────────────────────────────────────

function makeSession(): Record<string, unknown> {
  return {
    setUserAgent: noop,
    setProxy: async (): Promise<void> => undefined,
    setPermissionRequestHandler: noop,
    setPermissionCheckHandler: noop,
    clearStorageData: async (): Promise<void> => undefined,
    clearCache: async (): Promise<void> => undefined,
    /**
     * 会话网络出口。
     * 未注入时抛错而不是静默返回空响应：测试里「意外发起真实请求」应该炸出来，
     * 而不是变成一个难以解释的空结果。
     */
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const fn = hooks().sessionFetch;
      if (!fn) throw new Error(`测试环境未注入 session.fetch，却试图请求：${url}`);
      return fn(url, init);
    },
  };
}

const sharedSession = makeSession();

export const session = {
  defaultSession: sharedSession,
  fromPartition: (_partition: string): unknown => sharedSession,
};

// ── 其余导出：明确不支持，用到就报错 ─────────────────────────────────

export class BrowserWindow {
  constructor() {
    throw new Error('测试环境不创建真实窗口；需要断言窗口行为请 mock 掉对应模块');
  }
  static getAllWindows(): unknown[] {
    return [];
  }
}

export const ipcMain = {
  handle: noop,
  on: noop,
  removeHandler: noop,
};

export const ipcRenderer = {
  invoke: async (): Promise<never> => {
    throw new Error('测试环境不提供真实 IPC；请通过注入 port 抽象来测试');
  },
  send: noop,
  on: noop,
  off: noop,
};

export const contextBridge = {
  exposeInMainWorld: noop,
};

/** 供被测模块使用的默认导出兜底（有些打包路径会取 default） */
export default { app, session, BrowserWindow, ipcMain, ipcRenderer, contextBridge };
