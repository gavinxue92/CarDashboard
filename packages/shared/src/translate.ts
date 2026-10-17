/**
 * 双向注入式翻译 —— 契约层（需求 5.3.7 / FR-3.22 ~ FR-3.32）。
 *
 * 本文件只管「数据长什么样、怎么算」，不含任何 IO：
 *   - 语言标签 → 各渠道的语言代码
 *   - 文本判定与规范化（是否含中文、是否值得翻译、去重用的 hash）
 *   - 注入层需要的运行时配置快照
 *   - 限额常量（超时不拖垮界面、缓存不涨内存）
 *
 * ⚠️ 冻结说明：`WATranslateSettings` 的 22 个字段仍然冻结（translate-settings.ts）。
 * 本文件新增的都是**运行时派生结构与常量**，不改弹窗字段。
 */
import type { WATranslateSettings } from './translate-settings';

// ── 注入层 ↔ 主进程 的专用通道（V1.4） ─────────────────────────────────

/**
 * 注入脚本与主进程之间的 IPC 通道名。
 *
 * ⚠️ **为什么这几个通道不放在 `ipc.ts` 里**（看起来更该放那儿）：
 *
 * 我们有两个 preload：主窗口的 `index.ts` 和注入到官方页面的 `wa-inject.ts`。
 * 注入脚本必须跑在**沙箱**里（内嵌的是第三方远程内容，沙箱不可退让），
 * 而**沙箱 preload 的 `require` 只认 `electron` 等少数内置模块，
 * 不能加载相对路径的本地文件**。
 *
 * 可打包器默认会把「两个入口都引用的模块」抽成公共 chunk
 * （实测产出 `chunks/ipc-xxx.js`），于是注入脚本一加载就 `require` 失败。
 *
 * 解法：让两个入口的**运行时依赖图互不相交**——
 * 主窗口 preload 只碰 `ipc.ts`，注入脚本只碰本文件。
 * 因此这四个通道必须留在这里，**不要把 REQUEST / CONFIG / LOG 挪回 `ipc.ts`**，
 * 否则公共 chunk 会重现。构建后有 `scripts/check-preload.mjs` 兜底断言。
 *
 * `STATUS` 是主 → 渲染层的推送，由主窗口 preload 使用，故留在 `ipc.ts`。
 */
export const INJECT_IPC = {
  /** 注入层请求翻译（invoke，请求-响应）：返回 TranslateResult */
  REQUEST: 'translate:request',
  /** 主进程下发运行时配置给注入层（send，主 → 注入层） */
  CONFIG: 'translate:config',
  /** 注入层上报日志（send，注入层 → 主） */
  LOG: 'translate:log',
} as const;

// ── 限额（集中在这里，方便调参；不要散落到各处） ───────────────────────

/** 单条消息翻译的字符上限：超长直接跳过，避免拖垮接口与费用失控 */
export const TRANSLATE_MAX_CHARS = 2000;

/** 译文去重缓存条数上限（FR-3.27）。内存 LRU，退出即失效，不落库 */
export const TRANSLATE_CACHE_LIMIT = 500;

/** 同时最多几条在翻译（FR-3.32 并发控制） */
export const TRANSLATE_CONCURRENCY = 3;

/** 单条翻译超时（FR-3.32） */
export const TRANSLATE_TIMEOUT_MS = 8_000;

/** 连续失败达到该次数后提示一次，之后不再刷屏（FR-3.32 失败降级） */
export const TRANSLATE_FAIL_ALERT_THRESHOLD = 3;

/** 译文节点的 DOM 标记，用于识别「这条已经插过了」 */
export const TRANSLATED_ATTR = 'data-cd-tr';

// ── 方向与请求 / 结果 ─────────────────────────────────────────────────

/**
 * 翻译方向。
 * - `in`：对方发来的消息 → 译文显示在原文下方
 * - `out`：我方输入的内容 → 译文替换输入框后发送
 */
export type TranslateDirection = 'in' | 'out';

export interface TranslateRequest {
  /** 请求序号：注入层自增，用于丢弃过期响应，防乱序回填（FR-3.26） */
  seq: number;
  /** 待翻译原文（已由注入层做过基础清理，主进程仍会再规范化一次） */
  text: string;
  direction: TranslateDirection;
}

/** 失败原因：只落日志与内部判断，不直接把细节抛给终端用户 */
export type TranslateErrorCode =
  | 'disabled'
  | 'too-long'
  | 'empty'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'quota'
  | 'bad-response'
  | 'aborted'
  | 'unknown';

export interface TranslateResult {
  seq: number;
  ok: boolean;
  /** ok = false 时为空串 */
  text: string;
  /** 命中去重缓存（没有真正发起请求） */
  cached?: boolean;
  error?: TranslateErrorCode;
}

// ── 语言标签 → 各渠道语言代码 ──────────────────────────────────────────

