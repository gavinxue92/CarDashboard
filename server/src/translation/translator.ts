/**
 * 翻译服务接口。
 *
 * **业务代码只认这个接口，不认供应商。** 换 DeepL / Google / 大模型 /
 * 多引擎聚合，都是换一个实现，业务代码一行不动。
 */

export type LanguageCode = string;

export interface TranslateRequest {
  text: string;
  /** 目标语言。**必填** —— 目标是数据，不能有默认值藏在代码里 */
  target: LanguageCode;
  /** 源语言；未知时传 'auto'，由实现或检测器给出 */
  source?: LanguageCode | 'auto';
  /** 领域提示：实现可据此选择专业词库或加权策略 */
  domain?: 'automotive' | 'general';
}

export interface TranslateResult {
  text: string;
  /** 实现识别出的源语言 */
  detectedSource: LanguageCode;
  /** 哪个实现产出的（便于多引擎聚合时追溯） */
  provider: string;
}

export interface Translator {
  readonly name: string;
  translate(request: TranslateRequest): Promise<TranslateResult>;
}

/** 翻译实现（网络 / 供应商 / 配额）失败时抛这个，上层据此写 failed 状态 */
export class TranslationError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}
