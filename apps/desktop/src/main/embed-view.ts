/**
 * WhatsApp 内嵌视图（技术方案 3.2 / 3.4 / 3.5）。
 *
 * 承载方式：Electron 44 推荐的 `WebContentsView`，挂在主窗口 contentView 上。
 * 为什么不用 iframe：`web.whatsapp.com` 响应头含 `frame-ancestors 'none'`，网页层面物理上嵌不进来。
 *
 * 我方职责：
 *   1) 创建/销毁视图；
 *   2) 把可观测的页面事件映射成三色状态；
 *   3) 按需显示或隐藏；
 *   4) **加载注入脚本并向它下发翻译配置**（V1.4 决策 D6 → D7）。
 *
 * 🔴 V1.4 修订：原实现「不注入脚本、不解析 DOM、不读写消息内容」。
 *    因双向翻译要求「译文显示在消息下方」，必须读消息 DOM 并往气泡里插节点，
 *    故改为加载 `wa-inject.js`。注入脚本跑在**隔离世界**，
 *    与官方页面共享 DOM 但 JS 作用域互相不可见，**沙箱保持开启**。
 *
 * ⚠️ 可见性规则（决定了 M1/M2/M3/M4 各态能否正确呈现）：
 * WebContentsView 是原生层，永远绘制在我方 HTML 之上。因此凡是要让我方
 * 加载指示器 / 故障覆盖层 / 模态弹窗可见的时刻，都必须把内嵌视图隐藏，
 * 而不是指望用 HTML 盖住它。
 *   可见 = 状态为运行中 && 已成功加载过 && 未被我方叠加层遮挡 && 矩形有效
 */
import path from 'node:path';
import fs from 'node:fs';
import { WebContentsView, type BrowserWindow } from 'electron';
import {
  INJECT_IPC,
  LOAD_TIMEOUT_MS,
  type TranslateRuntimeConfig,
  type WaRunStatus,
  type WaStatusPayload,
  type WaViewBounds,
} from '@cd/shared';
import { WA_URL, clearWaSession, getWaSession } from './wa-session';
import { hardenWebContents } from './nav-guard';
import { log } from './logger';

/** 后台自动重连退避（交互说明 8.2）：5s / 15s / 30s，三次后停止并交给用户手动重试 */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

/**
 * 页面加载完成后向注入脚本下发翻译配置的尝试时刻（毫秒，累计）。
 *
 * 为什么是「多次」而不是一次固定的 300ms：
 * `did-finish-load` 只表示文档加载完，此刻 WhatsApp 自己的 JS 才开始握手、拉会话列表、
 * 渲染 `#main`。真机实测（2026-10-14，v0.1.3 日志）从 did-finish-load 到
 * `首次扫描未找到消息区域` 只隔了 542ms —— 一次性下发必然在 `#main` 出现之前，
 * 那一次补扫白扫，而注入脚本自己又不会轮询官方 DOM（FR-3.22 禁止）。
 * 所以这里按递增间隔重发几次：ipc 是幂等的（applyConfig 只覆盖配置 + 补扫一次），
 * 多收到几次没有副作用，却能把「首次补扫落空」这个必然事件变成小概率事件。
 */
const CONFIG_PUSH_DELAYS_MS = [300, 1_000, 2_500, 5_000, 9_000] as const;

/** 页面底色，与官方深色界面接近，避免加载瞬间出现刺眼白块 */
const VIEW_BACKGROUND = '#111b21';

/**
 * 注入脚本产物路径。
 * electron-vite 把 preload 输出到 `out/preload/`，主进程产物在 `out/main/`，
 * 因此是上一级目录（dev 与打包后结构一致）。
 */
function injectPreloadPath(): string {
  return path.join(__dirname, '../preload/wa-inject.js');
}

export interface WaEmbedViewOptions {
  host: BrowserWindow;
  /** 状态变化回调（主进程负责推给渲染进程） */
  onStatus: (payload: WaStatusPayload) => void;
  /** 取当前生效的翻译配置（由 translate 调度器提供，避免这里反向依赖它） */
  getTranslateConfig?: () => TranslateRuntimeConfig;
}