export type LangVariant = 'google' | 'deepl';

interface LangEntry {
  google: string;
  deepl: string;
}

/**
 * 语言代码表。键必须与 `LANGUAGE_OPTIONS`（translate-settings.ts）逐字一致，
 * 否则会静默回退到默认值 —— 这是最容易出错的地方。
 */
export const LANGUAGE_CODES: Readonly<Record<string, LangEntry>> = {
  中文: { google: 'zh-CN', deepl: 'ZH-HANS' },
  '英语（英国）': { google: 'en', deepl: 'EN-GB' },
  '英语（美国）': { google: 'en', deepl: 'EN-US' },
  日语: { google: 'ja', deepl: 'JA' },
  韩语: { google: 'ko', deepl: 'KO' },
  德语: { google: 'de', deepl: 'DE' },
  法语: { google: 'fr', deepl: 'FR' },
  西班牙语: { google: 'es', deepl: 'ES' },
  葡萄牙语: { google: 'pt', deepl: 'PT-BR' },
  俄语: { google: 'ru', deepl: 'RU' },
  阿拉伯语: { google: 'ar', deepl: 'AR' },
  泰语: { google: 'th', deepl: 'TH' },
  越南语: { google: 'vi', deepl: 'VI' },
};

/** 语言标签不在表里时的兜底：按中文处理，保证方向不会反 */
const FALLBACK_LANG: LangEntry = { google: 'zh-CN', deepl: 'ZH-HANS' };

/**
 * 把界面上的语言标签解析成具体渠道要的代码。
 *
 * 中文的简繁不是两种语言，而是同一个语言的两种写法：
 * 由设置项 `traditionalChinese` 决定，因此单独处理（FR-3.30）。
 */
export function resolveLangCode(
  label: string,
  variant: LangVariant,
  traditionalChinese = false,
): string {
  const entry = Object.prototype.hasOwnProperty.call(LANGUAGE_CODES, label)
    ? LANGUAGE_CODES[label]
    : undefined;
  const resolved = entry ?? FALLBACK_LANG;

  if (label === '中文' || !entry) {
    if (variant === 'google') return traditionalChinese ? 'zh-TW' : 'zh-CN';
    return traditionalChinese ? 'ZH-HANT' : 'ZH-HANS';
  }
  return resolved[variant];
}

// ── 文本判定与规范化 ──────────────────────────────────────────────────

/**
 * 中日韩字符判定：**出向翻译的触发条件**（FR-3.24）。
 * 纯英文 / 数字 / 表情 / 链接不应被翻译 —— 否则会把本来就要发的英文又翻一遍。
 */
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

export function containsCJK(text: string): boolean {
  return CJK_PATTERN.test(text);
}

/**
 * 文本规范化。两处会用到，且必须一致，否则「同一条消息」会被判成两条、
 * 去重缓存（FR-3.27）失效。
 *
 * 注意保留换行：多行消息折叠成一行会丢失语义，翻译质量会掉。
 */
export function normalizeTranslateText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^[\s\u200b]+|[\s\u200b]+$/g, '');
}

