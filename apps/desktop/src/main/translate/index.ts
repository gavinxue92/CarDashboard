/**
 * 翻译调度器（FR-3.27 / FR-3.29 / FR-3.31 / FR-3.32）。
 *
 * 注入层只管「把文本递过来、把译文拿回去」，所有横切关注点都在这里：
 *   - **渠道选择**：由密钥可用性决定，不由弹窗的「翻译渠道」决定（渠道选型本版不做）
 *   - **去重缓存**：同一条消息重复出现（虚拟列表回收后重建）不重复调接口，也不重复计费
 *   - **并发控制**：同时最多 3 条，避免一次性拉满把接口打挂
 *   - **超时**：8 秒，到点即断，不让消息一直挂着
 *   - **失败降级**：连续失败到阈值才提示一次，之后不再刷屏
 *
 * ⚠️ 这里**不落库**：缓存只在内存里，进程退出即消失（需求 6.2 数据边界）。
 */
import type { BrowserWindow } from 'electron';
import {
  TRANSLATE_CONCURRENCY,
  TRANSLATE_CACHE_LIMIT,
  TRANSLATE_FAIL_ALERT_THRESHOLD,
  TRANSLATE_MAX_CHARS,
  TRANSLATE_PROVIDERS,
  TRANSLATE_TIMEOUT_MS,
  TRANSLATE_ERROR_HINT,
  hashText,
  isTranslatable,
  normalizeTranslateText,
  toRuntimeConfig,
  type TranslateErrorCode,
  type TranslateProviderId,
  type TranslateRequest,
  type TranslateResult,
  type TranslateRuntimeConfig,
  type TranslateStatusPayload,
} from '@cd/shared';
import { getTranslateSettings } from '../store';
import { getWaSession } from '../wa-session';
import { showToast } from '../toast-window';
import { log } from '../logger';
import { getResolvedKey } from './key-store';
import { createDeepLProvider } from './deepl';
import { createGooglePublicProvider } from './public-endpoint';
import { toErrorCode, TranslateError, type TranslateProvider } from './provider';

// ── 状态 ─────────────────────────────────────────────────────────────

/** 内存 LRU：Map 的插入顺序即最近使用顺序（get 时删了再塞回去） */
const cache = new Map<string, string>();

let active = 0;
const waiters: Array<() => void> = [];

let successCount = 0;
let failureCount = 0;
let consecutiveFailures = 0;
let alerted = false;
let lastError: TranslateErrorCode | undefined;

let getHostWindow: () => BrowserWindow | null = () => null;
let onStatusChange: (payload: TranslateStatusPayload) => void = () => {};

let currentProvider: TranslateProvider | null = null;
let currentProviderId: TranslateProviderId = 'google-public';

// ── 初始化 ───────────────────────────────────────────────────────────

export function initTranslate(deps: {
  getWindow: () => BrowserWindow | null;
  onStatus?: (payload: TranslateStatusPayload) => void;
}): void {
  getHostWindow = deps.getWindow;
  if (deps.onStatus) onStatusChange = deps.onStatus;
  refreshProvider(true);
}

/**
 * 按密钥可用性重新选定渠道。
 * 密钥文件被替换（FR-3.32 的免发版换 key）后，下一次请求会自动走到这里。
 */
export function refreshProvider(force = false): TranslateProviderId {
  const resolved = getResolvedKey();
  if (!force && currentProvider && currentProvider.id === resolved.providerId) {
    return currentProviderId;
  }

  currentProviderId = resolved.providerId;
  currentProvider =
    resolved.providerId === 'deepl'
      ? createDeepLProvider(resolved.key, resolved.endpoint)
      : createGooglePublicProvider();

  return currentProviderId;
}

export function getTranslateProviderId(): TranslateProviderId {
  return refreshProvider();
}

/** 注入层要的运行时配置快照（每次页面加载完都会重发） */
export function buildRuntimeConfig(): TranslateRuntimeConfig {
  return toRuntimeConfig(getTranslateSettings(), refreshProvider());
}

export function getTranslateStatus(): TranslateStatusPayload {
  const settings = getTranslateSettings();
  const providerId = refreshProvider();
  const provider = currentProvider;
  const meta = TRANSLATE_PROVIDERS[providerId];
  return {
    enabled: settings.enabled,
    available: Boolean(provider?.ready()) && consecutiveFailures < TRANSLATE_FAIL_ALERT_THRESHOLD,
    providerId,
    providerLabel: meta.label,
    ...(lastError ? { lastError } : {}),
    successCount,
    failureCount,
  };
}

export function setTranslateStatusListener(cb: (payload: TranslateStatusPayload) => void): void {
  onStatusChange = cb;
}

/** 设置变更后调用：刷新渠道并对外广播一次状态 */
export function notifyTranslateConfigChanged(): void {
  refreshProvider(true);
  onStatusChange(getTranslateStatus());
}

// ── 主入口 ───────────────────────────────────────────────────────────

