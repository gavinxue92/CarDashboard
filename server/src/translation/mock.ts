import { detectLanguage } from './detect.js';
import type { TranslateRequest, TranslateResult, Translator } from './translator.js';
import { TranslationError } from './translator.js';

/**
 * 词表驱动的假翻译器。
 *
 * 用途：让「收发 + 双向翻译」这条链路在没有翻译 API Key 的情况下
 * **端到端可跑、可测**。它**只翻它认识的短语**，不认识的原文原样返回，
 * 并标记 `provider: 'mock:identity'` —— 绝不让假译文冒充真译文。
 */
export interface MockTranslatorOptions {
  /** key 形如 'zh>en'，value 是短语表 */
  phrases?: Record<string, Record<string, string>>;
  /** 设为 true 时所有调用都抛错，用于测试失败路径 */
  failAlways?: boolean;
  /** 每次调用前推进一次的钩子（测试重试用） */
  onCall?: (req: TranslateRequest) => void;
}

/** 与原型 demo 内容对齐的一小批短语，保证链路演示时「看得见变化」 */
export const DEMO_PHRASES: Record<string, Record<string, string>> = {
  'zh>en': {
    你好: 'Hello',
    这个价格是多少: 'How much is this?',
    运费到拉各斯: 'Shipping cost to Lagos',
    这辆车是2018年的: 'This truck is a 2018 model',
    我们下周发货: 'We will ship next week',
  },
  'en>zh': {
    Hello: '你好',
    'How much is this truck?': '这辆卡车多少钱？',
    'Do you have any 2018 Howo?': '你们有 2018 年的豪沃吗？',
    'What is the price?': '价格是多少？',
    'Is it left-hand drive?': '是左舵车吗？',
  },
};

export class MockTranslator implements Translator {
  readonly name = 'mock';
  private readonly phrases: Record<string, Record<string, string>>;
  private readonly failAlways: boolean;
  private readonly onCall: ((req: TranslateRequest) => void) | undefined;

  constructor(options: MockTranslatorOptions = {}) {
    this.phrases = options.phrases ?? DEMO_PHRASES;
    this.failAlways = options.failAlways ?? false;
    this.onCall = options.onCall;
  }

  async translate(request: TranslateRequest): Promise<TranslateResult> {
    this.onCall?.(request);
    if (this.failAlways) {
      throw new TranslationError('mock: 故意失败', this.name);
    }

    const source =
      request.source && request.source !== 'auto'
        ? request.source
        : detectLanguage(request.text);

    const table = this.phrases[`${source}>${request.target}`];
    // 词表按「原文去首尾空白 + 小写」查找，但保留原始大小写作为首选键
    const exact = table?.[request.text.trim()];
    const loose = table?.[request.text.trim().toLowerCase()];

    if (exact !== undefined) {
      return { text: exact, detectedSource: source, provider: this.name };
    }
    if (loose !== undefined) {
      return { text: loose, detectedSource: source, provider: this.name };
    }
    return { text: request.text, detectedSource: source, provider: 'mock:identity' };
  }
}