/** 是否值得送去翻译：空串、纯空白、纯符号都不必占用一次调用 */
export function isTranslatable(text: string): boolean {
  if (!text) return false;
  if (text.length > TRANSLATE_MAX_CHARS) return false;
  // 至少要有字母 / 数字 / 中日韩字符之一，纯标点（如 "..."）不发请求
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * 轻量文本指纹（FNV-1a 变体，双通道降低碰撞）。
 * 只用于本地去重缓存，不做安全用途。
 */
export function hashText(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * 去重缓存的键。
 * ⚠️ 必须带上语言对：同一句英文在「英→中」和「英→日」下译文不同，
 * 只用文本 hash 会串味。
 */
export function translateCacheKey(text: string, from: string, to: string): string {
  return `${from}>${to}|${hashText(text)}`;
}

// ── 渠道 ──────────────────────────────────────────────────────────────

export type TranslateProviderId = 'google-public' | 'deepl';

export interface TranslateProviderMeta {
  id: TranslateProviderId;
  /** 显示名，出现在日志与设置提示里 */
  label: string;
  /** 是否需要密钥 */
  needsKey: boolean;
}

export const TRANSLATE_PROVIDERS: Readonly<Record<TranslateProviderId, TranslateProviderMeta>> = {
  'google-public': {
    id: 'google-public',
    label: '内置免费通道',
    needsKey: false,
  },
  deepl: {
    id: 'deepl',
    label: 'DeepL',
    needsKey: true,
  },
};

/**
 * 绑定密钥用的本机文件名（FR-3.32）。
 *
 * 为什么要有这个东西：本版**不做自动更新**，密钥一旦内置进安装包，
 * 更换它就只能重发安装包让所有人重装 —— 在销售团队里不可执行。
 * 因此密钥支持用这个文件覆盖内置值，出问题时只需让使用者替换一个小文件。
 */
export const TRANSLATE_KEY_FILE = 'translate-key.json';

/** `<userData>/translate-key.json` 的结构 */
export interface TranslateKeyFile {
  /** 渠道 id；缺省时按一个已知值处理 */
  provider?: TranslateProviderId;
  /** 密钥本体 */
  key?: string;
  /** 可选：自建/代理端点覆盖 */
  endpoint?: string;
}

// ── 注入层需要的运行时配置快照 ─────────────────────────────────────────

/**
 * 从完整设置里派生出的「本版真正生效」的部分。
 *
 * 为什么不让注入层直接读 `WATranslateSettings`：
 *   1) 弹窗字段冻结，将来加字段时注入层不该跟着变；
 *   2) 注入脚本运行在隔离世界，能拿到的东西越少越好；
 *   3) 明确区分「本版生效的 10 个」与「仍然休眠的 11 个」。
 */
export interface TranslateRuntimeConfig {
  /** 总开关（FR-3.29）。关掉后注入层完整退出，不再动页面任何东西 */
  enabled: boolean;
  /** 入向自动翻译（FR-3.23） */
  autoReceive: boolean;
  /** 出向自动翻译（FR-3.24） */
  autoSend: boolean;
  /**
   * 出向逃生命令：按住 **Alt** 回车直发原文（FR-3.25，固定行为，不做开关）。
   *
   * ⚠️ 为什么不是需求稿里的 `Shift+Enter`：官方页面里 **Shift+Enter 是换行**。
   * 占用它等于剥夺使用者写多行消息的能力，是拿「逃生通道」换掉一个更常用的功能。
   * Alt+Enter 官方未占用，故改用它（已同步订正需求 FR-3.25）。
   */
  readonly bypassWithAlt: true;
  /** 实际生效的渠道（由密钥可用性决定，不由弹窗的「翻译渠道」决定） */
  providerId: TranslateProviderId;
  providerLabel: string;

  /** 对方语言标签（FR-3.23 入向的目标语言来源之一） */
  peerLanguage: string;
  /** 我方语言标签（FR-3.24 出向的目标语言） */
  myLanguage: string;
  /** 繁体开关（FR-3.30），默认已改为关 = 输出简体 */
  traditionalChinese: boolean;

  /** 译文样式（FR-3.30） */
  fontSize: number;
  textBgColor: string;
  textColor: string;
  /**
   * **单聊**译文的显示总闸（FR-3.30）。
   *
   * ⚠️ 语义澄清：该设置项与 `groupShow`（群聊显示）同轴，指的是
   * 「**单聊**里显不显示译文」，不是「显不显示我自己消息的译文」。
   * 本版关闭它在单聊里**既不显示、也不翻译**（不白花额度）。
   * 群聊因 FR-3.28 整段跳过，故 `groupShow` 休眠。
   */
  personalShow: boolean;
}

export function toRuntimeConfig(
  s: WATranslateSettings,
  providerId: TranslateProviderId,
): TranslateRuntimeConfig {
  return {
    enabled: s.enabled,
    autoReceive: s.autoReceive,
    autoSend: s.autoSend,
    bypassWithAlt: true,
    providerId,
    providerLabel: TRANSLATE_PROVIDERS[providerId].label,
    peerLanguage: s.peerLanguage,
    myLanguage: s.myLanguage,
    traditionalChinese: s.traditionalChinese,
    fontSize: s.fontSize,
    textBgColor: s.textBgColor,
    textColor: s.textColor,
    personalShow: s.personalShow,
  };
}

// ── 翻译可用性状态（主 → 渲染，供界面提示） ─────────────────────────────

export interface TranslateStatusPayload {
  /** 总开关是否打开 */
  enabled: boolean;
  /** 渠道是否可用（有实现 + 密钥齐备 + 未处于连续失败状态） */
  available: boolean;
  providerId: TranslateProviderId;
  providerLabel: string;
  /** 最近一次失败原因，供排障 */
  lastError?: TranslateErrorCode;
  /** 本次运行累计翻译成功条数 */
  successCount: number;
  /** 本次运行累计失败条数 */
  failureCount: number;
}

// ── 错误文案（注入层与主进程共用，避免两处写不一样） ─────────────────────

export const TRANSLATE_ERROR_HINT: Readonly<Record<TranslateErrorCode, string>> = {
  disabled: '翻译未启用',
  'too-long': '消息过长，已跳过翻译',
  empty: '内容为空',
  timeout: '翻译超时',
  network: '网络不可达',
  auth: '翻译服务密钥无效',
  quota: '翻译额度已用尽',
  'bad-response': '翻译服务返回异常',
  aborted: '请求已取消',
  unknown: '翻译失败',
};
