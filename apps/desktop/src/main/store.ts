/**
 * 本地持久化（技术方案 4.5）。
 *
 * 存什么：账号备注（FR-3.7）、翻译设置（FR-3.21）、上次选中功能。
 * 存哪：`<userData>/config.json`，卸载时随应用数据目录一并清除（FR-1.7 / 决策 D7）。
 *
 * 实现说明（与原方案的一处偏离，需知悉）：
 * 技术方案 4.5 写的是 `electron-store`。落地时改为这里的轻量实现，原因有三：
 *   1) electron-store 12 为 ESM-only，而主进程输出 CJS，需额外的互操作处理，属无谓的构建脆弱点；
 *   2) 本版只存几 KB 配置，用不上它的事务、watch、迁移能力；
 *   3) 自行实现（约 60 行）零依赖，且写入失败可预期（见 flushStore 的原子替换）。
 * 对外接口保持 get / patch 语义；将来若要换回 electron-store，只需改本文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  normalizePersistedState,
  normalizeTranslateSettings,
  type PersistedState,
  type WATranslateSettings,
} from '@cd/shared';
import { log } from './logger';

/** 备注长度上限：只是防误输入，不属需求约束 */
const MEMO_MAX_LENGTH = 200;

let cache: PersistedState = normalizePersistedState(undefined);
let filePath = '';
let flushTimer: NodeJS.Timeout | null = null;

export function initStore(): void {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, 'config.json');
    if (fs.existsSync(filePath)) {
      const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      cache = normalizePersistedState(raw);
      log('info', 'store', `已载入本地配置：${filePath}`);
    } else {
      cache = normalizePersistedState(undefined);
      log('info', 'store', `未发现本地配置，使用默认值：${filePath}`);
    }
  } catch (err) {
    // 配置文件损坏时回退默认值，不能让应用起不来
    log('warn', 'store', `配置读取失败，已回退默认值：${String(err)}`);
    cache = normalizePersistedState(undefined);
    flushStore();
  }
}

export function getStorePath(): string {
  return filePath;
}

export function getState(): PersistedState {
  return cache;
}

export function patchState(patch: Partial<PersistedState>): PersistedState {
  cache = normalizePersistedState({ ...cache, ...patch });
  scheduleFlush();
  return cache;
}

/** 读取账号备注（FR-3.7） */
export function getMemo(): string {
  return cache.memo;
}

/**
 * 写入账号备注。
 * 同步更新翻译设置里的 `remark`：两处共享同一份数据（交互说明 7.4 注）。
 */
export function setMemo(value: string): PersistedState {
  const memo = value.slice(0, MEMO_MAX_LENGTH);
  cache = normalizePersistedState({
    ...cache,
    memo,
    translate: { ...cache.translate, remark: memo },
  });
  scheduleFlush();
  return cache;
}

/** 读取翻译设置（FR-3.20 / 3.21） */
export function getTranslateSettings(): WATranslateSettings {
  return cache.translate;
}

/**
 * 保存翻译设置。
 * V1 只写本地缓存（交互说明 IX-8.1 / IX-8.4），不产生任何实际翻译行为。
 * 若 `remark` 变化，同步回账号备注，保持两处一致。
 */
export function saveTranslateSettings(input: unknown): WATranslateSettings {
  const translate = normalizeTranslateSettings(input);
  const memo = translate.remark.slice(0, MEMO_MAX_LENGTH);
  translate.remark = memo;
  cache = normalizePersistedState({ ...cache, memo, translate });
  scheduleFlush();
  return translate;
}

/** 恢复翻译设置默认值（FR-3.21，reset 契约） */
export function resetTranslateSettings(): void {
  const translate = normalizeTranslateSettings(undefined);
  // 备注属于用户已填写的身份信息，重置翻译设置时不应连带清掉
  translate.remark = cache.memo;
  cache = normalizePersistedState({ ...cache, translate });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushStore();
  }, 200);
}

export function flushStore(): void {
  if (!filePath) return;
  try {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    // 先写临时文件再改名：避免写到一半异常留下半截 JSON
    fs.renameSync(tmp, filePath);
  } catch (err) {
    log('error', 'store', `配置写入失败：${String(err)}`);
  }
}
