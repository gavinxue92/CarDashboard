/** 时间抽象。所有业务逻辑取时间必须走这里，否则测试无法控制时间。 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** 测试用：可手动推进的时钟 */
export function fixedClock(startMs = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let t = startMs;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (ms) => {
      t = ms;
    },
  };
}
