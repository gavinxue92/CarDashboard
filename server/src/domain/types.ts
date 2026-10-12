/**
 * 领域模型：消息的规范化形状。
 *
 * 这是整个系统里「最贵的一层」——一旦有真实数据落库，改这里的字段就要做数据迁移。
 * 因此本文件只定义形状与不变量，不含任何通道 / 存储 / 翻译的实现细节。
 */

/** 会话类型。群组在非官方路线下可得；官方 Cloud API 收不到群组消息。 */
export type ChatType = 'direct' | 'group';

export type Direction = 'inbound' | 'outbound';

/**
 * 消息来源。**这个字段必须从第一天就有。**
 *
 * - `system` —— 由本系统发出（经过翻译层）
 * - `phone`  —— 业务员在手机 WhatsApp App 上直接打出（**不经过翻译层**）
 *
 * 已知缺口：手机端手打的消息无法在发送前拦截翻译。此字段使其可观测、可统计，
 * 而不是被静默地混进「正常消息」里。
 */
export type MessageOrigin = 'system' | 'phone';

export type MediaKind = 'image' | 'document' | 'audio' | 'video' | 'sticker' | 'other';

/** 媒体引用。只存引用，不把二进制内联进消息记录。 */
export interface MediaRef {
  kind: MediaKind;
  mimeType: string;
  /** 通道侧标识，供 fetchMedia 使用 */
  providerRef: string;
  fileName?: string;
  sizeBytes?: number;
  /** 抓取失败时保留原因，不让整条消息失败 */
  unavailableReason?: string;
}

/**
 * 规范化消息 —— 无论底层是 Baileys / whatsapp-web.js / Cloud API，
 * 业务层只认这个形状。
 */
export interface NormalizedMessage {
  /** 哪个账号收到的（一个业务员一个号） */
  channelId: string;
  /** WhatsApp 会话标识（JID）；1:1 与群组共用此字段，靠 chatType 区分 */
  chatId: string;
  chatType: ChatType;
  /** 通道侧消息 ID，幂等的依据 */
  messageId: string;
  direction: Direction;
  origin: MessageOrigin;
  senderId: string;
  /** 原文。**永不丢弃**，可为 null（纯媒体消息） */
  text: string | null;
  media: MediaRef[] | null;
  /** 毫秒时间戳 */
  timestamp: number;
  replyToMessageId?: string;
  /** 群组消息才有：实际发言者，与 senderId 不同 */
  authorId?: string;
}

/** 判定是否为群组消息（不变量：chatType 与 chatId 后缀必须一致） */
export function isGroupChat(msg: Pick<NormalizedMessage, 'chatType'>): boolean {
  return msg.chatType === 'group';
}

/**
 * 翻译状态。属于领域概念，定义在此以便存储层与翻译层共用而互不依赖。
 *
 * - `pending` —— 有原文，等待翻译
 * - `done`    —— 已产出译文
 * - `skipped` —— 判定无需翻译（无文本 / 同语言 / 未指定目标语言）
 * - `failed`  —— 翻译失败。**原文仍在，消息不丢**
 */
export type TranslationStatus = 'pending' | 'done' | 'skipped' | 'failed';
