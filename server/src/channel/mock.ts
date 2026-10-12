import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { IdGenerator } from '../domain/ids.js';
import { uuidIds } from '../domain/ids.js';
import type { MediaRef, NormalizedMessage } from '../domain/types.js';
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelStatus,
  type LoginTicket,
  type MessageHandler,
  type SendResult,
} from './adapter.js';

export interface MockAdapterOptions {
  clock?: Clock;
  ids?: IdGenerator;
  /** 二维码 ticket 的有效期（毫秒） */
  ticketTtlMs?: number;
}

interface ChannelState {
  status: ChannelStatus;
  ticket: LoginTicket | null;
  history: NormalizedMessage[];
  sent: NormalizedMessage[];
}

/**
 * 内存版通道适配器。
 *
 * 用途有二：
 *  ① 让整条管道（存储 / 翻译 / 界面）在**没有真实号码**的情况下就能跑通并测试；
 *  ② 作为 `ChannelAdapter` 契约测试的第一个实现，把接口语义钉死。
 *
 * 它不模拟协议细节，只保证接口语义正确。
 */
export class MockAdapter implements ChannelAdapter {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly ticketTtlMs: number;
  private readonly channels = new Map<string, ChannelState>();
  private readonly handlers = new Set<MessageHandler>();

  constructor(options: MockAdapterOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? uuidIds;
    this.ticketTtlMs = options.ticketTtlMs ?? 60_000;
  }

  /* ---------- 测试 / 演示用的驱动口 ---------- */

  /** 模拟「用户扫码完成」 */
  confirmLogin(channelId: string): void {
    const state = this.state(channelId);
    if (state.status === 'disconnected') {
      throw new ChannelError('尚未开始登录，无法确认', 'login_required', channelId);
    }
    state.status = 'connected';
    state.ticket = null;
  }

  /** 模拟「收到一条入站消息」，会投递给所有订阅者 */
  receive(msg: NormalizedMessage): void {
    this.state(msg.channelId).history.push(msg);
    for (const handler of this.handlers) handler(msg);
  }

  /** 预置历史消息 */
  seedHistory(channelId: string, msgs: NormalizedMessage[]): void {
    this.state(channelId).history.push(...msgs);
  }

  /** 取该账号本次进程内发出的消息（供测试断言「发出去的到底是什么」） */
  sentMessages(channelId: string): readonly NormalizedMessage[] {
    return this.state(channelId).sent;
  }

  /* ---------- ChannelAdapter ---------- */

  async startLogin(channelId: string): Promise<LoginTicket> {
    const state = this.state(channelId);
    const ticket: LoginTicket = {
      qr: `mock://qr/${channelId}/${this.ids.short()}`,
      pairingCode: this.pairingCode(),
      expiresAt: this.clock.now() + this.ticketTtlMs,
    };
    state.status = 'pending';
    state.ticket = ticket;
    return ticket;
  }

  async getStatus(channelId: string): Promise<ChannelStatus> {
    return this.state(channelId).status;
  }

  async listChannels(): Promise<string[]> {
    return [...this.channels.entries()]
      .filter(([, s]) => s.status === 'connected')
      .map(([id]) => id);
  }

  async logout(channelId: string): Promise<void> {
    const state = this.state(channelId);
    state.status = 'disconnected';
    state.ticket = null;
  }

  async sendText(channelId: string, chatId: string, text: string): Promise<SendResult> {
    this.assertConnected(channelId);
    if (text.trim().length === 0) {
      throw new ChannelError('文本不能为空', 'unknown', channelId);
    }
    return this.recordSent(channelId, chatId, text, null, 'direct');
  }

  async sendMedia(
    channelId: string,
    chatId: string,
    media: MediaRef,
    caption?: string,
  ): Promise<SendResult> {
    this.assertConnected(channelId);
    return this.recordSent(channelId, chatId, caption ?? null, [media], 'direct');
  }

  async fetchHistory(
    channelId: string,
    chatId: string,
    limit = 50,
  ): Promise<NormalizedMessage[]> {
    this.assertConnected(channelId);
    const all = this.state(channelId).history.filter((m) => m.chatId === chatId);
    return all.slice(Math.max(0, all.length - limit));
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /* ---------- 内部 ---------- */

  private state(channelId: string): ChannelState {
    let s = this.channels.get(channelId);
    if (!s) {
      s = { status: 'disconnected', ticket: null, history: [], sent: [] };
      this.channels.set(channelId, s);
    }
    return s;
  }

  private assertConnected(channelId: string): void {
    const state = this.state(channelId);
    if (state.status !== 'connected') {
      throw new ChannelError(
        `账号 ${channelId} 未登录（当前状态：${state.status}）`,
        state.status === 'pending' ? 'login_required' : 'not_connected',
        channelId,
      );
    }
  }

  private recordSent(
    channelId: string,
    chatId: string,
    text: string | null,
    media: MediaRef[] | null,
    chatType: 'direct' | 'group',
  ): SendResult {
    const timestamp = this.clock.now();
    const messageId = this.ids.next();
    this.state(channelId).sent.push({
      channelId,
      chatId,
      chatType,
      messageId,
      direction: 'outbound',
      origin: 'system',
      senderId: channelId,
      text,
      media,
      timestamp,
    });
    return { messageId, timestamp };
  }

  private pairingCode(): string {
    return this.ids.short().slice(0, 8).toUpperCase();
  }
}