export class WaEmbedView {
  private readonly host: BrowserWindow;
  private readonly onStatus: (payload: WaStatusPayload) => void;
  private readonly getTranslateConfig: () => TranslateRuntimeConfig | undefined;

  private view: WebContentsView | null = null;
  private status: WaRunStatus = 'loading';
  private bounds: WaViewBounds = { x: 0, y: 0, width: 0, height: 0 };
  /** 是否被我方叠加层遮挡（模态弹窗 / 故障覆盖层 / 窄窗口引导） */
  private occluded = true;
  /** 当前这一轮导航是否已成功加载完成 */
  private loaded = false;

  private loadTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  /** 配置下发的重试定时器（页面加载后按 CONFIG_PUSH_DELAYS_MS 依次触发） */
  private configPushTimers: NodeJS.Timeout[] = [];
  private retryCount = 0;
  /** 最近一次主框架加载失败的 Chromium 错误码，用于区分故障文案 */
  private lastErrorCode: number | undefined;
  private disposed = false;

  constructor(options: WaEmbedViewOptions) {
    this.host = options.host;
    this.onStatus = options.onStatus;
    this.getTranslateConfig = options.getTranslateConfig ?? (() => undefined);
  }

  /**
   * 首次进入 WhatsApp 模块时调用：创建视图并开始加载（技术方案 3.2 步骤 1）。
   * 重复调用无副作用——已加载过就不再重新拉取，保证「常驻后台」语义（决策 D3）。
   */
  activate(): void {
    if (this.disposed) return;
    if (this.view && (this.loaded || this.status === 'loading')) {
      this.syncVisibility();
      return;
    }
    void this.navigate();
  }

  /** 重新加载（导航 ⋯ 菜单入口，FR-3.13 手动触发） */
  reload(): void {
    if (this.disposed) return;
    this.retryCount = 0;
    void this.navigate();
  }

  /** 解除绑定：清空分区登录态后重新加载，官方页面会回到二维码（FR-3.17 / 3.18） */
  async unbind(): Promise<void> {
    if (this.disposed) return;
    this.retryCount = 0;
    log('info', 'wa-view', '开始解除绑定：清空分区数据');
    await clearWaSession();
    await this.navigate();
  }

  /** 渲染层同步来的内嵌区矩形（CSS 像素，等于 Electron 的 DIP） */
  setBounds(bounds: WaViewBounds): void {
    if (this.disposed) return;
    this.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    this.applyBounds();
    this.syncVisibility();
  }

  /** 渲染层同步来的遮挡状态 */
  setOccluded(occluded: boolean): void {
    if (this.disposed) return;
    this.occluded = occluded;
    this.syncVisibility();
  }

  /**
   * 判断某个 webContents 是否属于本视图。
   *
   * 用途：注入层会通过 IPC 请求翻译，而它所在的页面是**第三方远程内容**。
   * 主进程必须确认请求确实来自我们的内嵌视图，不能凭「谁发来的都接」。
   */
  ownsWebContents(id: number): boolean {
    return this.view?.webContents.id === id;
  }

  destroy(): void {
    this.disposed = true;
    this.clearLoadTimer();
    this.clearRetryTimer();
    this.clearConfigPushTimers();
    this.destroyView();
  }

  // ── 内部实现 ───────────────────────────────────────────────────

