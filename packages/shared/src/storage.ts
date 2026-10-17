/**
 * 本地持久化结构（技术方案 4.5）。
 *
 * 本版为纯本机单机客户端：所有配置都在本机文件里，无服务端、无数据库。
 * 卸载时该文件随应用数据目录一并清除（FR-1.7，已确认决策 D7），重装后需重新扫码并重填备注。
 */
import { normalizeTranslateSettings, type WATranslateSettings } from './translate-settings';

export const STORAGE_SCHEMA_VERSION = 1;

export interface PersistedState {
  /** 结构版本号：将来加登录层或改结构时用于迁移 */
  schemaVersion: number;
  /** 账号备注（FR-3.7）——V1 无账号体系，故无账号维度 */
  memo: string;
  /** 翻译设置（FR-3.20 / 3.21） */
  translate: WATranslateSettings;
}

export const DEFAULT_PERSISTED_STATE: PersistedState = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  memo: '',
  translate: normalizeTranslateSettings(undefined),
};

/** 把磁盘数据规范化为完整状态，兼容旧版本与损坏文件 */
export function normalizePersistedState(input: unknown): PersistedState {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PERSISTED_STATE };
  const raw = input as Record<string, unknown>;
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    memo: typeof raw.memo === 'string' ? raw.memo : DEFAULT_PERSISTED_STATE.memo,
    translate: normalizeTranslateSettings(raw.translate),
  };
}
