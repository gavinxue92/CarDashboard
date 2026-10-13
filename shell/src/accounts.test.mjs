/* vitest v5 不允许在 CJS 里 require('vitest')；被测模块是 .cjs，这里用 .mjs + createRequire 桥接 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeAccountId, partitionFor, defaultAccounts, normalizeAccounts, resolveCurrent } = require('./accounts.cjs');

describe('sanitizeAccountId', () => {
  it('常规 ID 原样（小写化）通过', () => {
    expect(sanitizeAccountId('main')).toBe('main');
    expect(sanitizeAccountId('Sales-A')).toBe('sales-a');
  });

  it('危险字符被折叠为单个 -（partition 名会进存储目录，不能透传）', () => {
    expect(sanitizeAccountId('../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeAccountId('a b//c??d')).toBe('a-b-c-d');
  });

  it('清洗后为空则抛错，绝不静默', () => {
    expect(() => sanitizeAccountId('***')).toThrow();
    expect(() => sanitizeAccountId('')).toThrow();
    expect(() => sanitizeAccountId(null)).toThrow();
    expect(() => sanitizeAccountId('  中文号  ')).toThrow(); // 清洗后为空串
  });
});

describe('partitionFor', () => {
  it('一号一 partition，前缀 persist:wa-（persist: 是登录态落盘的关键）', () => {
    expect(partitionFor('main')).toBe('persist:wa-main');
    expect(partitionFor('Sales B')).toBe('persist:wa-sales-b');
  });

  it('不同 ID 得到不同 partition（不串号）', () => {
    expect(partitionFor('a1')).not.toBe(partitionFor('a2'));
  });
});

describe('normalizeAccounts', () => {
  it('空/非法入参回落出厂账号', () => {
    expect(normalizeAccounts([])).toEqual(defaultAccounts());
    expect(normalizeAccounts(undefined)).toEqual(defaultAccounts());
    expect(defaultAccounts()).toEqual([{ id: 'main', label: '主号' }]);
  });

  it('规范化：ID 清洗 + label 保留，且不动入参', () => {
    const input = [{ id: 'Sales A', label: ' 销售A ' }];
    const out = normalizeAccounts(input);
    expect(out).toEqual([{ id: 'sales-a', label: '销售A' }]);
    expect(input[0].id).toBe('Sales A');
  });

  it('清洗后重复的 ID 抛错（两个账号串一个号 = 事故）', () => {
    expect(() => normalizeAccounts([{ id: 'a', label: 'x' }, { id: 'A ', label: 'y' }])).toThrow(/重复/);
  });

  it('缺 label 抛错；非对象条目抛错', () => {
    expect(() => normalizeAccounts([{ id: 'a' }])).toThrow(/label/);
    expect(() => normalizeAccounts([null])).toThrow();
  });
});

describe('resolveCurrent', () => {
  it('命中返回原 ID；配置被手改后回落第一个', () => {
    const accounts = normalizeAccounts([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    expect(resolveCurrent(accounts, 'b')).toBe('b');
    expect(resolveCurrent(accounts, 'ghost')).toBe('a');
  });
});
