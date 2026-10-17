/**
 * 主进程入口。
 *
 * 启动顺序（不能随意调换）：
 *   1. 初始化日志 → 2. 载入本地配置 → 3. 配置 WhatsApp 分区（UA / 代理 / 权限）
 *   → 4. 创建主窗口 → 5. 创建内嵌视图管理器 → 6. 注册 IPC
 *
 * 单实例说明：同一台机器同时开两个实例，会争抢同一个 `persist:` 会话分区，
 * 可能损坏 WhatsApp 登录态（两边同时写入站点数据）。因此只允许一个实例运行。
 */
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import { IPC, type LogLevel } from '@cd/shared';
import { closeLogger, initLogger, log } from './logger';
import { flushStore, initStore } from './store';
import { configureWaSession, installWaPermissionHandler } from './wa-session';
import { WaEmbedView } from './embed-view';
import {
  applyGraphicsPlan,
  describeGraphicsPlan,
  installGpuDiagnostics,
  type GraphicsPlan,
} from './graphics';
import { registerIpc } from './ipc';
import { buildRuntimeConfig, initTranslate, notifyTranslateConfigChanged } from './translate';
import { closeToast } from './toast-window';
import { createMainWindow } from './window';
import { getWaPartitionId } from './partition';

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

let mainWindow: BrowserWindow | null = null;
let embedView: WaEmbedView | null = null;

function resolveLogLevel(): LogLevel {
  const raw = __LOG_LEVEL__;
  return LOG_LEVELS.includes(raw as LogLevel) ? (raw as LogLevel) : 'info';
}

// ── 以下两项必须在 app ready 之前完成，顺序不能调换 ──────────────────
//
// 1) 固定应用名。
//    app.getName() 默认取 package.json 的 name，即 "@cd/desktop"，带斜杠，
//    会生成 `AppData\Roaming\@cd\desktop` 这样的嵌套目录；而打包态的 productName
//    是 "CarDashboard"，两者不一致 —— 结果是**开发期与安装后的 WhatsApp 登录态、
//    账号备注各存一份**，排查问题时极易误判。显式固定名称，让两种形态共用同一目录。
//    单实例锁也依赖这个目录，所以必须排在锁之前。
app.setName('CarDashboard');

// 2) 图形/沙箱开关。默认什么都不动（标准模式）；
//    仅在显式设置 CD_COMPAT_MODE=1 时才关沙箱 + 软渲染（见 graphics.ts 的说明）。
const graphicsPlan: GraphicsPlan = applyGraphicsPlan();

/**
 * 3) 用户数据目录覆盖（自动化测试与排障用）。
 *
 * 为什么需要这个开关：端到端测试必须**不碰使用者的真实数据** ——
 * 真实目录里存着 WhatsApp 登录态（`persist:` 分区）与账号备注，
 * 测试一旦写进去，使用者就要重新扫码。
 *
 * ⚠️ 实测教训：**用 `APPDATA` 环境变量是无效的**。Electron 的 `app.getPath('appData')`
 * 在 Windows 上取的是系统已知文件夹，不读该环境变量（试过一次，测试直接写进了
 * 使用者的真实 `%APPDATA%\CarDashboard`）。必须用 `app.setPath('userData')` 显式指定。
 *
 * 另一个必须性：单实例锁也基于该目录。若不隔离，只要使用者开着客户端，
 * 测试启动的实例会立刻自行退出，测试直接超时。
 *
 * 必须排在单实例锁之前。
 */
const userDataOverride = process.env.CD_USER_DATA_DIR ?? '';
if (userDataOverride) {
  // setPath 要求目录已存在，否则抛异常
  fs.mkdirSync(userDataOverride, { recursive: true });
  app.setPath('userData', userDataOverride);
}

if (!app.requestSingleInstanceLock()) {
  // 已有实例在跑：直接退出，由已有实例把窗口带到前台
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    // 单机客户端：关掉窗口即退出（Windows 习惯）
    app.quit();
  });

  app.on('before-quit', () => {
    flushStore();
    log('info', 'app', '应用退出');
    closeLogger();
  });

  void app.whenReady().then(onReady);
}

async function onReady(): Promise<void> {
  initLogger(resolveLogLevel());
  log(
    'info',
    'app',
    `启动 v${app.getVersion()}｜Electron ${process.versions.electron}｜Chromium ${process.versions.chrome}｜Node ${process.versions.node}`,
  );
  log(
    'info',
    'app',
    `WhatsApp 分区标识 = ${getWaPartitionId()}（单一注入点：src/main/partition.ts；加入登录层后改为用户标识）`,
  );
  log('info', 'gpu', `运行模式：${describeGraphicsPlan(graphicsPlan)}`);
  log('info', 'app', `用户数据目录：${app.getPath('userData')}`);
  if (userDataOverride) {
    // 覆盖了默认目录要显眼一点：使用者排障时会疑惑「我的设置去哪了」
    log('warn', 'app', `用户数据目录已被 CD_USER_DATA_DIR 覆盖（测试/排障用途）：${userDataOverride}`);
  }
  installGpuDiagnostics((message) => log('warn', 'gpu', message));

  initStore();

  // 分区必须先在 ready 之后配置好，再创建内嵌视图
  await configureWaSession(__WA_PROXY__);
  installWaPermissionHandler();

  mainWindow = createMainWindow();

  // 翻译调度器必须在内嵌视图之前初始化：视图创建后就要拿到配置下发给注入脚本
  initTranslate({
    getWindow: () => mainWindow,
    onStatus: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC.TRANSLATE_STATUS, payload);
    },
  });

  embedView = new WaEmbedView({
    host: mainWindow,
    onStatus: (payload) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC.WA_STATUS, payload);
    },
    // 由调度器提供当前生效配置（含实际选中的渠道），视图只负责转发
    getTranslateConfig: buildRuntimeConfig,
  });

  registerIpc({
    getWindow: () => mainWindow,
    getEmbed: () => embedView,
  });

  // Toast 浮层窗口是独立窗口，主窗口最小化时必须收掉，否则会孤零零飘在桌面上
  mainWindow.on('minimize', () => closeToast());

  /**
   * 渲染层加载完成后**补推一次**翻译状态。
   *
   * 为什么不跟着 `initTranslate` 在启动时就推：那一刻渲染层的 `onStatus` 监听还没注册
   * （页面尚未加载完），消息会直接丢掉。丢掉的表现是——使用者明明已经启用了翻译，
   * 右侧功能栏却长期挂着「翻译服务暂时不可用」的橙色提示，是个只会误导人的误报。
   * 延迟一点，与 `embed-view` 下发注入配置用同一套时序约定。
   */
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => notifyTranslateConfigChanged(), 300);
  });

  mainWindow.on('closed', () => {
    closeToast();
    embedView?.destroy();
    embedView = null;
    mainWindow = null;
  });

  log('info', 'app', '初始化完成');
}