  private async navigate(): Promise<void> {
    if (this.disposed) return;
    // 上一轮的配置重发计划作废：新页面加载完成后会重新排一次
    this.clearConfigPushTimers();
    this.loaded = false;
    this.lastErrorCode = undefined;
    this.setStatus('loading');
    this.armLoadTimer();

    const view = this.ensureView();
    try {
      await view.webContents.loadURL(WA_URL);
    } catch (err) {
      // 失败细节由 did-fail-load 处理，这里只落日志
      log('debug', 'wa-view', `loadURL 抛出异常：${String(err)}`);
    }
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;

    const preload = injectPreloadPath();
    const hasPreload = fs.existsSync(preload);
    if (!hasPreload) {
      // 没有注入脚本时功能降级为「纯外壳」，聊天本身不受影响。
      // 这种情况通常是构建产物缺失，属于工程问题，必须报警。
      log('error', 'wa-view', `注入脚本缺失（${preload}），翻译功能将不可用`);
    }

    const view = new WebContentsView({
      webPreferences: {
        session: getWaSession(),
        // 安全基线（技术方案 3.5 + 需求 5.3.7）：
        //   隔离 + 禁 Node + **保持沙箱开启**。
        //   注入脚本在沙箱下依然可用——它只需要 ipcRenderer，
        //   而 ipcRenderer 属于沙箱 preload 允许的少数模块之一。
        //   ⚠️ 严禁为了注入而关闭沙箱：本视图承载的是第三方远程内容。
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
        // V1.4：注入双向翻译脚本（跑在隔离世界，与页面共享 DOM）
        ...(hasPreload ? { preload } : {}),
      },
    });

    try {
      view.setBackgroundColor(VIEW_BACKGROUND);
    } catch {
      // 个别版本无此方法，忽略即可
    }

    this.host.contentView.addChildView(view);
    view.setVisible(false);
    hardenWebContents(view.webContents, 'wa-view');
    this.wireEvents(view);

    this.view = view;
    log(
      'info',
      'wa-view',
      hasPreload ? '内嵌视图已创建（已加载翻译注入脚本）' : '内嵌视图已创建（无注入脚本）',
    );
    return view;
  }

  /**
   * 把当前翻译配置下发给注入脚本（FR-3.29：设置改动即时生效）。
   *
   * 为什么要主进程主动推、而不是让注入脚本自己拉：
   * 注入脚本每次页面加载都是全新的 JS 环境、不继承任何状态，
   * 且它没有读取本地配置的权限（沙箱 + 隔离世界）。所以配置只能由主进程持有并下发。
   */
  pushTranslateConfig(config?: TranslateRuntimeConfig): void {
    const view = this.view;
    if (!view) return;
    const payload = config ?? this.getTranslateConfig();
    if (!payload) return;
    try {
      view.webContents.send(INJECT_IPC.CONFIG, payload);
    } catch (err) {
      log('debug', 'wa-view', `下发翻译配置失败：${String(err)}`);
    }
  }

