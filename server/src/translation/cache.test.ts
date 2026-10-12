import { describe, expect, it } from 'vitest';
import { TranslationCache } from './cache.js';

describe('TranslationCache', () => {
  it('相同 (source, target, text) 命中，不同目标语言不串味', () => {
    const c = new TranslationCache();
    expect(c.get('你好', 'zh', 'en')).toBeNull();
    c.set('你好', 'zh', 'en', 'Hello');
    expect(c.get('你好', 'zh', 'en')).toBe('Hello');
    expect(c.get('你好', 'zh', 'ar')).toBeNull();
  });

  it('统计命中与未命中', () => {
    const c = new TranslationCache();
    c.set('a', 'zh', 'en', 'A');
    c.get('a', 'zh', 'en');
    c.get('missing', 'zh', 'en');
    expect(c.stats.hits).toBe(1);
    expect(c.stats.misses).toBe(1);
  });

  it('超出容量按 LRU 淘汰最久未用', () => {
    const c = new TranslationCache(2);
    c.set('a', 'zh', 'en', 'A');
    c.set('b', 'zh', 'en', 'B');
    c.get('a', 'zh', 'en'); // a 变新
    c.set('c', 'zh', 'en', 'C'); // b 被淘汰
    expect(c.size).toBe(2);
    expect(c.get('b', 'zh', 'en')).toBeNull();
    expect(c.get('a', 'zh', 'en')).toBe('A');
    expect(c.get('c', 'zh', 'en')).toBe('C');
  });

  it('clear 清空并重置统计', () => {
    const c = new TranslationCache();
    c.set('a', 'zh', 'en', 'A');
    c.get('a', 'zh', 'en');
    c.clear();
    expect(c.size).toBe(0);
    expect(c.stats.hits).toBe(0);
  });

  it('key 拼接不会因分隔符碰撞', () => {
    const a = TranslationCache.key('x\0y', 'zh', 'en');
    const b = TranslationCache.key('x', 'zh', 'en\0y');
    expect(a).not.toBe(b);
  });
});
