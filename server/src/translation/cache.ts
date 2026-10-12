import type { LanguageCode } from './translator.js';

interface CacheEntry {
  text: string;
}

/**
 * 翻译结果缓存（LRU）。
 *
 * 业务里的高频短句命中率很高——「你好」「价格多少」「运费到拉各斯」——
 * 相同文本只翻一次，直接省钱也省延迟。
 */
export class TranslationCache {
  private readonly store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries = 2000) {}

  static key(text: string, source: LanguageCode, target: LanguageCode): string {
    return `${source}\u0000${target}\u0000${text}`;
  }

  get(text: string, source: LanguageCode, target: LanguageCode): string | null {
    const k = TranslationCache.key(text, source, target);
    const hit = this.store.get(k);
    if (!hit) {
      this.misses += 1;
      return null;
    }
    // 触碰即刷新 LRU 顺序
    this.store.delete(k);
    this.store.set(k, hit);
    this.hits += 1;
    return hit.text;
  }

  set(text: string, source: LanguageCode, target: LanguageCode, translated: string): void {
    const k = TranslationCache.key(text, source, target);
    this.store.delete(k);
    this.store.set(k, { text: translated });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }

  get size(): number {
    return this.store.size;
  }

  get stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.store.size };
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
