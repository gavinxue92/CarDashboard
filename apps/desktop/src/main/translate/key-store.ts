/**
 * 翻译渠道密钥的解析与覆盖（FR-3.32）。
 *
 * 背景（决定了这里为什么要多一层）：
 *   本版**不做自动更新**（FR-1.6 推迟），密钥又要内置进客户端。
 *   两者叠加 = 密钥一旦失效，换 key 只能重新发安装包让所有人重装 ——
 *   在销售团队里不可执行。
 *
 * 因此密钥按两级解析，**本机文件优先于内置值**：
 *   1. `<userData>/translate-key.json`（使用者可替换的小文件）← 优先
 *   2. 构建期内置值（`CD_TRANSLATE_KEY`，编译进主进程，不进渲染层产物）
 *   3. 都没有 → 回落到零注册公共端点（`google-public`）
 *
 * 并且对文件做**轻量 mtime 轮询**：换 key 后不必重启客户端即可生效，
 * 否则「替换一个小文件」这个兜底在真实场景里还是用不上。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  TRANSLATE_KEY_FILE,
  type TranslateKeyFile,
  type TranslateProviderId,
} from '@cd/shared';
import { log } from '../logger';

export interface ResolvedKey {
  providerId: TranslateProviderId;
  key: string;
  /** 可选：端点覆盖（自建代理 / 专有域名） */
  endpoint?: string;
  source: 'file' | 'builtin' | 'none';
}

/** 密钥文件的检查间隔：换 key 后最多 30 秒生效 */
const KEY_FILE_CHECK_INTERVAL_MS = 30_000;

let cached: ResolvedKey | null = null;
let lastCheckedAt = 0;
let lastMtimeMs = -1;

export function getKeyFilePath(): string {
  return path.join(app.getPath('userData'), TRANSLATE_KEY_FILE);
}

function readKeyFile(): TranslateKeyFile | null {
  const file = getKeyFilePath();
  try {
    const stat = fs.statSync(file);
    lastMtimeMs = stat.mtimeMs;
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const out: TranslateKeyFile = {};
    if (typeof obj.provider === 'string') out.provider = obj.provider as TranslateProviderId;
    if (typeof obj.key === 'string') out.key = obj.key.trim();
    if (typeof obj.endpoint === 'string') out.endpoint = obj.endpoint.trim();
    return out;
  } catch (err) {
    // 文件不存在是常态（大多数使用者不会去放这个文件），按 debug 落日志
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log('warn', 'translate', `密钥文件读取失败，按无密钥处理：${String(err)}`);
    }
    lastMtimeMs = -1;
    return null;
  }
}

/** 内置密钥（构建期注入；未配置时为空串） */
function builtinKey(): string {
  return typeof __TRANSLATE_KEY__ === 'string' ? __TRANSLATE_KEY__.trim() : '';
}

function resolve(): ResolvedKey {
  const file = readKeyFile();

  if (file?.key) {
    // 文件里没写 provider 时按 DeepL 处理：本版只有它需要密钥
    const providerId: TranslateProviderId = file.provider === 'google-public'
      ? 'google-public'
      : 'deepl';
    return {
      providerId,
      key: file.key,
      source: 'file',
      ...(file.endpoint ? { endpoint: file.endpoint } : {}),
    };
  }

  const builtin = builtinKey();
  if (builtin) {
    return { providerId: 'deepl', key: builtin, source: 'builtin' };
  }

  return { providerId: 'google-public', key: '', source: 'none' };
}

/**
 * 取当前生效的密钥。
 * 每 30 秒检查一次密钥文件的 mtime，变化了才重新解析 —— 避免每条消息都读磁盘。
 */
export function getResolvedKey(): ResolvedKey {
  const now = Date.now();

  if (cached && now - lastCheckedAt < KEY_FILE_CHECK_INTERVAL_MS) return cached;

  lastCheckedAt = now;

  // 文件被新增 / 删除 / 改写时都要重新解析
  let currentMtime = -1;
  try {
    currentMtime = fs.statSync(getKeyFilePath()).mtimeMs;
  } catch {
    currentMtime = -1;
  }

  if (!cached) {
    cached = resolve();
    logKeyOnce(cached);
    return cached;
  }

  if (currentMtime !== lastMtimeMs) {
    const next = resolve();
    const changed = next.providerId !== cached.providerId || next.key !== cached.key;
    cached = next;
    if (changed) {
      log('info', 'translate', `密钥状态已变化：渠道 → ${next.providerId}（来源：${next.source}）`);
    }
  }
  return cached;
}

let loggedKeyOnce = false;

function logKeyOnce(key: ResolvedKey): void {
  if (loggedKeyOnce) return;
  loggedKeyOnce = true;
  if (key.source === 'none') {
    log('info', 'translate', '未配置翻译密钥，使用内置免费通道（仅用于验证链路）');
  } else {
    log(
      'info',
      'translate',
      `翻译渠道 = ${key.providerId}（密钥来源：${key.source === 'file' ? '本机文件覆盖' : '构建期内置'}）`,
    );
  }
}

/** 排障用：给使用者看的密钥来源说明（不含密钥内容） */
export function describeKeySource(): string {
  const key = getResolvedKey();
  if (key.source === 'none') return '未配置（使用内置免费通道）';
  return key.source === 'file' ? `本机文件 ${TRANSLATE_KEY_FILE}` : '构建期内置';
}
