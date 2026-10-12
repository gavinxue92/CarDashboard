import { randomUUID, randomBytes } from 'node:crypto';

/** 生成器接口，测试可替换为确定性实现 */
export interface IdGenerator {
  next(): string;
  short(): string;
}

/** 生产实现：UUID v4 + 短随机串（用于二维码 payload 等） */
export const uuidIds: IdGenerator = {
  next: () => randomUUID(),
  short: () => randomBytes(9).toString('base64url'),
};

/** 测试用：确定性、可预测的 ID，便于断言 */
export function sequentialIds(prefix = 'id'): IdGenerator {
  let n = 0;
  return {
    next: () => `${prefix}-${++n}`,
    short: () => `${prefix}s-${++n}`,
  };
}
