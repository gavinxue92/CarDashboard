import { describe, expect, it } from 'vitest';
import type { InsertMessageInput, Repository, TranslationStatus } from '../repository.js';

/**
 * `Repository` 契约测试。
 *
 * 所有实现（Memory / SQLite / 将来的 Postgres）都必须通过同一套用例。
 * 这是「换数据库 = 换实现」而不是「重写业务」的前提。
 */
export function defineRepositoryContract(
  name: string,
  createRepo: () => Promise<Repository> | Repository,
): void {
  describe(`Repository 契约 · ${name}`, () => {
    async function fresh(): Promise<Repository> {
      return await createRepo();
    }

    async function seedConversation(repo: Repository, channelId = 'ch-1', chatId = 'chat-A') {
      await repo.upsertChannel({ id: channelId });
      const conv = await repo.ensureConversation({ channelId, chatId, chatType: 'direct' });
      return conv;
    }

    function msgInput(over: Partial<InsertMessageInput> = {}): InsertMessageInput {
      return {
        conversationId: 'conv-x',
        channelId: 'ch-1',
        chatId: 'chat-A',
        messageId: 'm-1',
        direction: 'inbound',
        origin: 'system',
        senderId: 'wa-1',
        text: 'hello',
        timestamp: 1_700_000_000_000,
        ...over,
      };
    }

    /* ---------- 账号 ---------- */

    it('账号：upsert 后可读，重复 upsert 保留 createdAt', async () => {
      const repo = await fresh();
      const a = await repo.upsertChannel({ id: 'ch-1', label: '张伟' });
      const b = await repo.upsertChannel({ id: 'ch-1', label: '张伟 · 尼日利亚线' });
      expect(b.createdAt).toBe(a.createdAt);
      expect(b.label).toBe('张伟 · 尼日利亚线');
      expect((await repo.listChannels())).toHaveLength(1);
      expect(await repo.getChannel('missing')).toBeNull();
    });

    /* ---------- 客户 ---------- */

    it('客户：按 (channelId, waId) 唯一，再 upsert 只更新不新增', async () => {
      const repo = await fresh();
      const c1 = await repo.upsertContact({ channelId: 'ch-1', waId: 'wa-1', name: 'Ali' });
      const c2 = await repo.upsertContact({
        channelId: 'ch-1',
        waId: 'wa-1',
        country: 'NG',
        language: 'en',
      });
      expect(c2.id).toBe(c1.id);
      expect(c2.name).toBe('Ali');
      expect(c2.country).toBe('NG');
      expect(c2.language).toBe('en');

      const other = await repo.upsertContact({ channelId: 'ch-2', waId: 'wa-1' });
      expect(other.id).not.toBe(c1.id);
    });

    it('客户：undefined 保持原值，null 清空（补丁语义）', async () => {
      const repo = await fresh();
      await repo.upsertContact({ channelId: 'ch-1', waId: 'wa-1', name: 'Ali', country: 'NG', language: 'en' });
      const keep = await repo.upsertContact({ channelId: 'ch-1', waId: 'wa-1' });
      expect([keep.name, keep.country, keep.language]).toEqual(['Ali', 'NG', 'en']);

      const cleared = await repo.upsertContact({ channelId: 'ch-1', waId: 'wa-1', language: null });
      expect(cleared.language).toBeNull();
      expect(cleared.name).toBe('Ali');
    });

    it('客户：并发 upsert 不会重复创建', async () => {
      const repo = await fresh();
      const ids = await Promise.all(
        Array.from({ length: 8 }, () => repo.upsertContact({ channelId: 'ch-1', waId: 'wa-race' })),
      );
      expect(new Set(ids.map((c) => c.id)).size).toBe(1);
    });

    /* ---------- 会话 ---------- */

    it('会话：同 (channelId, chatId) 幂等返回同一 id', async () => {
      const repo = await fresh();
      const a = await seedConversation(repo);
      const b = await repo.ensureConversation({
        channelId: 'ch-1',
        chatId: 'chat-A',
        chatType: 'direct',
      });
      expect(b.id).toBe(a.id);
    });

    it('会话：可补挂 contactId', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      expect(conv.contactId).toBeNull();
      const c = await repo.upsertContact({ channelId: 'ch-1', waId: 'wa-1' });
      const again = await repo.ensureConversation({
        channelId: 'ch-1',
        chatId: 'chat-A',
        chatType: 'direct',
        contactId: c.id,
      });
      expect(again.contactId).toBe(c.id);
    });

    it('会话：touchConversation 推进 lastMessageAt 与未读数，markRead 清零', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      await repo.touchConversation(conv.id, 1000, true);
      await repo.touchConversation(conv.id, 2000, true);
      await repo.touchConversation(conv.id, 1500, false);
      const mid = await repo.getConversation(conv.id);
      expect(mid?.lastMessageAt).toBe(2000);
      expect(mid?.unreadCount).toBe(2);
      await repo.markRead(conv.id);
      expect((await repo.getConversation(conv.id))?.unreadCount).toBe(0);
    });

    it('会话：并发 ensureConversation 只创建一个（真实 webhook 会并发到达）', async () => {
      const repo = await fresh();
      await repo.upsertChannel({ id: 'ch-1' });
      const convs = await Promise.all(
        Array.from({ length: 8 }, () =>
          repo.ensureConversation({ channelId: 'ch-1', chatId: 'chat-race', chatType: 'direct' }),
        ),
      );
      expect(new Set(convs.map((c) => c.id)).size).toBe(1);
      expect(await repo.listConversations('ch-1')).toHaveLength(1);
    });

    it('会话：并发 touchConversation 不丢未读计数', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => repo.touchConversation(conv.id, 1000 + i, true)),
      );
      const after = await repo.getConversation(conv.id);
      expect(after?.unreadCount).toBe(10);
      expect(after?.lastMessageAt).toBe(1009);
    });

    it('会话：按账号过滤', async () => {
      const repo = await fresh();
      await seedConversation(repo, 'ch-1', 'chat-A');
      await seedConversation(repo, 'ch-2', 'chat-A');
      expect(await repo.listConversations('ch-1')).toHaveLength(1);
      expect(await repo.listConversations()).toHaveLength(2);
    });

    /* ---------- 消息 ---------- */

    it('消息：首次插入 inserted=true，重复 (channelId, messageId) 被幂等挡下', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const first = await repo.insertMessage(msgInput({ conversationId: conv.id }));
      expect(first.inserted).toBe(true);
      const second = await repo.insertMessage(msgInput({ conversationId: conv.id }));
      expect(second.inserted).toBe(false);
      expect(second.message.id).toBe(first.message.id);
      expect(await repo.listMessages(conv.id)).toHaveLength(1);
    });

    it('消息：幂等键是 (channelId, messageId)，不同账号互不影响', async () => {
      const repo = await fresh();
      const conv1 = await seedConversation(repo, 'ch-1', 'chat-A');
      const conv2 = await seedConversation(repo, 'ch-2', 'chat-A');
      const a = await repo.insertMessage(msgInput({ conversationId: conv1.id, channelId: 'ch-1' }));
      const b = await repo.insertMessage(msgInput({ conversationId: conv2.id, channelId: 'ch-2' }));
      expect(a.inserted).toBe(true);
      expect(b.inserted).toBe(true);
    });

    it('消息：无文本时翻译状态直接为 skipped', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const r = await repo.insertMessage(msgInput({ conversationId: conv.id, text: null }));
      expect(r.message.text).toBeNull();
      expect(r.message.translationStatus).toBe('skipped');
    });

    it('消息：有文本时初始翻译状态为 pending', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const r = await repo.insertMessage(msgInput({ conversationId: conv.id }));
      expect(r.message.translationStatus).toBe('pending');
      expect(r.message.textTranslated).toBeNull();
    });

    it('消息：listMessages 按时间升序，limit 取最近 N 条，before 可翻页', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      for (let i = 1; i <= 5; i++) {
        await repo.insertMessage(
          msgInput({ conversationId: conv.id, messageId: `m-${i}`, timestamp: 1000 + i }),
        );
      }
      const recent3 = await repo.listMessages(conv.id, { limit: 3 });
      expect(recent3.map((m) => m.messageId)).toEqual(['m-3', 'm-4', 'm-5']);

      const older = await repo.listMessages(conv.id, { limit: 10, before: 1004 });
      expect(older.map((m) => m.messageId)).toEqual(['m-1', 'm-2', 'm-3']);
    });

    it('消息：media 可往返序列化', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      await repo.insertMessage(
        msgInput({
          conversationId: conv.id,
          text: null,
          media: [{ kind: 'document', mimeType: 'application/pdf', providerRef: 'ref-1', fileName: 'PI.pdf' }],
        }),
      );
      const got = (await repo.listMessages(conv.id))[0];
      expect(got?.media?.[0]?.fileName).toBe('PI.pdf');
      expect(got?.media?.[0]?.kind).toBe('document');
    });

    /* ---------- 翻译回填 ---------- */

    it('翻译：回填只改译文相关列，原文一字不动', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const { message } = await repo.insertMessage(msgInput({ conversationId: conv.id, text: 'Hi, price?' }));
      const updated = await repo.applyTranslation(message.id, {
        textTranslated: '你好，价格多少？',
        detectedLanguage: 'en',
        targetLanguage: 'zh',
        status: 'done',
      });
      expect(updated.text).toBe('Hi, price?');
      expect(updated.textTranslated).toBe('你好，价格多少？');
      expect(updated.translationStatus).toBe('done');
    });

    it('翻译：失败时记录原因，但原文仍在', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const { message } = await repo.insertMessage(msgInput({ conversationId: conv.id }));
      const updated = await repo.applyTranslation(message.id, {
        textTranslated: null,
        status: 'failed',
        error: 'upstream 503',
      });
      expect(updated.translationStatus).toBe('failed');
      expect(updated.translationError).toBe('upstream 503');
      expect(updated.text).toBe('hello');
    });

    it('翻译：applyTranslation 对不存在的消息抛错', async () => {
      const repo = await fresh();
      await expect(
        repo.applyTranslation('nope', { textTranslated: null, status: 'failed' as TranslationStatus }),
      ).rejects.toThrow();
    });

    it('翻译：可按状态取待翻译消息', async () => {
      const repo = await fresh();
      const conv = await seedConversation(repo);
      const a = await repo.insertMessage(msgInput({ conversationId: conv.id, messageId: 'm-1' }));
      await repo.insertMessage(msgInput({ conversationId: conv.id, messageId: 'm-2', text: null }));
      const pending = await repo.listMessagesByTranslationStatus('pending');
      expect(pending.map((m) => m.messageId)).toEqual(['m-1']);
      await repo.applyTranslation(a.message.id, {
        textTranslated: '你好',
        status: 'done',
      });
      expect(await repo.listMessagesByTranslationStatus('pending')).toHaveLength(0);
    });
  });
}
