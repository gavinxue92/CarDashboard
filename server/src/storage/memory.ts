import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { IdGenerator } from '../domain/ids.js';
import { uuidIds } from '../domain/ids.js';
import type {
  ChannelRecord,
  ContactRecord,
  ConversationRecord,
  EnsureConversationInput,
  InsertMessageInput,
  InsertMessageResult,
  ListMessagesQuery,
  MessageRecord,
  Repository,
  TranslationPatch,
  TranslationStatus,
  UpsertChannelInput,
  UpsertContactInput,
} from './repository.js';

/** 内存实现：用于测试与开发。语义必须与 SQLite 实现完全一致（由共享契约测试保证）。 */
export class MemoryRepository implements Repository {
  private readonly channels = new Map<string, ChannelRecord>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly ids: IdGenerator = uuidIds,
  ) {}

  async upsertChannel(input: UpsertChannelInput): Promise<ChannelRecord> {
    const now = this.clock.now();
    const existing = this.channels.get(input.id);
    const rec: ChannelRecord = {
      id: input.id,
      label: pick(input.label, existing?.label ?? input.id),
      phoneNumber: pick(input.phoneNumber, existing?.phoneNumber ?? null),
      active: pick(input.active, existing?.active ?? true),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.channels.set(rec.id, rec);
    return { ...rec };
  }

  async getChannel(id: string): Promise<ChannelRecord | null> {
    const r = this.channels.get(id);
    return r ? { ...r } : null;
  }

  async listChannels(): Promise<ChannelRecord[]> {
    return [...this.channels.values()].map((r) => ({ ...r }));
  }

  async upsertContact(input: UpsertContactInput): Promise<ContactRecord> {
    const now = this.clock.now();
    // 注意：这里**不能有 await** —— 检查与写入之间一旦让出执行权，
    // 并发调用就会各自看到「不存在」而重复创建。同步完成才是原子的。
    const existing = this.findContactSync(input.channelId, input.waId);
    const rec: ContactRecord = existing
      ? {
          ...existing,
          name: pick(input.name, existing.name),
          country: pick(input.country, existing.country),
          language: pick(input.language, existing.language),
          updatedAt: now,
        }
      : {
          id: this.ids.next(),
          channelId: input.channelId,
          waId: input.waId,
          name: input.name ?? null,
          country: input.country ?? null,
          language: input.language ?? null,
          createdAt: now,
          updatedAt: now,
        };
    this.contacts.set(rec.id, rec);
    return { ...rec };
  }

  async getContact(id: string): Promise<ContactRecord | null> {
    const r = this.contacts.get(id);
    return r ? { ...r } : null;
  }

  async findContactByWaId(channelId: string, waId: string): Promise<ContactRecord | null> {
    const c = this.findContactSync(channelId, waId);
    return c ? { ...c } : null;
  }

  async ensureConversation(input: EnsureConversationInput): Promise<ConversationRecord> {
    // 同上：同步完成「查 + 建」，否则并发时会产生重复会话
    const existing = this.findConversationSync(input.channelId, input.chatId);
    if (existing) {
      if (input.contactId && !existing.contactId) {
        existing.contactId = input.contactId;
      }
      return { ...existing };
    }
    const rec: ConversationRecord = {
      id: this.ids.next(),
      channelId: input.channelId,
      chatId: input.chatId,
      chatType: input.chatType,
      contactId: input.contactId ?? null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: this.clock.now(),
    };
    this.conversations.set(rec.id, rec);
    return { ...rec };
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const r = this.conversations.get(id);
    return r ? { ...r } : null;
  }

  async findConversationByChat(
    channelId: string,
    chatId: string,
  ): Promise<ConversationRecord | null> {
    const c = this.findConversationSync(channelId, chatId);
    return c ? { ...c } : null;
  }

  async listConversations(channelId?: string): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((c) => (channelId ? c.channelId === channelId : true))
      .map((c) => ({ ...c }));
  }

  async touchConversation(
    conversationId: string,
    at: number,
    incrementUnread: boolean,
  ): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (!c) throw new Error(`会话不存在：${conversationId}`);
    if (c.lastMessageAt === null || at > c.lastMessageAt) c.lastMessageAt = at;
    if (incrementUnread) c.unreadCount += 1;
  }

  async markRead(conversationId: string): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (!c) throw new Error(`会话不存在：${conversationId}`);
    c.unreadCount = 0;
  }

  async insertMessage(input: InsertMessageInput): Promise<InsertMessageResult> {
    const dup = await this.findMessageByProviderId(input.channelId, input.messageId);
    if (dup) return { message: { ...dup }, inserted: false };

    const rec: MessageRecord = {
      id: this.ids.next(),
      conversationId: input.conversationId,
      channelId: input.channelId,
      chatId: input.chatId,
      messageId: input.messageId,
      direction: input.direction,
      origin: input.origin,
      senderId: input.senderId,
      text: input.text,
      textTranslated: null,
      detectedLanguage: null,
      targetLanguage: null,
      translationStatus: input.text ? 'pending' : 'skipped',
      translationError: null,
      media: input.media ?? null,
      timestamp: input.timestamp,
      createdAt: this.clock.now(),
    };
    this.messages.set(rec.id, rec);
    return { message: { ...rec }, inserted: true };
  }

  async getMessageById(id: string): Promise<MessageRecord | null> {
    const r = this.messages.get(id);
    return r ? clone(r) : null;
  }

  async findMessageByProviderId(
    channelId: string,
    messageId: string,
  ): Promise<MessageRecord | null> {
    for (const m of this.messages.values()) {
      if (m.channelId === channelId && m.messageId === messageId) return clone(m);
    }
    return null;
  }

  async listMessages(conversationId: string, query: ListMessagesQuery = {}): Promise<MessageRecord[]> {
    const limit = query.limit ?? 50;
    const all = [...this.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .filter((m) => (query.before === undefined ? true : m.timestamp < query.before))
      .sort((a, b) => a.timestamp - b.timestamp || a.createdAt - b.createdAt);
    return all.slice(Math.max(0, all.length - limit)).map(clone);
  }

  async applyTranslation(messageId: string, patch: TranslationPatch): Promise<MessageRecord> {
    const m = this.messages.get(messageId);
    if (!m) throw new Error(`消息不存在：${messageId}`);
    m.textTranslated = patch.textTranslated;
    if (patch.detectedLanguage !== undefined) m.detectedLanguage = patch.detectedLanguage;
    if (patch.targetLanguage !== undefined) m.targetLanguage = patch.targetLanguage;
    m.translationStatus = patch.status;
    m.translationError = patch.error ?? null;
    return clone(m);
  }

  async listMessagesByTranslationStatus(
    status: TranslationStatus,
    limit = 50,
  ): Promise<MessageRecord[]> {
    return [...this.messages.values()]
      .filter((m) => m.translationStatus === status)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map(clone);
  }

  async close(): Promise<void> {
    this.channels.clear();
    this.contacts.clear();
    this.conversations.clear();
    this.messages.clear();
  }

  /* ---------- 内部：同步查找（供上面无 await 的原子操作使用） ---------- */

  private findContactSync(channelId: string, waId: string): ContactRecord | undefined {
    for (const c of this.contacts.values()) {
      if (c.channelId === channelId && c.waId === waId) return c;
    }
    return undefined;
  }

  private findConversationSync(channelId: string, chatId: string): ConversationRecord | undefined {
    for (const c of this.conversations.values()) {
      if (c.channelId === channelId && c.chatId === chatId) return c;
    }
    return undefined;
  }
}

/**
 * 补丁语义：`undefined` = 不修改，`null` = 清空。
 * 二者必须区分 —— 否则「把客户语言清掉」这件事永远做不到。
 */
function pick<T>(incoming: T | undefined, fallback: T): T {
  return incoming === undefined ? fallback : incoming;
}

function clone(m: MessageRecord): MessageRecord {
  return { ...m, media: m.media ? m.media.map((x) => ({ ...x })) : null };
}
