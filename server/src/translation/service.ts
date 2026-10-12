import type { TranslationStatus } from '../domain/types.js';
import { TranslationCache } from './cache.js';
import { detectLanguage, isTranslatable } from './detect.js';
import { Glossary } from './glossary.js';
import type { LanguageCode, TranslateRequest, Translator } from './translator.js';

/**
 * 一次翻译尝试的结果。
 *
 * 设计要点：**翻译失败不抛异常**，而是返回一个带 `status: 'failed'` 的结果。
 * 调用方（管道）据此把失败写进消息记录，**原文一个字都不受影响**。
 */
export interface TranslationOutcome {
  status: TranslationStatus;
  translatedText: string | null;
  detectedLanguage: LanguageCode | null;
  targetLanguage: LanguageCode | null;
  provider: string | null;
  cached: boolean;
  /** 本次命中的专业术语，供埋点与人工核对 */
  glossaryHits: string[];
  /** status 非 done 时的可读原因 */
  reason: string | null;
}

export interface TranslationServiceOptions {
  translator: Translator;
  cache?: TranslationCache;
  glossary?: Glossary;
  /** 是否使用专业术语表，默认 true */
  useGlossary?: boolean;
}

/** 构造一个 skipped 结果。管道层在「判定不该翻」时直接用它落库。 */
export function skippedOutcome(
  reason: string,
  target: LanguageCode | null = null,
  detected: LanguageCode | null = null,
): TranslationOutcome {
  return {
    status: 'skipped',
    translatedText: null,
    detectedLanguage: detected,
    targetLanguage: target,
    provider: null,
    cached: false,
    glossaryHits: [],
    reason,
  };
}

/**
 * 翻译中间层。
 *
 * **三个决策点都在这里**：
 *  ① 翻不翻 —— 无文本 / 同语言 / 未指定目标语言 → skipped
 *  ② 翻什么 —— 只翻文本（媒体与语音不在本层）
 *  ③ 怎么翻 —— 术语表前后各插一道 → 缓存 → 调 Translator
 *
 * 它不认识「消息」「会话」「数据库」，只认文本与语言对。
 * 因此它可以被入站与出站两个钩子共用，也可以被单测直接驱动。
 */
export class TranslationService {
  private readonly translator: Translator;
  private readonly cache: TranslationCache;
  private readonly glossary: Glossary;
  private readonly useGlossary: boolean;

  constructor(options: TranslationServiceOptions) {
    this.translator = options.translator;
    this.cache = options.cache ?? new TranslationCache();
    this.glossary = options.glossary ?? new Glossary();
    this.useGlossary = options.useGlossary ?? true;
  }

  async translate(
    text: string | null | undefined,
    targetLang: LanguageCode | null | undefined,
    extra: Pick<TranslateRequest, 'source' | 'domain'> = {},
  ): Promise<TranslationOutcome> {
    if (!isTranslatable(text)) {
      return skippedOutcome('没有可翻译的文本（纯数字 / 标点 / 表情 / 链接）', targetLang ?? null);
    }
    const source = text as string;

    if (!targetLang) {
      return skippedOutcome('未指定目标语言 —— 应先从客户档案读取客户语言', null, detectLanguage(source));
    }

    const detected = detectLanguage(source);
    if (detected === targetLang && (!extra.source || extra.source === 'auto')) {
      return skippedOutcome(`源语言与目标语言相同（${detected}）`, targetLang, detected);
    }

    const cached = this.cache.get(source, detected, targetLang);
    if (cached !== null) {
      return {
        status: 'done',
        translatedText: cached,
        detectedLanguage: detected,
        targetLanguage: targetLang,
        provider: this.translator.name,
        cached: true,
        glossaryHits: [],
        reason: null,
      };
    }

    const protectedText = this.useGlossary
      ? this.glossary.protect(source, targetLang)
      : { text: source, restore: (s: string) => s, hits: [] as string[] };

    try {
      const result = await this.translator.translate({
        text: protectedText.text,
        target: targetLang,
        source: extra.source ?? 'auto',
        domain: extra.domain ?? 'automotive',
      });
      const restored = protectedText.restore(result.text);
      this.cache.set(source, detected, targetLang, restored);
      return {
        status: 'done',
        translatedText: restored,
        detectedLanguage: result.detectedSource || detected,
        targetLanguage: targetLang,
        provider: result.provider,
        cached: false,
        glossaryHits: protectedText.hits,
        reason: null,
      };
    } catch (err) {
      return {
        status: 'failed',
        translatedText: null,
        detectedLanguage: detected,
        targetLanguage: targetLang,
        provider: this.translator.name,
        cached: false,
        glossaryHits: protectedText.hits,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  get cacheStats(): { hits: number; misses: number; size: number } {
    return this.cache.stats;
  }
}

/** 入站钩子：客户 → 我方。目标语言是「工作台语言」，来自配置而非代码。 */
export class InboundTranslator {
  constructor(
    private readonly service: TranslationService,
    private readonly workspaceLanguage: LanguageCode = 'zh',
  ) {}

  translate(text: string | null | undefined): Promise<TranslationOutcome> {
    return this.service.translate(text, this.workspaceLanguage);
  }
}

/**
 * 出站钩子：我方 → 客户。目标语言**从客户档案读**，不写死。
 *
 * ⚠️ 消息发出后不可撤回，因此调用方必须提供「先看译文再发」的交互，
 * 不能把本方法的结果静默直发。
 */
export class OutboundTranslator {
  constructor(private readonly service: TranslationService) {}

  translate(text: string | null | undefined, contactLanguage: LanguageCode | null): Promise<TranslationOutcome> {
    if (!contactLanguage) {
      return Promise.resolve(skippedOutcome('客户语言未设置 —— 请在客户档案中补全后再发'));
    }
    return this.service.translate(text, contactLanguage);
  }
}
