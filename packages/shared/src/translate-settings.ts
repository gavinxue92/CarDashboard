/**
 * 翻译设置契约 —— **字段冻结**（交互说明 7.4 / FR-3.21）。
 *
 * ⚠️ 冻结含义：
 * 弹窗的字段与结构不得因渠道变化而改动 —— 换渠道只替换实现（`FR-3.31`）。
 *
 * 🔴 V1.4 修订（决策 D6 → D7，2026-10-14）：
 * 弹窗已从「接口预留壳」升格为**真实生效的配置界面**。本版实际生效 10 个字段
 * （见 `translate.ts` 的 `TranslateRuntimeConfig`），其余 11 个仍休眠。
 *
 * 字段与弹窗五组控件一一对应（交互说明 7.4 控件清单与默认值表）。
 */

/** 基础设置 · 账号备注 */
export const REMARK_PLACEHOLDER = 'Gavin';

export interface WATranslateSettings {
  // ── 基础设置 ────────────────────────────────────────────────
  /** 账号备注（文本）。与左侧导航的账号备注**共享同一份数据**（交互说明 7.4 注） */
  remark: string;
  /** 是否启用（开关），默认关 */
  enabled: boolean;
  /** 账号分组（下拉），默认空 = 未选择 */
  group: string;
  /** 顺序（步进），默认 1 */
  order: number;

  // ── 渠道与语言 ──────────────────────────────────────────────
  /** 翻译渠道（下拉），默认 DeepL */
  channel: string;
  /** 对方语言（下拉），默认 英语（英国） */
  peerLanguage: string;
  /** 我的语言（下拉），默认 中文 */
  myLanguage: string;

  // ── 常用配置 ────────────────────────────────────────────────
  autoReceive: boolean;
  autoSend: boolean;
  groupShow: boolean;
  groupAuto: boolean;
  personalHistory: boolean;
  groupHistory: boolean;
  traditionalChinese: boolean;
  sendConfirm: boolean;

  // ── 显示样式 ────────────────────────────────────────────────
  /** 字体大小（步进），默认 11 */
  fontSize: number;
  /** 译文背景（颜色），默认 default = 默认色 */
  textBgColor: string;
  /** 译文颜色（颜色），默认 default = 默认色 */
  textColor: string;
  /**
   * 个人（单聊）翻译显示（开关），默认开。
   * ⚠️ 与 `groupShow`（群聊显示）同轴：指「单聊里显不显示译文」，
   * 不是「显不显示我自己消息的译文」。见 `translate.ts` 的 `personalShow` 注释。
   */
  personalShow: boolean;

  // ── 智能与通知 ──────────────────────────────────────────────
  recommendReply: boolean;
  messageNotify: boolean;
  /** 推荐回复条数（步进），默认 5 */
  recommendCount: number;
}

/** 默认值（与交互说明 7.4 表格逐项对齐） */
export const DEFAULT_WA_TRANSLATE_SETTINGS: WATranslateSettings = {
  remark: '',
  enabled: false,
  group: '',
  order: 1,

  channel: 'DeepL',
  peerLanguage: '英语（英国）',
  myLanguage: '中文',

  autoReceive: true,
  autoSend: true,
  groupShow: false,
  groupAuto: false,
  personalHistory: false,
  groupHistory: false,
  // V1.4 修订（FR-3.30 / 需求 5.3.7）：原值 true = 默认输出繁体，与「译成中文」的
  // 直觉冲突，本版改为 false（简体）。开关本身保留在弹窗里，使用者可自行切回繁体。
  traditionalChinese: false,
  sendConfirm: false,

  fontSize: 11,
  textBgColor: 'default',
  textColor: 'default',
  personalShow: true,

  recommendReply: true,
  messageNotify: true,
  recommendCount: 5,
};

// ── 下拉与颜色候选 ─────────────────────────────────────────────

export const TRANSLATE_CHANNEL_OPTIONS: readonly string[] = [
  'DeepL',
  'Google',
  'Microsoft',
  '有道',
];

