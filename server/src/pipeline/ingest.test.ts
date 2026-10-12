import { describe, expect, it, vi } from 'vitest';
import { CH, CUSTOMER, inbound, rig } from './testing/rig.js';

describe('IngestService · 入站管道', () => {
  it('落库原文并自动回填工作台语言译文', async () => {
    const { ingest, repo } = rig();
    const res = await ingest.ingest(inbound());

    expect(res.inserted).toBe(true);
    expect(res.persisted.text).toBe('How much is this truck?');
    expect(res.persisted.textTranslated).toBe('这辆卡车多少钱？');
    expect(res.persisted.translationStatus).toBe('done');
    expect(res.persisted.detectedLanguage).toBe('en');
    expect(res.persisted.targetLanguage).toBe('zh');
    expect(await repo.listMessages(res.persisted.conversationId)).toHaveLength(1);
  });

  it('原文与译文成对保存，原文一字不改', async () => {
    const { ingest } = rig();
    const res = await ingest.ingest(inbound());
    expect(res.persisted.text).toBe('How much is this truck?');
    expect(res.persisted.textTranslated).not.toBe(res.persisted.text);
  });

  it('幂等：同一通道消息重复推送不新增、不重复计未读', async () => {
    const { ingest, repo } = rig();
    const first = await ingest.ingest(inbound({ messageId: 'dup-1' }));
    const second = await ingest.ingest(inbound({ messageId: 'dup-1' }));

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(await repo.listMessages(first.persisted.conversationId)).toHaveLength(1);
    expect((await repo.getConversation(first.persisted.conversationId))?.unreadCount).toBe(1);
  });

  it('入站消息让未读数 +1，并推进 lastMessageAt', async () => {
    const { ingest, repo } = rig();
    const res = await ingest.ingest(inbound({ timestamp: 1_700_000_500_000 }));
    const conv = await repo.getConversation(res.persisted.conversationId);
    expect(conv?.unreadCount).toBe(1);
    expect(conv?.lastMessageAt).toBe(1_700_000_500_000);
  });

  it('1:1 会话自动挂上客户档案', async () => {
    const { ingest, repo } = rig();
    const res = await ingest.ingest(inbound());
    const conv = await repo.getConversation(res.persisted.conversationId);
    expect(conv?.contactId).toBeTruthy();
    expect((await repo.getContact(conv!.contactId!))?.waId).toBe(CUSTOMER);
  });

  it('群聊不挂客户档案，且保留 chatType=group', async () => {
    const { ingest, repo } = rig();
    const res = await ingest.ingest(
      inbound({
        chatType: 'group',
        chatId: '120363000000000000@g.us',
        senderId: CUSTOMER,
        authorId: CUSTOMER,
        text: 'Hello',
      }),
    );
    const conv = await repo.getConversation(res.persisted.conversationId);
    expect(conv?.chatType).toBe('group');
    expect(conv?.contactId).toBeNull();
  });

  it('origin=phone 不翻译，并显式记录「绕过翻译层」的原因', async () => {
    const { ingest } = rig();
    const res = await ingest.ingest(
      inbound({
        direction: 'outbound',
        origin: 'phone',
        senderId: CH,
        text: 'We will ship next week',
      }),
    );
    expect(res.persisted.origin).toBe('phone');
    expect(res.persisted.translationStatus).toBe('skipped');
    expect(res.persisted.textTranslated).toBeNull();
    expect(res.persisted.translationError).toContain('手机端');
  });

  it('出站消息不增加未读数', async () => {
    const { ingest, repo } = rig();
    const res = await ingest.ingest(
      inbound({ direction: 'outbound', origin: 'phone', senderId: CH, text: 'ok' }),
    );
    expect((await repo.getConversation(res.persisted.conversationId))?.unreadCount).toBe(0);
  });

  it('纯媒体消息（无文本）翻译状态为 skipped', async () => {
    const { ingest } = rig();
    const res = await ingest.ingest(
      inbound({
        text: null,
        media: [{ kind: 'image', mimeType: 'image/jpeg', providerRef: 'r-1' }],
      }),
    );
    expect(res.persisted.translationStatus).toBe('skipped');
    expect(res.persisted.media?.[0]?.kind).toBe('image');
  });

  it('start() 订阅通道后，真实事件会自动入库', async () => {
    const { ingest, adapter, repo } = rig();
    const off = ingest.start();
    adapter.receive(inbound({ messageId: 'live-1' }));

    await vi.waitFor(async () => {
      expect(await repo.listConversations()).toHaveLength(1);
    });
    const conv = (await repo.listConversations())[0];
    expect(await repo.listMessages(conv!.id)).toHaveLength(1);

    off();
    adapter.receive(inbound({ messageId: 'live-2' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(await repo.listMessages(conv!.id)).toHaveLength(1);
  });
});
