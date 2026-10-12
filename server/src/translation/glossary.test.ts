import { describe, expect, it } from 'vitest';
import { AUTOMOTIVE_TERMS, Glossary } from './glossary.js';

describe('Glossary', () => {
  const g = new Glossary();

  it('把已知术语换成占位符，再还原成目标语言说法', () => {
    const p = g.protect('这车是国六的', 'en');
    expect(p.text).not.toContain('国六');
    expect(p.hits).toContain('国六');
    expect(p.restore('This truck is ⟦0⟧')).toBe('This truck is China VI emission standard');
  });

  it('长词优先，短词不会先吃掉长词的一部分', () => {
    const custom = new Glossary([
      { term: '国六', translations: { en: 'China VI' } },
      { term: '国六b', translations: { en: 'China VI b' } },
    ]);
    const p = custom.protect('国六b标准', 'en');
    expect(p.restore(p.text)).toBe('China VI b标准');
    expect(p.hits).toEqual(['国六b']);
  });

  it('目标语言没有对应术语时保持原样（不做半吊子替换）', () => {
    const p = g.protect('这车是国六的', 'ar');
    expect(p.text).toBe('这车是国六的');
    expect(p.hits).toEqual([]);
    expect(p.restore(p.text)).toBe('这车是国六的');
  });

  it('同一目标语言下多个术语按出现顺序编号并全部还原', () => {
    const p = g.protect('豪沃 和 陕汽 都是国六', 'en');
    expect(p.hits).toEqual(expect.arrayContaining(['豪沃', '陕汽', '国六']));
    const restored = p.restore(p.text);
    expect(restored).toContain('HOWO');
    expect(restored).toContain('SHACMAN');
    expect(restored).toContain('China VI emission standard');
  });

  it('术语表覆盖双向：英→中也有条目', () => {
    expect(g.sizeFor('zh')).toBeGreaterThan(0);
    const p = g.protect('We sell HOWO trucks', 'zh');
    expect(p.restore(p.text)).toBe('We sell 豪沃 trucks');
  });

  it('默认术语表非空且每条都有至少一种目标语言', () => {
    expect(AUTOMOTIVE_TERMS.length).toBeGreaterThan(5);
    for (const e of AUTOMOTIVE_TERMS) {
      expect(Object.keys(e.translations).length).toBeGreaterThan(0);
    }
  });
});
