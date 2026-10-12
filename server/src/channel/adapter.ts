import type { MediaRef, NormalizedMessage } from '../domain/types.js';

export type ChannelStatus = 'connected' | 'pending' | 'disconnected';

/** 扫码登录的结果。`qr` 是给前端渲染成二维码的 payload 字符串。 */
export interface LoginTicket {
  qr: string;
  /** 部分实现支持 8 位配对码（免扫码） */
  pairingCode?: string;
  /** 该 ticket 的过期时间，毫秒时间戳 */
  expiresAt?: number;
}

export interface SendResult {
  messageId: string;
  timestamp: number;
}

export type MessageHandler = (msg: NormalizedMessage) => void;

/**
 * 通道适配器 —— **这就是「预留的缝」**。
 *
 * 业务层（管道 / 翻译 / 存储 / 界面）只依赖此接口，不感知底层是哪个库。
 * 目标：换通道 = 换一个实现，业务代码一行不改。
 */
export interface ChannelAdapter {
  /* ---------- 账号生命周期 ---------- */

  /** 扫码登录：产出二维码供前端渲染 */
  startLogin(channelId: string): Promise<LoginTicket>;

  /** 当前登录状态 */
  getStatus(channelId: string): Promise<ChannelStatus>;

  /** 已登录的账号列表 */
  listChannels(): Promise<string[]>;

  /** 登出并清理该账号的本地凭证 */
  logout(channelId: string): Promise<void>;

  /* ---------- 消息收发 ---------- */

  /** 发文本。**通道不做翻译** —— 传进来的就是要发出去的最终文本。 */
  sendText(channelId: string, chatId: string, text: string): Promise<SendResult>;

  /** 发媒体 */
  sendMedia(
    channelId: string,
    chatId: string,
    media: MediaRef,
    caption?: string,
  ): Promise<SendResult>;

  /** 拉取历史消息（首次接入后回填用） */
  fetchHistory(channelId: string, chatId: string, limit?: number): Promise<NormalizedMessage[]>;

  /* ---------- 事件 ---------- */

  /**
   * 订阅入站消息。返回取消订阅函数。
   * 实现必须保证：同一 messageId 不会被投递两次（幂等由存储层兜底，但通道层应尽量去重）。
   */
  onMessage(handler: MessageHandler): () => void;
}

/** 通道实现抛出的错误，带可判定的类别，便于上层决定是否重试 */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly code: ChannelErrorCode,
    readonly channelId?: string,
  ) {
    super(message);
    this.name = 'ChannelError';
  }
}

export type ChannelErrorCode =
  | 'not_connected'
  | 'login_required'
  | 'gone'
  | 'rate_limited'
  | 'unknown';