  private wireEvents(view: WebContentsView): void {
    const wc = view.webContents;

    // 只在「当前这轮尚未加载成功」时把启动加载视为进入加载态，
    // 否则官方页面内部的二次导航会把状态打回加载中、导致画面闪断。
    wc.on('did-start-loading', () => {
      if (this.disposed || this.loaded) return;
      this.setStatus('loading');
    });

    wc.on('did-finish-load', () => {
      if (this.disposed) return;
      this.clearLoadTimer();
      this.clearRetryTimer();
      this.retryCount = 0;
      this.loaded = true;
      this.setStatus('running');
      // 页面每次加载都是全新的 JS 环境，注入脚本不继承任何状态，必须重发配置。
      // 按递增间隔重发几次，确保「页面渲染出 #main 之后」至少有一次能补扫到。
      this.scheduleConfigPush();
    });

    // -3 = ERR_ABORTED，通常是重定向或我方主动中断，不算故障
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (this.disposed) return;
      if (!isMainFrame || errorCode === -3) return;
      log('warn', 'wa-view', `加载失败 code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
      this.loaded = false;
      this.lastErrorCode = errorCode;
      this.setStatus('error');
      this.scheduleRetry();
    });

    wc.on('render-process-gone', (_event, details) => {
      if (this.disposed) return;
      log('error', 'wa-view', `渲染进程退出：${details.reason}`);
      this.loaded = false;
      this.setStatus('error');
      // 进程已死，必须整视图重建，reload 对已崩溃的 webContents 无效
      this.destroyView();
      this.scheduleRetry();
    });

    wc.on('unresponsive', () => {
      if (this.disposed) return;
      log('warn', 'wa-view', '页面无响应');
      this.setStatus('error');
      this.scheduleRetry();
    });

    wc.on('responsive', () => {
      if (this.disposed || this.status !== 'error') return;
      // 页面恢复响应：以加载完成事件为准回到运行中
      this.setStatus('running');
    });
  }

  private scheduleRetry(): void {
    if (this.disposed) return;
    this.clearRetryTimer();

    if (this.retryCount >= RETRY_DELAYS_MS.length) {
      log('warn', 'wa-view', '三次自动重连均失败，等待用户手动重试');
      this.emit(true);
      return;
    }

    const delay = RETRY_DELAYS_MS[this.retryCount] ?? 5_000;
    this.retryCount += 1;
    log('info', 'wa-view', `${delay}ms 后执行第 ${this.retryCount} 次自动重连`);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      void this.navigate();
    }, delay);
  }

  private armLoadTimer(): void {
    this.clearLoadTimer();
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      if (this.disposed || this.loaded) return;
      // 只落日志：超时文案与「重试」按钮由渲染层按同一份 LOAD_TIMEOUT_MS 呈现（FR-3.8）
      log('warn', 'wa-view', `${LOAD_TIMEOUT_MS}ms 内未加载完成，仍在等待`);
    }, LOAD_TIMEOUT_MS);
  }

  private clearLoadTimer(): void {
    if (!this.loadTimer) return;
    clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * 按递增间隔把翻译配置重发几次。
   * 幂等：`applyConfig` 只是覆盖配置并补扫一次，多收几次不会造成重复译文
   * （译文节点按 DOM 属性去重，见 `wa-dom.ts` 的 `hasTranslationNode`）。
   */
  private scheduleConfigPush(): void {
    this.clearConfigPushTimers();
    for (const delay of CONFIG_PUSH_DELAYS_MS) {
      this.configPushTimers.push(
        setTimeout(() => {
          if (this.disposed) return;
          this.pushTranslateConfig();
        }, delay),
      );
    }
  }

  private clearConfigPushTimers(): void {
    for (const timer of this.configPushTimers) clearTimeout(timer);
    this.configPushTimers = [];
  }

  private setStatus(next: WaRunStatus, exhausted = false): void {
    if (this.status !== next) {
      log('info', 'wa-view', `运行状态：${this.status} → ${next}`);
    }
    this.status = next;
    if (next !== 'loading') this.clearLoadTimer();
    this.syncVisibility();
    this.emit(exhausted);
  }

  private emit(retryExhausted: boolean): void {
    this.onStatus({
      status: this.status,
      at: Date.now(),
      retryCount: this.retryCount,
      retryExhausted,
      ...(this.lastErrorCode === undefined ? {} : { errorCode: this.lastErrorCode }),
    });
  }

  /**
   * 内嵌视图是否应当可见。
   * 三个条件缺一不可：页面确实在正常运行、没有被我方叠加层遮挡、矩形有效。
   */
  private syncVisibility(): void {
    const view = this.view;
    if (!view) return;
    const visible =
      this.status === 'running' &&
      this.loaded &&
      !this.occluded &&
      this.bounds.width > 1 &&
      this.bounds.height > 1;
    try {
      view.setVisible(visible);
    } catch (err) {
      log('debug', 'wa-view', `设置可见性失败：${String(err)}`);
    }
  }

  private applyBounds(): void {
    const view = this.view;
    if (!view) return;
    if (this.bounds.width <= 0 || this.bounds.height <= 0) return;
    try {
      view.setBounds(this.bounds);
    } catch (err) {
      log('debug', 'wa-view', `设置矩形失败：${String(err)}`);
    }
  }

  private destroyView(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    try {
      this.host.contentView.removeChildView(view);
    } catch {
      // 窗口可能已销毁
    }
    try {
      view.webContents.close();
    } catch {
      // 已关闭
    }
  }
}
