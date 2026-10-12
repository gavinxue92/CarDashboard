import type { ChannelAdapter } from '../channel/adapter.js';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import type { NormalizedMessage } from '../domain/types.js';
import type { MessageRecord, Repository } from '../storage/repository.js';
import type { InboundTranslator, TranslationOutcome } from '../translation/service.js';
import { skippedOutcome } from '../translation/service.js';

export interface IngestResult {
  /** 落库后的消息（含译文，若本次翻译成功） */
  persisted: MessageRecord;
  /** false 表示该通道消息此前已落库，本次被幂等挡下 */
  inserted: boolean;
  /** 本次的翻译结果；被幂等挡下时为 null */
  translation: TranslationOutcome | null;
}

/**
 * 入站管道：客户消息 → 客户/会话 → 消息落库 → 翻译。
 *
 * 顺序是刻意的：**先把原文落库，再去调翻译**。
 * 反过来的话，翻译服务一抖，这条消息就永远丢了。
 */
export class IngestService {
  constructor(
    private readonly repo: Repository,
    private readonly channel: ChannelAdapter,
    private readonly inbound: InboundTranslator,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * 订阅通道的入站事件。
   * 返回取消订阅函数。处理器内部已兜底 catch —— 单条消息处理失败不会拖垮订阅。
   */
  start(): () => void {
    return this.channel.onMessage((msg) => {
      void this.ingest(msg).catch((err: unknown) => {
        console.error('[ingest] 处理入站消息失败', msg.messageId, err);
      });
    });
  }

  async ingest(msg: NormalizedMessage): Promise<IngestResult> {
    const contactId = await this.resolveContactId(msg);

    const conversation = await this.repo.ensureConversation({
      channelId: msg.channelId,
      chatId: msg.chatId,
      chatType: msg.chatType,
      contactId,
    });

    const { message, inserted } = await this.repo.insertMessage({
      conversationId: conversation.id,
      channelId: msg.channelId,
      chatId: msg.chatId,
      messageId: msg.messageId,
      direction: msg.direction,
      origin: msg.origin,
      senderId: msg.senderId,
      text: msg.text,
      media: msg.media,
      timestamp: msg.timestamp,
    });

    // 幂等：重复推送到此为止，不重复计未读、不重复翻译
    if (!inserted) return { persisted: message, inserted: false, translation: null };

    await this.repo.touchConversation(conversation.id, msg.timestamp, msg.direction === 'inbound');

    const outcome = await this.translateIfNeeded(message);
    const persisted = outcome ? await this.applyOutcome(message.id, outcome) : message;
    return { persisted, inserted: true, translation: outcome };
  }

  private async resolveContactId(msg: NormalizedMessage): Promise<string | null> {
    // 群组没有单一「客户」；群成员身份记在消息的 authorId 上
    if (msg.chatType === 'group') return null;
    const waId = msg.direction === 'inbound' ? msg.senderId : msg.chatId;
    const contact = await this.repo.upsertContact({ channelId: msg.channelId, waId });
    return contact.id;
  }

  private async translateIfNeeded(message: MessageRecord): Promise<TranslationOutcome | null> {
    // ⚠️ origin=phone 一定是出站消息，必须先于下面的出站判断 —— 否则会漏掉标记，
    // 让「绕过翻译层」这条缺口在数据里悄无声息地变成 pending。
    if (message.origin === 'phone') {
      // 业务员在手机 App 上直接发出 —— 消息已经离开系统，翻译层无从介入。
      // 这里不做「事后补翻」，而是显式记录原因，使这条缺口可统计。
      return skippedOutcome('业务员在手机端直接发出，未经翻译层', null, null);
    }
    if (message.direction === 'outbound') {
      // 出站消息由 SendService 负责翻译与落库，这里不动
      return null;
    }
    return this.inbound.translate(message.text);
  }

  private async applyOutcome(
    messageId: string,
    outcome: TranslationOutcome,
  ): Promise<MessageRecord> {
    return this.repo.applyTranslation(messageId, {
      textTranslated: outcome.translatedText,
      detectedLanguage: outcome.detectedLanguage,
      targetLanguage: outcome.targetLanguage,
      status: outcome.status,
      // translationError 语义为「译文相关备注」：既含失败原因，也含跳过原因
      error: outcome.reason,
    });
  }
}
