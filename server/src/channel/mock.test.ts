import { describe, expect, it } from 'vitest';
import { fixedClock } from '../domain/clock.js';
import { sequentialIds } from '../domain/ids.js';
import { MockAdapter } from './mock.js';
import { defineChannelAdapterContract, makeInboundMessage } from './testing/contract.js';

function harness() {
  const clock = fixedClock(1_700_000_000_000);
  const ids = sequentialIds('t');
  const adapter = new MockAdapter({ clock, ids });
  return {
    adapter,
    async login(channelId: string) {
      await adapter.startLogin(channelId);
      adapter.confirmLogin(channelId);
    },
    emitInbound(msg: Parameters<typeof adapter.receive>[0]) {
      adapter.receive(msg);
    },
  };
}

// 契约测试：所有通道实现共用同一套语义
defineChannelAdapterContract('MockAdapter', harness);

describe('MockAdapter 专有行为', () => {
  it('系统发出的消息 origin 为 system（与手机手打区分）', async () => {
    const h = harness();
    await h.login('ch-1');
    await h.adapter.sendText('ch-1', 'chat-1', '你好');
    const sent = h.adapter.sentMessages('ch-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.origin).toBe('system');
    expect(sent[0]?.direction).toBe('outbound');
    expect(sent[0]?.text).toBe('你好');
  });

  it('发出的文本原样传递，通道层不做任何改写（翻译是上游的事）', async () => {
    const h = harness();
    await h.login('ch-1');
    await h.adapter.sendText('ch-1', 'chat-1', '国六 双离合 事故车');
    expect(h.adapter.sentMessages('ch-1')[0]?.text).toBe('国六 双离合 事故车');
  });

  it('fetchHistory 按会话过滤并只返回最近 limit 条', async () => {
    const h = harness();
    await h.login('ch-1');
    for (let i = 1; i <= 5; i++) {
      h.adapter.seedHistory('ch-1', [
        makeInboundMessage({ channelId: 'ch-1', chatId: 'chat-A', messageId: `a-${i}` }),
      ]);
    }
    h.adapter.seedHistory('ch-1', [
      makeInboundMessage({ channelId: 'ch-1', chatId: 'chat-B', messageId: 'b-1' }),
    ]);
    const got = await h.adapter.fetchHistory('ch-1', 'chat-A', 2);
    expect(got.map((m) => m.messageId)).toEqual(['a-4', 'a-5']);
  });

  it('投递的消息会进入该账号历史', async () => {
    const h = harness();
    await h.login('ch-1');
    h.emitInbound(makeInboundMessage({ channelId: 'ch-1', chatId: 'chat-A' }));
    expect(await h.adapter.fetchHistory('ch-1', 'chat-A')).toHaveLength(1);
  });
});
