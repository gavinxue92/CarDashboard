import { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { IdGenerator } from '../domain/ids.js';
import { uuidIds } from '../domain/ids.js';
import type { MediaRef } from '../domain/types.js';
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  label         TEXT    NOT NULL,
  phone_number  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT    NOT NULL,
  wa_id       TEXT    NOT NULL,
  name        TEXT,
  country     TEXT,
  language    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (channel_id, wa_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id               TEXT PRIMARY KEY,
  channel_id       TEXT    NOT NULL,
  chat_id          TEXT    NOT NULL,
  chat_type        TEXT    NOT NULL,
  contact_id       TEXT,
  last_message_at  INTEGER,
  unread_count     INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  UNIQUE (channel_id, chat_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id                  TEXT PRIMARY KEY,
  conversation_id     TEXT    NOT NULL,
  channel_id          TEXT    NOT NULL,
  chat_id             TEXT    NOT NULL,
  message_id          TEXT    NOT NULL,
  direction           TEXT    NOT NULL,
  origin              TEXT    NOT NULL,
  sender_id           TEXT    NOT NULL,
  text                TEXT,
  text_translated     TEXT,
  detected_language   TEXT,
  target_language     TEXT,
  translation_status  TEXT    NOT NULL,
  translation_error   TEXT,
  media_json          TEXT,
  timestamp_ms        INTEGER NOT NULL,
  created_at          INTEGER NOT NULL,
  UNIQUE (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conv   ON messages (conversation_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (translation_status, created_at);
`;

type Row = Record<string, unknown>;

/**
 * SQLite 实现（基于 Node 内置 `node:sqlite`，零原生依赖）。
 *
 * 与 MemoryRepository 保持**完全相同**的语义 —— 由 `testing/contract.ts`
 * 的同一套用例分别跑两个实现来保证。
 */
export class SqliteRepository implements Repository {
  private readonly db: DatabaseSync;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: { path?: string; clock?: Clock; ids?: IdGenerator } = {}) {
    this.db = new DatabaseSync(options.path ?? ':memory:');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? uuidIds;
  }

  /* ---------- 账号 ---------- */

  async upsertChannel(input: UpsertChannelInput): Promise<ChannelRecord> {
    const now = this.clock.now();
    const existing = await this.getChannel(input.id);
    const rec: ChannelRecord = {
      id: input.id,
      label: pick(input.label, existing?.label ?? input.id),
      phoneNumber: pick(input.phoneNumber, existing?.phoneNumber ?? null),
      active: pick(input.active, existing?.active ?? true),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO channels (id, label, phone_number, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           phone_number = excluded.phone_number,
           active = excluded.active,
           updated_at = excluded.updated_at`,
      )
      .run(rec.id, rec.label, rec.phoneNumber, rec.active ? 1 : 0, rec.createdAt, rec.updatedAt);
    const saved = await this.getChannel(input.id);
    if (!saved) throw new Error(`账号写入后读回失败：${input.id}`);
    return saved;
  }

  async getChannel(id: string): Promise<ChannelRecord | null> {
    const row = this.db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToChannel(row) : null;
  }

  async listChannels(): Promise<ChannelRecord[]> {
    const rows = this.db.prepare('SELECT * FROM channels ORDER BY created_at').all() as Row[];
    return rows.map(rowToChannel);
  }

  /* ---------- 客户 ---------- */

  async upsertContact(input: UpsertContactInput): Promise<ContactRecord> {
    const now = this.clock.now();
    const existing = await this.findContactByWaId(input.channelId, input.waId);
    const rec: ContactRecord = {
      id: existing?.id ?? this.ids.next(),
      channelId: input.channelId,
      waId: input.waId,
      name: pick(input.name, existing?.name ?? null),
      country: pick(input.country, existing?.country ?? null),
      language: pick(input.language, existing?.language ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // 不更新 id：并发时后到的一次会变成对已存在行的 UPDATE，id 必须保持先到者
    this.db
      .prepare(
        `INSERT INTO contacts (id, channel_id, wa_id, name, country, language, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, wa_id) DO UPDATE SET
           name = excluded.name,
           country = excluded.country,
           language = excluded.language,
           updated_at = excluded.updated_at`,
      )
      .run(
        rec.id,
        rec.channelId,
        rec.waId,
        rec.name,
        rec.country,
        rec.language,
        rec.createdAt,
        rec.updatedAt,
      );
    const saved = await this.findContactByWaId(input.channelId, input.waId);
    if (!saved) throw new Error(`客户写入后读回失败：${input.channelId}/${input.waId}`);
    return saved;
  }

  async getContact(id: string): Promise<ContactRecord | null> {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToContact(row) : null;
  }

  async findContactByWaId(channelId: string, waId: string): Promise<ContactRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM contacts WHERE channel_id = ? AND wa_id = ?')
      .get(channelId, waId) as Row | undefined;
    return row ? rowToContact(row) : null;
  }

  /* ---------- 会话 ---------- */

  async ensureConversation(input: EnsureConversationInput): Promise<ConversationRecord> {
    const existing = await this.findConversationByChat(input.channelId, input.chatId);
    if (existing) {
      if (input.contactId && !existing.contactId) {
        this.db
          .prepare('UPDATE conversations SET contact_id = ? WHERE id = ?')
          .run(input.contactId, existing.id);
        existing.contactId = input.contactId;
      }
      return existing;
    }

    // ON CONFLICT DO NOTHING + 回读：并发的两条入站消息不会因唯一约束而失败
    this.db
      .prepare(
        `INSERT INTO conversations
           (id, channel_id, chat_id, chat_type, contact_id, last_message_at, unread_count, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
         ON CONFLICT(channel_id, chat_id) DO NOTHING`,
      )
      .run(
        this.ids.next(),
        input.channelId,
        input.chatId,
        input.chatType,
        input.contactId ?? null,
        this.clock.now(),
      );

    const saved = await this.findConversationByChat(input.channelId, input.chatId);
    if (!saved) throw new Error(`会话写入后读回失败：${input.channelId}/${input.chatId}`);
    if (input.contactId && !saved.contactId) {
      await this.db
        .prepare('UPDATE conversations SET contact_id = ? WHERE id = ?')
        .run(input.contactId, saved.id);
      saved.contactId = input.contactId;
    }
    return saved;
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? rowToConversation(row) : null;
  }

  async findConversationByChat(
    channelId: string,
    chatId: string,
  ): Promise<ConversationRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE channel_id = ? AND chat_id = ?')
      .get(channelId, chatId) as Row | undefined;
    return row ? rowToConversation(row) : null;
  }

  async listConversations(channelId?: string): Promise<ConversationRecord[]> {
    const rows = (
      channelId
        ? this.db.prepare('SELECT * FROM conversations WHERE channel_id = ?').all(channelId)
        : this.db.prepare('SELECT * FROM conversations').all()
    ) as Row[];
    return rows.map(rowToConversation);
  }

  async touchConversation(
    conversationId: string,
    at: number,
    incrementUnread: boolean,
  ): Promise<void> {
    const exists = await this.getConversation(conversationId);
    if (!exists) throw new Error(`会话不存在：${conversationId}`);
    // 单条 UPDATE 完成比较与累加：并发入站不会互相覆盖未读数
    this.db
      .prepare(
        `UPDATE conversations
            SET last_message_at = CASE
                  WHEN last_message_at IS NULL OR ? > last_message_at THEN ?
                  ELSE last_message_at END,
                unread_count = unread_count + ?
          WHERE id = ?`,
      )
      .run(at, at, incrementUnread ? 1 : 0, conversationId);
  }

  async markRead(conversationId: string): Promise<void> {
    const c = await this.getConversation(conversationId);
    if (!c) throw new Error(`会话不存在：${conversationId}`);
    this.db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId);
  }

  /* ---------- 消息 ---------- */

  async insertMessage(input: InsertMessageInput): Promise<InsertMessageResult> {
    const dup = await this.findMessageByProviderId(input.channelId, input.messageId);
    if (dup) return { message: dup, inserted: false };

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
    this.db
      .prepare(
        `INSERT INTO messages
           (id, conversation_id, channel_id, chat_id, message_id, direction, origin, sender_id,
            text, text_translated, detected_language, target_language, translation_status,
            translation_error, media_json, timestamp_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.conversationId,
        rec.channelId,
        rec.chatId,
        rec.messageId,
        rec.direction,
        rec.origin,
        rec.senderId,
        rec.text,
        rec.translationStatus,
        serializeMedia(rec.media),
        rec.timestamp,
        rec.createdAt,
      );
    return { message: rec, inserted: true };
  }

  async getMessageById(id: string): Promise<MessageRecord | null> {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToMessage(row) : null;
  }

  async findMessageByProviderId(
    channelId: string,
    messageId: string,
  ): Promise<MessageRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE channel_id = ? AND message_id = ?')
      .get(channelId, messageId) as Row | undefined;
    return row ? rowToMessage(row) : null;
  }

  async listMessages(
    conversationId: string,
    query: ListMessagesQuery = {},
  ): Promise<MessageRecord[]> {
    const limit = query.limit ?? 50;
    const rows = (
      query.before === undefined
        ? this.db
            .prepare(
              `SELECT * FROM messages WHERE conversation_id = ?
               ORDER BY timestamp_ms DESC, created_at DESC LIMIT ?`,
            )
            .all(conversationId, limit)
        : this.db
            .prepare(
              `SELECT * FROM messages WHERE conversation_id = ? AND timestamp_ms < ?
               ORDER BY timestamp_ms DESC, created_at DESC LIMIT ?`,
            )
            .all(conversationId, query.before, limit)
    ) as Row[];
    return rows.map(rowToMessage).reverse();
  }

  async applyTranslation(messageId: string, patch: TranslationPatch): Promise<MessageRecord> {
    const existing = await this.getMessageById(messageId);
    if (!existing) throw new Error(`消息不存在：${messageId}`);
    const detected =
      patch.detectedLanguage !== undefined ? patch.detectedLanguage : existing.detectedLanguage;
    const target =
      patch.targetLanguage !== undefined ? patch.targetLanguage : existing.targetLanguage;
    this.db
      .prepare(
        `UPDATE messages
            SET text_translated = ?, detected_language = ?, target_language = ?,
                translation_status = ?, translation_error = ?
          WHERE id = ?`,
      )
      .run(
        patch.textTranslated,
        detected,
        target,
        patch.status,
        patch.error ?? null,
        messageId,
      );
    const updated = await this.getMessageById(messageId);
    if (!updated) throw new Error(`消息不存在：${messageId}`);
    return updated;
  }

  async listMessagesByTranslationStatus(
    status: TranslationStatus,
    limit = 50,
  ): Promise<MessageRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE translation_status = ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(status, limit) as Row[];
    return rows.map(rowToMessage);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/* ---------- 行映射 ---------- */

function rowToChannel(r: Row): ChannelRecord {
  return {
    id: String(r['id']),
    label: String(r['label']),
    phoneNumber: (r['phone_number'] as string | null) ?? null,
    active: Number(r['active']) === 1,
    createdAt: Number(r['created_at']),
    updatedAt: Number(r['updated_at']),
  };
}

function rowToContact(r: Row): ContactRecord {
  return {
    id: String(r['id']),
    channelId: String(r['channel_id']),
    waId: String(r['wa_id']),
    name: (r['name'] as string | null) ?? null,
    country: (r['country'] as string | null) ?? null,
    language: (r['language'] as string | null) ?? null,
    createdAt: Number(r['created_at']),
    updatedAt: Number(r['updated_at']),
  };
}

function rowToConversation(r: Row): ConversationRecord {
  return {
    id: String(r['id']),
    channelId: String(r['channel_id']),
    chatId: String(r['chat_id']),
    chatType: r['chat_type'] as ConversationRecord['chatType'],
    contactId: (r['contact_id'] as string | null) ?? null,
    lastMessageAt: r['last_message_at'] === null ? null : Number(r['last_message_at']),
    unreadCount: Number(r['unread_count']),
    createdAt: Number(r['created_at']),
  };
}

function rowToMessage(r: Row): MessageRecord {
  return {
    id: String(r['id']),
    conversationId: String(r['conversation_id']),
    channelId: String(r['channel_id']),
    chatId: String(r['chat_id']),
    messageId: String(r['message_id']),
    direction: r['direction'] as MessageRecord['direction'],
    origin: r['origin'] as MessageRecord['origin'],
    senderId: String(r['sender_id']),
    text: (r['text'] as string | null) ?? null,
    textTranslated: (r['text_translated'] as string | null) ?? null,
    detectedLanguage: (r['detected_language'] as string | null) ?? null,
    targetLanguage: (r['target_language'] as string | null) ?? null,
    translationStatus: r['translation_status'] as MessageRecord['translationStatus'],
    translationError: (r['translation_error'] as string | null) ?? null,
    media: deserializeMedia(r['media_json']),
    timestamp: Number(r['timestamp_ms']),
    createdAt: Number(r['created_at']),
  };
}

function serializeMedia(media: MediaRef[] | null): string | null {
  return media && media.length > 0 ? JSON.stringify(media) : null;
}

function deserializeMedia(raw: unknown): MediaRef[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return JSON.parse(raw) as MediaRef[];
}

/**
 * 补丁语义：`undefined` = 不修改，`null` = 清空。
 * 二者必须区分 —— 否则「把客户语言清掉」这件事永远做不到。
 */
function pick<T>(incoming: T | undefined, fallback: T): T {
  return incoming === undefined ? fallback : incoming;
}
