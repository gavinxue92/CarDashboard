/**
 * 工作台导航结构 —— 四大域、12 个功能。
 *
 * V1 只有「沟通 → WhatsApp」可用（enabled: true），其余全部为占位禁用态。
 * 这里同时是渲染层导航与占位页的单一来源。
 */

export interface FeatureItem {
  id: string;
  name: string;
  /** false = V1 占位禁用（悬停提示「即将上线」，点击不跳转） */
  enabled: boolean;
}

export interface DomainItem {
  id: string;
  name: string;
  features: FeatureItem[];
}

export const WHATSAPP_FEATURE_ID = 'whatsapp';

export const DOMAINS: readonly DomainItem[] = [
  {
    id: 'communicate',
    name: '沟通',
    features: [
      { id: WHATSAPP_FEATURE_ID, name: 'WhatsApp', enabled: true },
      { id: 'telegram', name: 'Telegram', enabled: false },
    ],
  },
  {
    id: 'acquire',
    name: '获客',
    features: [
      { id: 'pipeline', name: '获客管线', enabled: false },
      { id: 'global-search', name: '全球搜索', enabled: false },
      { id: 'social', name: '社媒获客', enabled: false },
      { id: 'email', name: '邮件获客', enabled: false },
    ],
  },
  {
    id: 'business',
    name: '业务',
    features: [
      { id: 'crm-task', name: 'CRM任务', enabled: false },
      { id: 'cost-calc', name: '成本精算', enabled: false },
      { id: 'showroom', name: '样板车展厅', enabled: false },
      { id: 'pi-contract', name: 'PI合同', enabled: false },
      { id: 'assets', name: '素材库', enabled: false },
    ],
  },
  {
    id: 'account',
    name: '账号',
    features: [{ id: 'settings-center', name: '设置中心', enabled: false }],
  },
];

/** 占位功能统一的悬停/点击提示文案（交互说明 IX-1.3） */
export const COMING_SOON_TEXT = '即将上线';

export const NAV_WIDTH = 216;
/** 右侧功能栏宽度（交互说明 5.5） */
export const RAIL_WIDTH = 56;
/** 自绘标题栏高度（交互说明 4.1 布局图） */
export const TITLE_BAR_HEIGHT = 54;
/** 内容区窄于此宽度时引导放大窗口（交互说明 IX-1.6） */
export const MIN_CONTENT_WIDTH = 900;
/** 加载超时（已确认决策 D2：10 秒） */
export const LOAD_TIMEOUT_MS = 10_000;
