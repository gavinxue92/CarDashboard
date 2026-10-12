import type { ChatType, Direction, MediaRef, MessageOrigin } from '../domain/types.js';

/* ------------------------------------------------------------------ *
 * 实体
 *
 * ⚠️ 这是「最贵的一层」：一旦有真实数据落库，改字段就要做迁移。
 * 因此这里只放**已经确定要长期存在**的字段，并且把后续模块需要的
 * 字段位置**现在就留出来**（目的国 / 语言 / 结构化抽取 / 译文）。
 * ------------------------------------------------------------------ */

/** 一个 WhatsApp 账号（一个业务员一个号） */
export interface ChannelRecord {
  id: string;
  /** 展示名，如「张伟 · 尼日利亚线」 */
  label: string;
  phoneNumber: string | null;
  /** 是否启用（停用但不删数据） */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 一个客户。字段刻意留全，供后续「获客」模块聚合。 */
export interface ContactRecord {
  id: string;
  channelId: string;
  /** WhatsApp 侧标识（JID） */
  waId: string;
  name: string | null;
  /** 预留：目的国。业务模块成本精算的输入之一 */
  country: string | null;
  /** 客户语言 —— **翻译层从这里读，不写死在代码里** */
  language: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 一个会话（1:1 或群组） */
export interface ConversationRecord {
  id: string;
  channelId: string;
  chatId: string;
  chatType: ChatType;
  /** 群组会话可能没有对应「客户」 */
  contactId: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  createdAt: number;
}

export type TranslationStatus = 'pending' | 'done' | 'skipped' | 'failed';

/**
 * 一条消息。**原文与译文分列存储，永不合并。**
 * 只存译文的话，客户投诉「你当时不是这么说的」时无从追溯。
 */
export interface MessageRecord {
  /** 内部 ID（幂等去重后的稳定主键） */
  id: string;
  conversationId: string;
  channelId: string;
  chatId: string;
  /** 通道侧消息 ID，与 channelId 组成幂等键 */
  messageId: string;
  direction: Direction;
  origin: MessageOrigin;
  senderId: string;
  /** 原文，永不丢弃 */
  text: string | null;
  textTranslated: string | null;
  detectedLanguage: string | null;
  targetLanguage: string | null;
  translationStatus: TranslationStatus;
  translationError: string | null;
  media: MediaRef[] | null;
  /** 通道侧时间 */
  timestamp: number;
  createdAt: number;
}

/* ------------------------------------------------------------------ *
 * 输入类型
 * ------------------------------------------------------------------ */

export interface UpsertChannelInput {
  id: string;
  label?: string;
  phoneNumber?: string | null;
  active?: boolean;
}

export interface UpsertContactInput {
  channelId: string;
  waId: string;
  name?: string | null;
  country?: string | null;
  language?: string | null;
}

export interface EnsureConversationInput {
  channelId: string;
  chatId: string;
  chatType: ChatType;
  contactId?: string | null;
}

export interface InsertMessageInput {
  conversationId: string;
  channelId: string;
  chatId: string;
  messageId: string;
  direction: Direction;
  origin: MessageOrigin;
  senderId: string;
  text: string | null;
  media?: MediaRef[] | null;
  timestamp: number;
}

export interface TranslationPatch {
  textTranslated: string | null;
  detectedLanguage?: string | null;
  targetLanguage?: string | null;
  status: TranslationStatus;
  error?: string | null;
}

export interface InsertMessageResult {
  message: MessageRecord;
  /** false 表示这条通道消息此前已落库（重复推送被幂等挡下） */
  inserted: boolean;
}

export interface ListMessagesQuery {
  limit?: number;
  /** 只取 timestamp < before 的消息（翻页） */
  before?: number;
}

/* ------------------------------------------------------------------ *
 * Repository
 * ------------------------------------------------------------------ */

/**
 * 存储接口。业务层只依赖它，不依赖具体数据库。
 * 因此「JSON 文件 → SQLite → Postgres」是替换实现，不是重写业务。
 */
export interface Repository {
  /* 账号 */
  upsertChannel(input: UpsertChannelInput): Promise<ChannelRecord>;
  getChannel(id: string): Promise<ChannelRecord | null>;
  listChannels(): Promise<ChannelRecord[]>;

  /* 客户 */
  upsertContact(input: UpsertContactInput): Promise<ContactRecord>;
  getContact(id: string): Promise<ContactRecord | null>;
  findContactByWaId(channelId: string, waId: string): Promise<ContactRecord | null>;

  /* 会话 */
  ensureConversation(input: EnsureConversationInput): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  findConversationByChat(channelId: string, chatId: string): Promise<ConversationRecord | null>;
  listConversations(channelId?: string): Promise<ConversationRecord[]>;
  /** 记录新消息：更新 lastMessageAt；incrementUnread 为真时未读数 +1 */
  touchConversation(conversationId: string, at: number, incrementUnread: boolean): Promise<void>;
  markRead(conversationId: string): Promise<void>;

  /* 消息 */
  /** **幂等**：同一 (channelId, messageId) 只会插入一次 */
  insertMessage(input: InsertMessageInput): Promise<InsertMessageResult>;
  getMessageById(id: string): Promise<MessageRecord | null>;
  findMessageByProviderId(channelId: string, messageId: string): Promise<MessageRecord | null>;
  listMessages(conversationId: string, query?: ListMessagesQuery): Promise<MessageRecord[]>;
  /** 翻译回填。**失败时只写译文相关字段，绝不动原文。** */
  applyTranslation(messageId: string, patch: TranslationPatch): Promise<MessageRecord>;
  /** 待翻译的消息（异步翻译的取件口） */
  listMessagesByTranslationStatus(status: TranslationStatus, limit?: number): Promise<MessageRecord[]>;

  /** 供测试与迁移使用 */
  close(): Promise<void>;
}
