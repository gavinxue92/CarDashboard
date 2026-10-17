/**
 * 翻译渠道适配器接口（FR-3.31）。
 *
 * 存在意义：本版渠道未定（用户 2026-10-14：「先接零注册公共端点验证」），
 * 而将来换渠道**不允许改动调用方**。因此把「怎么翻」收敛成一个接口，
 * 上层调度器只认这个接口，不认具体是哪一家。
 *
 * 两条纪律：
 *   1) 适配器**不自己发网络请求**——它拿到的是 `ctx.request`，由调度器统一
 *      绑定网络栈（走 WhatsApp 分区的代理出口）。否则每个渠道各写一套超时/代理逻辑。
 *   2) 失败必须抛 `TranslateError` 并带上错误码，不要抛裸 Error —
 *      上层要靠错误码决定「静默跳过」还是「阻断发送」（FR-3.26）。
 */
import type { TranslateDirection, TranslateErrorCode, TranslateProviderId } from '@cd/shared';

/** 一次翻译任务（语言用界面标签表达，代码转换由各适配器自己负责） */
export interface TranslateJob {
  text: string;
  /** 源语言标签 */
  fromLabel: string;
  /** 目标语言标签 */
  toLabel: string;
  direction: TranslateDirection;
  /** 目标语言输出繁体（FR-3.30） */
  traditionalChinese: boolean;
}

/** 调度器交给适配器的执行上下文 */
export interface ProviderContext {
  /**
   * 发起 HTTPS 请求。
   *
   * ⚠️ 绑定的是 **WhatsApp 分区的网络栈**，因此会沿用该分区配置的代理出口、
   * 系统代理与证书设置。翻译与聊天走同一条出口，是刻意的：
   * 企业内网要么都通、要么都不通，分成两条路只会让排障更麻烦。
   */
  request(url: string, init: RequestInit): Promise<Response>;
  /** 由调度器控制的超时信号 */
  signal: AbortSignal;
}

export interface TranslateProvider {
  readonly id: TranslateProviderId;
  readonly label: string;
  /**
   * 当前是否具备调用条件（密钥是否齐备等）。
   * 返回 false 时调度器会直接判定「渠道不可用」，不发请求。
   */
  ready(): boolean;
  translate(job: TranslateJob, ctx: ProviderContext): Promise<string>;
}

/** 带错误码的翻译异常 */
export class TranslateError extends Error {
  readonly code: TranslateErrorCode;

  constructor(code: TranslateErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TranslateError';
    this.code = code;
  }
}

/** HTTP 状态码 → 错误码。各适配器共用，避免同一件事在两家各判一次。 */
export function errorCodeFromStatus(status: number): TranslateErrorCode {
  if (status === 401 || status === 403) return 'auth';
  // 429 通用限流；456 是 Google 系「额度用尽」的专用码
  if (status === 429 || status === 456) return 'quota';
  // 其余（400 参数错、5xx 服务端故障等）都归为「响应异常」：
  // 对使用者的处置是同一个 —— 入向跳过、出向阻断，不需要再细分。
  return 'bad-response';
}

/** 把任意抛出物归一成错误码，供调度器统一处理 */
export function toErrorCode(err: unknown): TranslateErrorCode {
  if (err instanceof TranslateError) return err.code;
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
    return 'network';
  }
  return 'unknown';
}