/**
 * 处理一条翻译请求。
 *
 * **永不抛异常**：所有失败都折叠成 `{ ok: false, error }`。
 * 调用方（注入层）靠 `ok` 决定是静默跳过（入向）还是阻断发送（出向，FR-3.26），
 * 一个未捕获的异常会让这两种处理都失效。
 */
export async function translateRequest(req: TranslateRequest): Promise<TranslateResult> {
  const seq = req.seq;
  const settings = getTranslateSettings();

  if (!settings.enabled) {
    return { seq, ok: false, text: '', error: 'disabled' };
  }

  const text = normalizeTranslateText(req.text);
  if (!text) return { seq, ok: false, text: '', error: 'empty' };
  if (text.length > TRANSLATE_MAX_CHARS) {
    return { seq, ok: false, text: '', error: 'too-long' };
  }
  if (!isTranslatable(text)) return { seq, ok: false, text: '', error: 'empty' };

  const provider = currentProvider ?? createGooglePublicProvider();
  if (!provider.ready()) {
    markFailure('auth');
    return { seq, ok: false, text: '', error: 'auth' };
  }

  // 语言方向：入向 = 对方语言 → 我的语言；出向反之
  const fromLabel = req.direction === 'in' ? settings.peerLanguage : settings.myLanguage;
  const toLabel = req.direction === 'in' ? settings.myLanguage : settings.peerLanguage;
  const traditional = settings.traditionalChinese;

  // 缓存键必须带语言对与繁简：同一句英文在「英→简中」和「英→繁中」下译文不同，
  // 只用文本 hash 会串味（FR-3.27）
  const cacheKey = [
    provider.id,
    fromLabel,
    toLabel,
    traditional ? 'trad' : 'simp',
    hashText(text),
  ].join('|');

  const hit = cache.get(cacheKey);
  if (hit !== undefined) {
    // 命中即刷新最近使用顺序
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return { seq, ok: true, text: hit, cached: true };
  }

  await acquire();
  try {
    const translated = await runProvider(provider, {
      text,
      fromLabel,
      toLabel,
      direction: req.direction,
      traditionalChinese: traditional,
    });

    remember(cacheKey, translated);
    successCount += 1;
    consecutiveFailures = 0;
    alerted = false;
    lastError = undefined;
    onStatusChange(getTranslateStatus());
    return { seq, ok: true, text: translated };
  } catch (err) {
    const code = toErrorCode(err);
    markFailure(code);
    log('warn', 'translate', `翻译失败（${code}）：${err instanceof Error ? err.message : String(err)}`);
    return { seq, ok: false, text: '', error: code };
  } finally {
    release();
  }
}

// ── 内部 ─────────────────────────────────────────────────────────────

interface RunJob {
  text: string;
  fromLabel: string;
  toLabel: string;
  direction: TranslateRequest['direction'];
  traditionalChinese: boolean;
}

async function runProvider(provider: TranslateProvider, job: RunJob): Promise<string> {
  const signal = AbortSignal.timeout(TRANSLATE_TIMEOUT_MS);
  const ses = getWaSession();

  // 走 WhatsApp 分区的网络栈：沿用该分区的代理出口与系统证书设置。
  // 个别 Electron 版本/环境下 Session.fetch 不可用，回落到全局 fetch（直连）。
  const request = async (url: string, init: RequestInit): Promise<Response> => {
    const withSignal: RequestInit = { ...init, signal };
    const sesFetch = (ses as unknown as { fetch?: (u: string, i: RequestInit) => Promise<Response> })
      .fetch;
    if (typeof sesFetch === 'function') return sesFetch.call(ses, url, withSignal);
    return fetch(url, withSignal);
  };

  return provider.translate(job, { request, signal });
}

function remember(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > TRANSLATE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function markFailure(code: TranslateErrorCode): void {
  failureCount += 1;
  consecutiveFailures += 1;
  lastError = code;

  if (consecutiveFailures >= TRANSLATE_FAIL_ALERT_THRESHOLD && !alerted) {
    alerted = true;
    const hint = TRANSLATE_ERROR_HINT[code];
    const host = getHostWindow();
    if (host && !host.isDestroyed()) {
      showToast(host, {
        message: `翻译服务暂时不可用（${hint}），消息将按原文显示`,
        type: 'warning',
      });
    }
    log('warn', 'translate', `连续 ${consecutiveFailures} 次失败，已提示一次（原因：${code}）`);
  }

  onStatusChange(getTranslateStatus());
}

/** 清空去重缓存（解除绑定时调用：换号后旧译文没有复用价值） */
export function clearTranslateCache(): void {
  cache.clear();
  consecutiveFailures = 0;
  alerted = false;
  lastError = undefined;
}

// ── 并发闸门 ─────────────────────────────────────────────────────────

async function acquire(): Promise<void> {
  if (active >= TRANSLATE_CONCURRENCY) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    return;
  }
  active += 1;
}

function release(): void {
  const next = waiters.shift();
  // 还有人在等：把这个槽位直接让给它，active 不变
  if (next) {
    next();
    return;
  }
  active = Math.max(0, active - 1);
}

/** 仅测试用：便于自检脚本构造错误 */
export { TranslateError };
