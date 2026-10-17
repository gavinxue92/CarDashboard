/**
 * WhatsApp 内嵌页面的「运行状态」。
 *
 * ⚠️ 语义边界（交互说明 9.1 / 技术方案 3.4）：
 * 这里表达的是**我方内嵌视图里的页面是否正常运行**，不是「WhatsApp 账号是否在线」。
 * 我方读不到官方页面的账号状态，因此文案必须避免「已连接」这类容易被误读为账号在线的措辞。
 */
export type WaRunStatus = 'loading' | 'running' | 'error';

/** 状态对应的中文文案（UI 展示用，单一来源） */
export const WA_STATUS_LABEL: Record<WaRunStatus, string> = {
  loading: '加载中',
  running: '运行中',
  error: '连接异常',
};

/** 状态圆点悬停提示：把语义边界写在脸上（交互说明 2.3 铁律 2） */
export const WA_STATUS_TOOLTIP = '页面运行状态，不代表账号在线';

/** 主进程 → 渲染进程推送的状态载荷 */
export interface WaStatusPayload {
  status: WaRunStatus;
  /** 时间戳（ms），便于渲染层做「原地不动超过 N 秒」之类的弱判断 */
  at: number;
  /** 已执行的后台自动重连次数（交互说明 8.2：5s / 15s / 30s 三档退避） */
  retryCount?: number;
  /** 三次重试仍未成功：浮条改为「持续无法连接」并露出「立即重试」按钮 */
  retryExhausted?: boolean;
  /**
   * Chromium 的加载错误码（did-fail-load 的 errorCode）。
   * 渲染层据此区分「页面加载失败」与「网络不可达」两种故障文案（交互说明 5.3）。
   */
  errorCode?: number;
}

/**
 * 网络类错误码：命中时故障卡片按「网络连接异常」呈现，
 * 否则按「页面加载失败」呈现（交互说明 5.3 的两个场景）。
 */
export const NETWORK_ERROR_CODES: readonly number[] = [
  -106, // ERR_INTERNET_DISCONNECTED
  -102, // ERR_CONNECTION_REFUSED
  -118, // ERR_CONNECTION_TIMED_OUT
  -105, // ERR_NAME_NOT_RESOLVED
  -109, // ERR_ADDRESS_UNREACHABLE
  -130, // ERR_PROXY_CONNECTION_FAILED
  -137, // ERR_NAME_RESOLUTION_FAILED
];

/** 主进程可观测的页面事件 → 运行状态映射（技术方案 3.4） */
export interface WaViewSyncPayload {
  /** 内嵌区相对窗口内容区的矩形（CSS 像素） */
  bounds: WaViewBounds;
  /**
   * 是否被我方叠加层遮挡。
   * true 时主进程会隐藏内嵌视图，让模态弹窗 / 故障覆盖层 / 窄窗口引导可见。
   */
  occluded: boolean;
}

export interface WaViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
