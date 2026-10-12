import { describe, expect, it } from 'vitest';
import { detectLanguage, isTranslatable } from './detect.js';

describe('detectLanguage', () => {
  it('按文字系统粗判语言', () => {
    expect(detectLanguage('你好，这辆车多少钱')).toBe('zh');
    expect(detectLanguage('このトラックはいくらですか')).toBe('ja');
    expect(detectLanguage('안녕하세요')).toBe('ko');
    expect(detectLanguage('مرحبا، كم السعر')).toBe('ar');
    expect(detectLanguage('Здравствуйте')).toBe('ru');
    expect(detectLanguage('How much is this truck?')).toBe('en');
  });

  it('日文含汉字时不误判为中文（假名优先）', () => {
    expect(detectLanguage('中古車の価格')).toBe('ja');
  });
});

describe('isTranslatable', () => {
  it('有实际文字才需要翻译', () => {
    expect(isTranslatable('你好')).toBe(true);
    expect(isTranslatable('Hello')).toBe(true);
    expect(isTranslatable('ok 你好')).toBe(true);
  });

  it('纯数字 / 标点 / 表情 / 链接都跳过', () => {
    expect(isTranslatable('12345')).toBe(false);
    expect(isTranslatable('!!!???。。。')).toBe(false);
    expect(isTranslatable('😀😀👍')).toBe(false);
    expect(isTranslatable('https://example.com/listing/123')).toBe(false);
    expect(isTranslatable('   ')).toBe(false);
  });

  it('空值与 undefined 安全', () => {
    expect(isTranslatable(null)).toBe(false);
    expect(isTranslatable(undefined)).toBe(false);
    expect(isTranslatable('')).toBe(false);
  });
});
