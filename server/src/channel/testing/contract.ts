import { describe, expect, it } from 'vitest';
import type { NormalizedMessage } from '../../domain/types.js';
import { ChannelError, type ChannelAdapter } from '../adapter.js';

/**
 * 驱动一个通道实现所需的最小测试夹具。
 *
 * 契约测试只依赖这三件事，因此任何实现（MockAdapter / BaileysAdapter /
 * CloudApiAdapter）都能套用同一套用例 —— 这保证「换通道」时语义不变。
 */
export interface AdapterHarness {
  adapter: ChannelAdapter;
  /** 把账号推进到「已登录」状态 */
  login(channelId: string): Promise<void>;
  /** 投递一条入站消息（触发 onMessage 订阅者） */
  emitInbound(msg: NormalizedMessage): void;
}

export function makeInboundMessage(
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    channelId: 'ch-1',
    chatId: '8613800000000@s.whatsapp.net',
    chatType: 'direct',
    messageId: 'msg-1',
    direction: 'inbound',
    origin: 'system',
    senderId: '8613800000000@s.whatsapp.net',
    text: 'hello',
    media: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

/**
 * `ChannelAdapter` 契约测试。
 * 每个实现都应调用它，确保接口语义一致。
 */
export function defineChannelAdapterContract(
  name: string,
  createHarness: () => AdapterHarness | Promise<AdapterHarness>,
): void {
  describe(`ChannelAdapter 契约 · ${name}`, () => {
    const CH = 'ch-1';

    it('初始状态为 disconnected', async () => {
      const { adapter } = await createHarness();
      expect(await adapter.getStatus(CH)).toBe('disconnected');
      expect(await adapter.listChannels()).toEqual([]);
    });

    it('startLogin 返回可用二维码，状态转为 pending', async () => {
      const { adapter } = await createHarness();
      const ticket = await adapter.startLogin(CH);
      expect(typeof ticket.qr).toBe('string');
      expect(ticket.qr.length).toBeGreaterThan(0);
      expect(await adapter.getStatus(CH)).toBe('pending');
    });

    it('未登录时发送被拒绝（not_connected 或 login_required）', async () => {
      const { adapter } = await createHarness();
      await expect(adapter.sendText(CH, 'chat-1', 'hi')).rejects.toBeInstanceOf(ChannelError);
      await adapter.startLogin(CH);
      await expect(adapter.sendText(CH, 'chat-1', 'hi')).rejects.toMatchObject({
        code: expect.stringMatching(/not_connected|login_required/),
      });
    });

    it('登录后状态为 connected 且出现在 listChannels', async () => {
      const h = await createHarness();
      await h.login(CH);
      expect(await h.adapter.getStatus(CH)).toBe('connected');
      expect(await h.adapter.listChannels()).toContain(CH);
    });

    it('登录后 sendText 返回非空 messageId 与毫秒时间戳', async () => {
      const h = await createHarness();
      await h.login(CH);
      const r = await h.adapter.sendText(CH, 'chat-1', '你好');
      expect(r.messageId).toBeTruthy();
      expect(Number.isFinite(r.timestamp)).toBe(true);
    });

    it('sendText 拒绝空文本', async () => {
      const h = await createHarness();
      await h.login(CH);
      await expect(h.adapter.sendText(CH, 'chat-1', '   ')).rejects.toBeInstanceOf(ChannelError);
    });

    it('入站消息会投递给订阅者', async () => {
      const h = await createHarness();
      await h.login(CH);
      const got: NormalizedMessage[] = [];
      h.adapter.onMessage((m) => got.push(m));
      const msg = makeInboundMessage({ channelId: CH });
      h.emitInbound(msg);
      expect(got).toHaveLength(1);
      expect(got[0]?.messageId).toBe(msg.messageId);
    });

    it('取消订阅后不再收到消息', async () => {
      const h = await createHarness();
      await h.login(CH);
      const got: NormalizedMessage[] = [];
      const off = h.adapter.onMessage((m) => got.push(m));
      off();
      h.emitInbound(makeInboundMessage({ channelId: CH }));
      expect(got).toHaveLength(0);
    });

    it('多个订阅者都能收到同一条消息', async () => {
      const h = await createHarness();
      await h.login(CH);
      let a = 0;
      let b = 0;
      h.adapter.onMessage(() => (a += 1));
      h.adapter.onMessage(() => (b += 1));
      h.emitInbound(makeInboundMessage({ channelId: CH }));
      expect([a, b]).toEqual([1, 1]);
    });

    it('fetchHistory 返回数组', async () => {
      const h = await createHarness();
      await h.login(CH);
      const history = await h.adapter.fetchHistory(CH, 'chat-1');
      expect(Array.isArray(history)).toBe(true);
    });

    it('logout 后状态回到 disconnected 且不在 listChannels 中', async () => {
      const h = await createHarness();
      await h.login(CH);
      await h.adapter.logout(CH);
      expect(await h.adapter.getStatus(CH)).toBe('disconnected');
      expect(await h.adapter.listChannels()).not.toContain(CH);
    });
  });
}
