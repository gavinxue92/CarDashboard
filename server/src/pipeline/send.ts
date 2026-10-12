import type { ChannelAdapter } from '../channel/adapter.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { TranslationStatus } from '../domain/types.js';
import type { MessageRecord, Repository } from '../storage/repository.js';
import type { LanguageCode } from '../translation/translator.js';
import type { OutboundTranslator, TranslationOutcome } from '../translation/service.js';

/** 出站草稿：翻译已经算好，但**还没有发出去**。 */
export interface OutboundDraft {
  conversationId: string;
  channelId: string;
  chatId: string;
  /** 业务员写的原文（中文） */
  sourceText: string;
  /** 译文；未产出时为 null */
  translatedText: string | null;
  targetLanguage: LanguageCode | null;
  status: TranslationStatus;
  reason: string | null;
}

/**
 * 出站被拦下。
 *
 * ⚠️ **消息发出去不可撤回**，所以「没有可发文本」时宁可失败也不静默直发：
 * 把中文原样发给海外客户，比报错严重得多。
 */
export class SendBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendBlockedError';
  }
}

/**
 * 出站管道：业务员中文 → 翻译 → **先落库** → 经通道发出。
 *
 * 刻意拆成 `draft()` 与 `send()` 两步，对应产品上「**先看译文再发**」的要求。
 */
export class SendService {
  constructor(
    private readonly repo: Repository,
    private readonly channel: ChannelAdapter,
    private readonly outbound: OutboundTranslator,
    private readonly clock: Clock = systemClock,
  ) {}

  /** 第一步：算出译文给业务员过目，不发送。 */
  async draft(conversationId: string, sourceText: string): Promise<OutboundDraft> {
    const conversation = await this.repo.getConversation(conversationId);
    if (!conversation) throw new Error(`会话不存在：${conversationId}`);

    const contact = conversation.contactId
      ? await this.repo.getContact(conversation.contactId)
      : null;

    const outcome: TranslationOutcome = await this.outbound.translate(
      sourceText,
      contact?.language ?? null,
    );

    return {
      conversationId,
      channelId: conversation.channelId,
      chatId: conversation.chatId,
      sourceText,
      translatedText: outcome.translatedText,
      targetLanguage: outcome.targetLanguage,
      status: outcome.status,
      reason: outcome.reason,
    };
  }

  /**
   * 第二步：发送。
   *
   * @param finalText 业务员手动修改后的最终文本；提供时以它为准（覆盖机器译文）
   */
  async send(draft: OutboundDraft, finalText?: string): Promise<MessageRecord> {
    const text = (finalText ?? draft.translatedText ?? '').trim();
    if (text.length === 0) {
      throw new SendBlockedError(
        `没有可发送的文本（翻译状态：${draft.status}${draft.reason ? ` · ${draft.reason}` : ''}）。` +
          '请先修正译文，或手动填写最终文本。',
      );
    }

    // 先发。发送失败就直接抛 —— 绝不留下一条「以为发出去了」的出站记录。
    const sent = await this.channel.sendText(draft.channelId, draft.chatId, text);

    const { message } = await this.repo.insertMessage({
      conversationId: draft.conversationId,
      channelId: draft.channelId,
      chatId: draft.chatId,
      messageId: sent.messageId,
      direction: 'outbound',
      origin: 'system',
      senderId: draft.channelId,
      text: draft.sourceText,
      media: null,
      timestamp: sent.timestamp,
    });

    await this.repo.touchConversation(draft.conversationId, sent.timestamp, false);

    return this.repo.applyTranslation(message.id, {
      textTranslated: text,
      targetLanguage: draft.targetLanguage,
      status: 'done',
      // 保留当时的翻译状态备注，使「这条其实是业务员手改的 / 当时翻译失败过」可追溯
      error: draft.status === 'done' ? null : draft.reason,
    });
  }

  /** 便捷方法：草稿 + 直接发送（界面上一键发出的路径） */
  async sendDirect(conversationId: string, sourceText: string): Promise<MessageRecord> {
    const draft = await this.draft(conversationId, sourceText);
    return this.send(draft);
  }
}
