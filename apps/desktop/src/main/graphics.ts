/**
 * 图形/沙箱相关的启动开关与诊断。
 *
 * ⚠️ 重要结论（2026-10 实测，勿重复踩坑）：
 * 从「代理/IDE 的执行上下文」里直接拉起 Electron 时，Chromium 的渲染进程会
 * 以 `exitCode = -2147483645（0xC0000003 STATUS_BREAKPOINT）` 崩溃——
 * 这是沙箱初始化断言失败，不是普通崩溃。随后 GPU 进程也会被连带打崩
 * （`0xC0000005`），日志表现为 `FATAL: GPU process isn't usable. Goodbye.`
 *
 * 对照组实验证明**这与本工程无关，也与 Electron 版本无关**：
 * 用 Electron 37.10.3（与本机运行正常的 WorkBuddy 同版本）跑最小探针，
 * 在同一上下文下崩溃表现完全一致；而作为顶层应用启动时一切正常。
 *
 * 因此：
 *   • 不要为了「修好冒烟测试」而在默认路径上关闭沙箱或硬件加速——
 *     那是拿真实的安全性与渲染性能去换一个不存在的故障。
 *   • 本模块只保留**显式逃生舱**与**可观测性**。
 *
 * 逃生舱（面向确实受限的机器：强管控的域内电脑、部分虚拟机/远程桌面）：
 *   设置环境变量 `CD_COMPAT_MODE=1` → 追加 `--no-sandbox` 并走软件光栅化。
 *   ⚠️ 安全代价：本模块内嵌的是第三方（WhatsApp）远程页面，
 *   关闭沙箱等于放弃进程隔离。仅在确认标准模式起不来时才用，并记入本地日志。
 */
import { app } from 'electron';

/** 兼容模式开关：显式要求时关闭沙箱与硬件加速 */
const COMPAT_MODE_ENV = 'CD_COMPAT_MODE';

export interface GraphicsPlan {
  /** 是否启用兼容模式（关沙箱 + 软渲染） */
  compatMode: boolean;
}

/**
 * 应用图形/沙箱开关。
 *
 * ⚠️ 必须在 `app.whenReady()` 之前调用，否则命令行开关不生效。
 * 由于此时日志系统尚未初始化，本函数只做决策，由调用方在 ready 之后补记日志。
 */
export function applyGraphicsPlan(): GraphicsPlan {
  const compatMode = process.env[COMPAT_MODE_ENV] === '1';

  if (compatMode) {
    app.commandLine.appendSwitch('no-sandbox');
    app.disableHardwareAcceleration();
  }

  return { compatMode };
}

/**
 * 登记 GPU 子进程异常退出。
 *
 * 用途：交付后排查「某些办公电脑打不开 / 画面全黑」这类一线反馈时，
 * 这是唯一能区分「网络问题」「驱动问题」「被安全软件拦截」的本地线索。
 */
export function installGpuDiagnostics(log: (message: string) => void): void {
  app.on('child-process-gone', (_event, details) => {
    if (details.type !== 'GPU') return;
    log(`GPU 进程退出：reason=${details.reason} exitCode=${details.exitCode}`);
  });
}

/** 供启动日志使用的中文描述 */
export function describeGraphicsPlan(plan: GraphicsPlan): string {
  return plan.compatMode
    ? `兼容模式（由 ${COMPAT_MODE_ENV}=1 指定：已关闭沙箱与硬件加速）`
    : '标准模式（沙箱开启、按需硬件加速）';
}
