import type { LanguageCode } from './translator.js';

/**
 * 语言粗判。
 *
 * ⚠️ 局限（有意为之）：靠 Unicode 字集判断，**只能区分不同文字系统**。
 * 英语 / 法语 / 葡萄牙语同为拉丁字母，这里一律返回 'en'。
 * 真实实现应由翻译供应商的检测能力给出准确值；本函数只用于回答
 * 一个便宜得多的问题：**「这条消息需不需要翻译」**。
 */

const KANA = /[\u3040-\u30ff]/;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/;
const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const ARABIC = /[\u0600-\u06ff\u0750-\u077f]/;
const CYRILLIC = /[\u0400-\u04ff]/;
const DEVANAGARI = /[\u0900-\u097f]/;
const THAI = /[\u0e00-\u0e7f]/;
const HEBREW = /[\u0590-\u05ff]/;

export function detectLanguage(text: string): LanguageCode {
  // 假名先判：日文含汉字，若先判 CJK 会被误判为中文
  if (KANA.test(text)) return 'ja';
  if (HANGUL.test(text)) return 'ko';
  if (CJK.test(text)) return 'zh';
  if (ARABIC.test(text)) return 'ar';
  if (HEBREW.test(text)) return 'he';
  if (CYRILLIC.test(text)) return 'ru';
  if (DEVANAGARI.test(text)) return 'hi';
  if (THAI.test(text)) return 'th';
  return 'en';
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const PICTOGRAPH_RE = /\p{Extended_Pictographic}/gu;
const NON_LETTER_RE = /[\p{P}\p{S}\p{N}\s]/gu;

/**
 * 是否值得送去翻译。
 * 纯数字、纯标点、纯表情、纯链接都不需要 —— 省下一次调用。
 */
export function isTranslatable(text: string | null | undefined): boolean {
  if (!text) return false;
  const lettersOnly = text
    .replace(URL_RE, ' ')
    .replace(PICTOGRAPH_RE, ' ')
    .replace(NON_LETTER_RE, '');
  return lettersOnly.length > 0;
}
