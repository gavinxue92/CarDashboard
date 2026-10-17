/**
 * 端到端用例的启动台（T3）。
 *
 * 只做三件事，其余交给用例自己断言：
 *   ① **把客户端拉起来**，并保证不碰使用者的真实数据；
 *   ② **把「看不见的失败」收成可断言的信号** —— 渲染层 console 报错、主进程 stderr 报错；
 *   ③ **把散落的状态读出来** —— 本地配置、主进程日志、Toast 窗口文本。
 *
 * ⚠️ 隔离手段只有一个：`CD_USER_DATA_DIR`。
 *   实测过 `APPDATA` 环境变量对 Electron **无效**（`app.getPath('appData')` 在 Windows 上
 *   取系统已知文件夹），用它会直接写进使用者的 `%APPDATA%\CarDashboard` ——
 *   那里存着 WhatsApp 登录态，被写坏就要重新扫码。绝不能再用。
 *
 * ⚠️ 单实例锁也挂在用户数据目录上。所以「隔离」不只是保护数据，
 *   也是让测试能在使用者开着客户端时照常运行的必要条件。
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 客户端产物目录（electron-vite 的输出入口在这里） */
export const APP_DIR = path.resolve('apps/desktop');

/** 主进程入口，用来在拉起前给出「你还没构建」的明确提示 */
const MAIN_ENTRY = path.join(APP_DIR, 'out', 'main', 'index.js');

/**
 * 单条用例的超时守护：拉起 + 首屏 + 落盘，全程给足时间。
 * 与 playwright.config.ts 的 timeout 保持同一量级。
 */
const LAUNCH_TIMEOUT_MS = 30_000;

/**
 * 兼容模式。
 *
 * 默认开启：`CD_COMPAT_MODE=1` 让客户端追加 `--no-sandbox` 并走软件光栅化。
 * 原因见 `src/main/graphics.ts` 的实测记录 —— 从代理/IDE 的执行上下文里拉起 Electron，
 * Chromium 渲染进程会以 `0xC0000003 STATUS_BREAKPOINT` 崩溃，这是沙箱初始化断言失败，
 * 与工程本身无关。自动化环境（含本机 CI 上下文）需要这个逃生舱才能跑起来。
 *
 * 想验证**标准沙箱路径**时，`CD_E2E_COMPAT_MODE=0 pnpm test:e2e` 即可。
 * 注意 `--no-sandbox` 关的是 OS 级进程沙箱，`webPreferences.sandbox` 仍在生效，
 * 因此兼容模式下 preload 的沙箱约束（不 require 相对路径）依旧被测到。
 */
const compatMode = process.env.CD_E2E_COMPAT_MODE !== '0';

/** 可忽略的渲染层报错：外部资源加载失败的噪音，与我们的逻辑无关 */
const IGNORABLE_CONSOLE_ERRORS: readonly RegExp[] = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_(NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|INTERNET_DISCONNECTED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|CERT_|SSL_)/i,
  /favicon/i,
];

export interface LaunchedApp {
  app: ElectronApplication;
  /** 主窗口页面（我方 UI） */
  page: Page;
  /** 本次实例的用户数据目录（已隔离） */
  userDataDir: string;
  /** 渲染层 console 的 error 级别消息（已剔除外部资源噪音） */
  rendererErrors: string[];
  /** 渲染层未捕获异常 */
  uncaughtErrors: string[];
  /** 主进程日志里 `[ERROR]` 级别的行 */
  mainErrors: string[];
  close(): Promise<void>;
}

/** 造一个本次用例专属的用户数据目录 */
export function makeUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cd-e2e-'));
}

/**
 * 待清理的用户数据目录。
 *
 * 为什么不在用例里删：实测「删除一个临时目录」在本机要 **约 30 秒**，
 * 且与 Electron 无关 —— 一个空手造的 110 文件临时树（49 个目录）同样要 33 秒。
 * 属于杀软 / 文件系统过滤驱动的一次性开销，删不掉、也调不动。
 *
 * 后果很实在：串在 `afterEach` 里，9 条用例实测 6.8 分钟（真实业务只占约 2 分钟）；
 * 即便改成「异步发起」，后台那几个 30 秒的删除任务仍会把磁盘打满，
 * 反过来让每条用例的耗时在 10~49 秒之间乱跳。
 *
 * 所以：**测试进程里一次都不删**，只登记；收尾时交给一个脱离进程的子进程去慢慢删，
 * 测试进程立刻退出。留下的是系统临时目录里的 `cd-e2e-*`，由操作系统按自己的节奏回收。
 */
const pendingCleanups: string[] = [];

/**
 * 登记一个待清理的用户数据目录（**不执行删除**）。
 *
 * ⚠️ 只接受我们自己 `mkdtempSync` 出来的 `cd-e2e-*` 目录；
 *    目录名不匹配直接跳过，避免任何形式的误删。
 */
export function removeUserDataDir(dir: string): void {
  if (!/cd-e2e-/.test(path.basename(dir))) return;
  pendingCleanups.push(dir);
}

/**
 * 收尾：把登记过的目录交给一个**脱离的**子进程删除，随即返回。
 *
 * 用 `detached + unref` 是为了让测试进程不被这 30 秒挂住；
 * 子进程只做 `fs.rmSync`，失败一概忽略（删不掉不影响任何结论）。
 */
