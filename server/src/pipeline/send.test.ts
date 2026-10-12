import { describe, expect, it } from 'vitest';
import { ChannelError } from '../channel/adapter.js';
import { SendBlockedError } from './send.js';
import { CH, inbound, rig, scene } from './testing/rig.js';

describe('SendService · 出站草稿（先看译文再发）', () => {
  it('draft 从客户档案读取语言并产出译文，但不发送', async () => {
    const { send, adapter, conversation } = await scene({ contactLanguage: 'en' });
    const draft = await send.draft(conversation.id, '你好');

    expect(draft.status).toBe('done');
    expect(draft.translatedText).toBe('Hello');
    expect(draft.targetLanguage).toBe('en');
    // 关键：草稿阶段一条都没发出去
    expect(adapter.sentMessages(CH)).toHaveLength(0);
  });

  it('客户语言未设置时 draft 为 skipped 并说明原因，而不是瞎猜', async () => {
    const { send, conversation } = await scene({ contactLanguage: null });
    const draft = await send.draft(conversation.id, '你好');
    expect(draft.status).toBe('skipped');
    expect(draft.translatedText).toBeNull();
    expect(draft.reason).toContain('客户语言未设置');
  });
});

describe('SendService · 发送', () => {
  it('send 发出的是译文，落库时原文与译文都保留', async () => {
    const { send, adapter, repo, conversation } = await scene({ contactLanguage: 'en' });
    const draft = await send.draft(conversation.id, '你好');
    const saved = await send.send(draft);

    expect(adapter.sentMessages(CH)[0]?.text).toBe('Hello');
    expect(saved.text).toBe('你好');
    expect(saved.textTranslated).toBe('Hello');
    expect(saved.direction).toBe('outbound');
    expect(saved.origin).toBe('system');
    expect(saved.translationStatus).toBe('done');
    expect(await repo.listMessages(conversation.id)).toHaveLength(1);
  });

  it('没有可发文本时抛 SendBlockedError，且不发送、不落库（绝不静默直发）', async () => {
    const { send, adapter, repo, conversation } = await scene({ contactLanguage: null });
    const draft = await send.draft(conversation.id, '你好');

    await expect(send.send(draft)).rejects.toBeInstanceOf(SendBlockedError);
    expect(adapter.sentMessages(CH)).toHaveLength(0);
    expect(await repo.listMessages(conversation.id)).toHaveLength(0);
  });

  it('业务员手动指定最终文本时以它为准，并留下当时的翻译状态备注', async () => {
    const { send, adapter, conversation } = await scene({ contactLanguage: null });
    const draft = await send.draft(conversation.id, '你好');
    const saved = await send.send(draft, 'Hello, my friend');

    expect(adapter.sentMessages(CH)[0]?.text).toBe('Hello, my friend');
    expect(saved.textTranslated).toBe('Hello, my friend');
    expect(saved.translationError).toContain('客户语言未设置');
  });

  it('发送推进 lastMessageAt 但不增加未读数', async () => {
    const { send, repo, conversation } = await scene({ contactLanguage: 'en' });
    await send.sendDirect(conversation.id, '你好');
    const conv = await repo.getConversation(conversation.id);
    expect(conv?.lastMessageAt).toBe(1_700_000_000_000);
    expect(conv?.unreadCount).toBe(0);
  });

  it('通道未登录时发送失败，且不留下「以为发出去了」的记录', async () => {
    const { send, repo, adapter, conversation } = await scene({ contactLanguage: 'en' });
    await adapter.logout(CH);

    await expect(send.sendDirect(conversation.id, '你好')).rejects.toBeInstanceOf(ChannelError);
    expect(await repo.listMessages(conversation.id)).toHaveLength(0);
  });

  it('会话不存在时 draft 直接报错', async () => {
    const { send } = rig();
    await expect(send.draft('nope', '你好')).rejects.toThrow(/会话不存在/);
  });

  it('sendDirect 是「草稿 + 发送」的一键路径', async () => {
    const { send, adapter, conversation } = await scene({ contactLanguage: 'en' });
    const saved = await send.sendDirect(conversation.id, '你好');
    expect(saved.textTranslated).toBe('Hello');
    expect(adapter.sentMessages(CH)).toHaveLength(1);
  });
});

describe('收发两条链路合流', () => {
  it('一条会话里入站与出站按时间顺序排列，原文译文都在', async () => {
    const { ingest, send, repo, conversation } = await scene({ contactLanguage: 'en' });

    await ingest.ingest(inbound({ messageId: 'in-1', timestamp: 1000 }));
    await send.sendDirect(conversation.id, '你好');

    const messages = await repo.listMessages(conversation.id, { limit: 10 });
    expect(messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
    expect(messages[0]?.text).toBe('How much is this truck?');
    expect(messages[0]?.textTranslated).toBe('这辆卡车多少钱？');
    expect(messages[1]?.text).toBe('你好');
    expect(messages[1]?.textTranslated).toBe('Hello');
  });
});
