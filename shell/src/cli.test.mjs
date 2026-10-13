import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseFlags } = require('./cli.cjs');

describe('parseFlags', () => {
  it('无旗标 → smoke=false', () => {
    expect(parseFlags([])).toEqual({ smoke: false });
    expect(parseFlags(undefined)).toEqual({ smoke: false });
  });

  it('--smoke → smoke=true', () => {
    expect(parseFlags(['--smoke'])).toEqual({ smoke: true });
    expect(parseFlags(['.', '--smoke'])).toEqual({ smoke: true });
  });
});