export function flushUserDataCleanups(): void {
  const targets = pendingCleanups.splice(0, pendingCleanups.length);
  if (targets.length === 0) return;
  const script =
    "const fs=require('node:fs');for(const d of process.argv.slice(1)){try{fs.rmSync(d,{recursive:true,force:true})}catch{}}";
  try {
    const child = spawn(process.execPath, ['-e', script, ...targets], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // 起不来就算了，留着由系统回收
  }
}

/**
 * 拉起客户端并等到主界面渲染出来。
 *
 * 实测耗时（本机）：启动到主界面约 2 秒，`close()` 约 10 秒 ——
 * 所以每条用例的固定开销在 12 秒左右，用例本身的断言通常只占几百毫秒。
 * 单条用例不要重复启动客户端，能用一次拉起覆盖的断言就并到一条用例里。
 *
 * `userDataDir` 用于「重启后设置是否还在」这类用例：同一个目录再拉一次。
 */
export async function launchApp(opts: { userDataDir?: string } = {}): Promise<LaunchedApp> {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error(
      `找不到客户端产物：${MAIN_ENTRY}\n端到端用例跑的是构建结果，请先执行：pnpm build`,
    );
  }

  const userDataDir = opts.userDataDir ?? makeUserDataDir();

  // 只保留有值的项：Playwright 的 env 参数要的是 `Record<string, string>`，
  // 而 `process.env` 的值可能是 undefined（TS 也因此不接受直接赋值）
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.CD_USER_DATA_DIR = userDataDir;
  // 执行上下文可能注入这个变量，会让 Electron 退化成纯 Node（app 是 undefined）
  delete env.ELECTRON_RUN_AS_NODE;
  if (compatMode) env.CD_COMPAT_MODE = '1';

  const app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env, timeout: LAUNCH_TIMEOUT_MS });

  const rendererErrors: string[] = [];
  const uncaughtErrors: string[] = [];
  const mainErrors: string[] = [];

  // 主进程的 [ERROR] 行：logger.ts 对 error 级别同时写文件与 stderr。
  // 只收 stdout/stderr 里的 ERROR 行即可，不依赖日志文件已经 flush 完。
  const collectMainStderr = (chunk: Buffer | string): void => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.includes('[ERROR]')) mainErrors.push(line);
    }
  };
  app.process().stderr?.on('data', collectMainStderr);
  app.process().stdout?.on('data', collectMainStderr);

  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORABLE_CONSOLE_ERRORS.some((re) => re.test(text))) return;
    rendererErrors.push(text);
  });
  page.on('pageerror', (err) => {
    // Vue 的警告/异常也会走到这里；「An object could not be cloned」就是这一路
    uncaughtErrors.push(String(err));
  });

  await page.waitForSelector('.app-sidebar', { timeout: LAUNCH_TIMEOUT_MS });

  return {
    app,
    page,
    userDataDir,
    rendererErrors,
    uncaughtErrors,
    mainErrors,
    async close(): Promise<void> {
      try {
        await app.close();
      } catch {
        // 已经关掉了
      }
    },
  };
}

// ── 读取派生的状态 ─────────────────────────────────────────────────────

/** 本地配置文件的路径（store.ts 的落盘位置） */
export function configPath(userDataDir: string): string {
  return path.join(userDataDir, 'config.json');
}

/** 读本地配置，文件不存在或不是合法 JSON 时返回 null */
export function readConfig(userDataDir: string): Record<string, unknown> | null {
  const file = configPath(userDataDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 等到本地配置满足条件。
 *
 * 为什么不直接 sleep：落盘走的是 `scheduleFlush` 的 200ms 防抖，
 * 固定等待既慢又不稳；轮询能让「写失败了」这件事**快速失败**而不是靠运气。
 */
export async function waitForConfig(
  userDataDir: string,
  predicate: (cfg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> | null = null;
  while (Date.now() < deadline) {
    last = readConfig(userDataDir);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `本地配置未在 ${timeoutMs}ms 内满足条件。最后读到：${JSON.stringify(last)}`,
  );
}

/** 把本次实例写下的主进程日志整段读出来（跨天文件也一并拼上） */
export function readMainLog(userDataDir: string): string {
  const dir = path.join(userDataDir, 'logs');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * 读 Toast 窗口当前显示的文本。
 *
 * Toast 是**独立的 data: URL 窗口**（不是主窗口里的一层 DOM），
 * 所以必须在 `app.windows()` 里按 URL 找，主窗口里查 DOM 是查不到的。
 * 找不到返回 null（当前没有 Toast）。
 */
export async function readToastText(app: ElectronApplication): Promise<string | null> {
  for (const win of app.windows()) {
    if (!win.url().startsWith('data:text/html')) continue;
    try {
      return await win.evaluate(() => document.querySelector('.text')?.textContent ?? '');
    } catch {
      // 窗口正在销毁
    }
  }
  return null;
}

/** 等到 Toast 出现且文本命中（否则返回 null 由用例断言失败） */
export async function waitForToastText(
  app: ElectronApplication,
  match: RegExp | string,
  timeoutMs = 5_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readToastText(app);
    if (text !== null && (typeof match === 'string' ? text.includes(match) : match.test(text))) {
      return text;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

// ── 渲染层状态读取（走真实 IPC，不读 DOM） ────────────────────────────

/** 通过真实 IPC 读翻译设置（`window.cd.settings.get()`） */
export async function readTranslateSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const bridge = (window as unknown as { cd: { settings: { get(): Promise<unknown> } } }).cd;
    return (await bridge.settings.get()) as Record<string, unknown>;
  });
}

/** 通过真实 IPC 读运行环境信息 */
export async function readAppInfo(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const bridge = (window as unknown as { cd: { appInfo(): Promise<unknown> } }).cd;
    return (await bridge.appInfo()) as Record<string, unknown>;
  });
}