export const LANGUAGE_OPTIONS: readonly string[] = [
  '中文',
  '英语（英国）',
  '英语（美国）',
  '日语',
  '韩语',
  '德语',
  '法语',
  '西班牙语',
  '葡萄牙语',
  '俄语',
  '阿拉伯语',
  '泰语',
  '越南语',
];

/** 账号分组；空文案由 UI 显示为「请选择」 */
export const ACCOUNT_GROUP_OPTIONS: readonly string[] = [
  '默认分组',
  '区域 A',
  '区域 B',
  '重点客户',
];

export interface ColorOption {
  value: string;
  label: string;
  swatch: string;
}

export const TRANSLATE_TEXT_BG_OPTIONS: readonly ColorOption[] = [
  { value: 'default', label: '默认色', swatch: '#d9fdd3' },
  { value: '#ffffff', label: '白色', swatch: '#ffffff' },
  { value: '#e7f3ff', label: '浅蓝', swatch: '#e7f3ff' },
  { value: '#fff3cd', label: '浅黄', swatch: '#fff3cd' },
  { value: '#ffe6e6', label: '浅粉', swatch: '#ffe6e6' },
  { value: '#e6ffe6', label: '浅绿', swatch: '#e6ffe6' },
];

export const TRANSLATE_TEXT_COLOR_OPTIONS: readonly ColorOption[] = [
  { value: 'default', label: '默认色', swatch: '#111b21' },
  { value: '#111b21', label: '深黑', swatch: '#111b21' },
  { value: '#0b5394', label: '深蓝', swatch: '#0b5394' },
  { value: '#1a7f37', label: '深绿', swatch: '#1a7f37' },
  { value: '#a4262c', label: '深红', swatch: '#a4262c' },
  { value: '#6a1b9a', label: '紫色', swatch: '#6a1b9a' },
];

/** 步进器取值范围（字体大小 11 为文档默认值，故下界取 8） */
export const STEP_RANGES = {
  order: { min: 1, max: 99 },
  fontSize: { min: 8, max: 24 },
  recommendCount: { min: 1, max: 20 },
} as const;

/** 保存结果（FR-3.21 契约：save(cfg) → Promise<{ok:boolean}>） */
export interface SaveSettingsResult {
  ok: boolean;
  /** 配置只写在**本机**缓存里（本版无服务端），不代表「不生效」——
   *  V1.4 起保存会即时作用于翻译行为（FR-3.29） */
  localOnly: boolean;
}

const boolKeys = [
  'enabled',
  'autoReceive',
  'autoSend',
  'groupShow',
  'groupAuto',
  'personalHistory',
  'groupHistory',
  'traditionalChinese',
  'sendConfirm',
  'personalShow',
  'recommendReply',
  'messageNotify',
] as const satisfies readonly (keyof WATranslateSettings)[];

const numKeys = ['order', 'fontSize', 'recommendCount'] as const satisfies readonly (keyof WATranslateSettings)[];

const strKeys = [
  'remark',
  'group',
  'channel',
  'peerLanguage',
  'myLanguage',
  'textBgColor',
  'textColor',
] as const satisfies readonly (keyof WATranslateSettings)[];

/**
 * 把磁盘上读到的任意数据规范化为一份完整配置。
 *
 * 存在意义：本地配置文件可能来自旧版本或被手工改坏，缺字段直接用会导致 UI 报错。
 * 未知字段丢弃、缺失字段补默认值、类型不符回退默认值。
 */
export function normalizeTranslateSettings(input: unknown): WATranslateSettings {
  const out: WATranslateSettings = { ...DEFAULT_WA_TRANSLATE_SETTINGS };
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;

  for (const k of strKeys) {
    const v = raw[k];
    if (typeof v === 'string') out[k] = v;
  }
  for (const k of boolKeys) {
    const v = raw[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  for (const k of numKeys) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const range = STEP_RANGES[k];
      out[k] = Math.min(range.max, Math.max(range.min, Math.round(v)));
    }
  }
  return out;
}
