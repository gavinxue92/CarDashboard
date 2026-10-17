/**
 * 工作台状态（渲染层）。
 *
 * 不引入 Pinia：本版状态量很小（当前模块、运行状态、备注、弹窗开关），
 * 一个模块级 reactive 单例足够，少一个依赖就少一处升级负担。
 */
import { computed, reactive } from 'vue';
import {
  DOMAINS,
  LOAD_TIMEOUT_MS,
  MIN_CONTENT_WIDTH,
  NETWORK_ERROR_CODES,
  WA_STATUS_LABEL,
  WHATSAPP_FEATURE_ID,
  normalizeTranslateSettings,
  type AppInfo,
  type LogLevel,
  type ToastType,
  type WATranslateSettings,
  type WaRunStatus,
} from '@cd/shared';

/** Toast 文案单一来源（交互说明 7.2 文案表） */
export const TOAST_TEXT = {
  reloaded: { message: '页面已重新加载', type: 'success' },
  unbound: { message: '已解除绑定，请用手机扫码重新登录', type: 'success' },
  reconnected: { message: '连接已恢复', type: 'success' },
  reconnectFailed: { message: '连接仍不稳定，可尝试重新加载', type: 'warning' },
  viewCrashed: { message: '页面异常，已自动恢复', type: 'warning' },
  memoSaved: { message: '账号备注已保存', type: 'success' },
  /** V1.4：设置已真实生效（原文案「功能将在后续版本生效」已作废） */
  settingsSaved: { message: '翻译设置已保存，即时生效', type: 'success' },
  /** 保存异常兜底：不能静默失败，否则「开关打开了却没反应」无从排查 */
  settingsSaveFailed: { message: '设置保存失败，请重启客户端后重试', type: 'warning' },
  /** 首次进入模块且翻译未启用时的引导（不反复弹） */
  translateOffGuide: {
    message: '翻译未启用 · 点击右侧「译」开启自动翻译',
    type: 'warning',
  },
} as const satisfies Record<string, { message: string; type: ToastType }>;

export type DialogKind = 'none' | 'translate' | 'unbind' | 'memo';

interface WorkspaceState {
  /** 当前选中的功能 id（V1 只有 WhatsApp 可用） */
  activeFeatureId: string;
  /** 内嵌页面运行状态（不是账号在线状态，见交互说明 9.1） */
  waStatus: WaRunStatus;
  waStatusAt: number;
  waRetryCount: number;
  /** 三次自动重连均失败 */
  waRetryExhausted: boolean;
  /** 最近一次加载失败的 Chromium 错误码，用于区分故障文案 */
  waErrorCode: number | null;
  /** 本轮加载是否已超过 10 秒（FR-3.8） */
  waLoadTimedOut: boolean;
  /** 是否已经创建过内嵌视图（决定「常驻后台」是否已生效） */
  waActivated: boolean;
  /** 账号备注（FR-3.7） */
  memo: string;
  /** 内容区宽度，用于窄窗口引导（IX-1.6） */
  contentWidth: number;
  /** 当前打开的弹窗 */
  dialog: DialogKind;
  /** 运行环境信息（排障页用） */
  appInfo: AppInfo | null;

  // ── 翻译（V1.4，需求 5.3.7）─────────────────────────────────────
  /** 翻译总开关（FR-3.29）。关着时功能栏给提示 */
  translateEnabled: boolean;
  /** 翻译渠道是否可用（FR-3.32：密钥失效 / 连续失败时为 false） */
  translateAvailable: boolean;
  /** 当前实际生效的渠道显示名（由主进程按密钥可用性决定） */
  translateProviderLabel: string;
  /** 「翻译未启用」引导是否已弹过（每次启动只引导一次，不反复打扰） */
  translateGuideShown: boolean;
}

const state = reactive<WorkspaceState>({
  activeFeatureId: WHATSAPP_FEATURE_ID,
  waStatus: 'loading',
  waStatusAt: 0,
  waRetryCount: 0,
  waRetryExhausted: false,
  waErrorCode: null,
  waLoadTimedOut: false,
  waActivated: false,
  memo: '',
  contentWidth: 0,
  dialog: 'none',
  appInfo: null,
  translateEnabled: false,
  translateAvailable: false,
  translateProviderLabel: '',
  translateGuideShown: false,
});

const bridge = window.cd;

let loadTimer: number | null = null;
/** 手动重新加载后，等下一次「运行中」时补一条提示（交互说明 7.2） */
let pendingReloadToast = false;
let initialized = false;

// ── 派生状态 ───────────────────────────────────────────────────────────

/** 内容区过窄：官方页面在窄窗口下体验很差，我方提前拦截（IX-1.6） */
const narrowWindow = computed(() => state.contentWidth > 0 && state.contentWidth < MIN_CONTENT_WIDTH);

/** 内嵌区是否被我方叠加层遮挡 → 主进程据此隐藏原生视图 */
const embedOccluded = computed(
  () =>
    state.activeFeatureId !== WHATSAPP_FEATURE_ID ||
    narrowWindow.value ||
    state.dialog !== 'none',
);

/** M4 文案分支：网络类错误 vs 页面类错误（交互说明 5.3） */
const isNetworkIssue = computed(
  () => state.waErrorCode !== null && NETWORK_ERROR_CODES.includes(state.waErrorCode),
);

/** 当前选中功能 */
const activeFeature = computed(
  () =>
    DOMAINS.flatMap((d) => d.features).find((f) => f.id === state.activeFeatureId) ?? null,
);

const waStatusLabel = computed(() => WA_STATUS_LABEL[state.waStatus]);

/** M4 是否呈现：只有「连接异常」才出故障覆盖层 */
const showFaultOverlay = computed(() => state.waStatus === 'error');
/** M1 是否呈现 */
const showLoading = computed(() => state.waStatus === 'loading');
/** O3 断线浮条 */
const showDisconnectBar = computed(() => state.waStatus === 'error');

/**
 * 功能栏「翻译设置」是否需要提示。
 * 两种情况都值得提醒：总开关没开、渠道不可用（密钥失效或连续失败）。
 */
const translateNeedsAttention = computed(
  () => !state.translateEnabled || !state.translateAvailable,
);

/** 功能栏提示文案（悬停显示） */
const translateAttentionText = computed(() => {
  if (!state.translateEnabled) return '翻译未启用 · 点击开启';
  if (!state.translateAvailable) return '翻译服务暂时不可用 · 点击查看设置';
  return '';
});

// ── 动作 ───────────────────────────────────────────────────────────────

export async function initWorkspace(): Promise<void> {
  if (initialized) return;
  initialized = true;

  bridge.wa.onStatus((payload) => {
    const prev = state.waStatus;
    state.waStatus = payload.status;
    state.waStatusAt = payload.at;
    state.waRetryCount = payload.retryCount ?? 0;
    state.waRetryExhausted = Boolean(payload.retryExhausted);
    state.waErrorCode = payload.errorCode ?? null;

    if (payload.status === 'loading') {
      armLoadTimeout();
    } else {
      clearLoadTimeout();
    }

    if (payload.status === 'running') {
      if (prev === 'error') toast(TOAST_TEXT.reconnected);
      else if (pendingReloadToast) toast(TOAST_TEXT.reloaded);
      pendingReloadToast = false;
    }

    if (payload.status === 'error' && payload.retryExhausted) {
      toast(TOAST_TEXT.reconnectFailed);
    }
  });

  // 翻译可用性推送（FR-3.32）：主进程按密钥与失败情况判定，界面据此提示
  bridge.translate.onStatus((payload) => {
    state.translateEnabled = payload.enabled;
    state.translateAvailable = payload.available;
    state.translateProviderLabel = payload.providerLabel;
  });

  try {
    const [memo, appInfo, settings] = await Promise.all([
      bridge.memo.get(),
      bridge.appInfo(),
      bridge.settings.get(),
    ]);
    state.memo = memo;
    state.appInfo = appInfo;
    state.translateEnabled = settings.enabled;
    log(
      'info',
      'renderer',
      `客户端 v${appInfo.appVersion}｜分区 ${appInfo.waPartitionId}｜代理 ${appInfo.waProxy || '直连'}｜翻译 ${settings.enabled ? '已启用' : '未启用'}`,
    );
  } catch (err) {
    log('error', 'renderer', `初始化读取本地数据失败：${String(err)}`);
  }

  // 启动即进入 WhatsApp 模块（本版无登录页，FR-1.2 改口径）
  void ensureWaActivated();
}

/** 切换模块；占位功能不可点（IX-1.2） */
export function selectFeature(featureId: string): void {
  const feature = DOMAINS.flatMap((d) => d.features).find((f) => f.id === featureId);
  if (!feature || !feature.enabled) return;
  state.activeFeatureId = featureId;
  if (featureId === WHATSAPP_FEATURE_ID) void ensureWaActivated();
}

/**
 * 确保内嵌视图已创建并开始加载。
 * 重复调用无副作用——已加载过就保持常驻，不重新拉取（决策 D3）。
 */
export async function ensureWaActivated(): Promise<void> {
  if (state.waActivated) return;
  state.waActivated = true;
  try {
    await bridge.wa.activate();
  } catch (err) {
    log('error', 'renderer', `激活 WhatsApp 模块失败：${String(err)}`);
  }
  // 翻译默认是关的（避免未经确认就把客户消息送到第三方翻译服务），
  // 首次进模块引导一次；之后不再打扰，避免每次启动都弹。
  if (!state.translateEnabled && !state.translateGuideShown) {
    state.translateGuideShown = true;
    toast(TOAST_TEXT.translateOffGuide);
  }
}

/** 重新加载（⋯ 菜单 / 故障覆盖层 / 浮条按钮共用） */
export async function reloadWa(): Promise<void> {
  state.dialog = 'none';
  pendingReloadToast = true;
  try {
    await bridge.wa.reload();
  } catch (err) {
    pendingReloadToast = false;
    log('error', 'renderer', `重新加载失败：${String(err)}`);
  }
}

/** 解除绑定：清空本机该分区登录态（FR-3.17 / 3.18） */
export async function unbindWa(): Promise<void> {
  state.dialog = 'none';
  try {
    await bridge.wa.unbind();
    toast(TOAST_TEXT.unbound);
    // 备注保留：解绑不等于换号，用户自己决定要不要改（IX-4.3）
  } catch (err) {
    log('error', 'renderer', `解除绑定失败：${String(err)}`);
  }
}

export function openDialog(kind: Exclude<DialogKind, 'none'>): void {
  state.dialog = kind;
}

export function closeDialog(): void {
  state.dialog = 'none';
}

export async function saveMemo(value: string): Promise<void> {
  const memo = value.trim();
  try {
    await bridge.memo.set(memo);
    state.memo = memo;
    closeDialog();
    toast(TOAST_TEXT.memoSaved);
  } catch (err) {
    log('error', 'renderer', `保存账号备注失败：${String(err)}`);
  }
}

export async function fetchTranslateSettings(): Promise<WATranslateSettings> {
  try {
    return await bridge.settings.get();
  } catch (err) {
    log('error', 'renderer', `读取翻译设置失败：${String(err)}`);
    return normalizeTranslateSettings(undefined);
  }
}

export async function saveTranslateSettings(cfg: WATranslateSettings): Promise<void> {
  // ⚠️ 必须先拍平成**普通对象**再跨 IPC。
  //
  // 弹窗里传进来的是 `ref` 包装后的 Vue 响应式代理（Proxy），而 IPC 的结构化克隆
  // 不支持 Proxy，会抛 `Error: An object could not be cloned.`。
  // 后果极具迷惑性：**点击保存毫无反应**（弹窗不关、没有提示、主进程日志里
  // 什么都没有），只有渲染层日志留下这一行错误。V1.4 真机测试就是这样栽的。
  //
  // `normalizeTranslateSettings` 顺带完成白名单过滤：只把契约里已知的字段、且类型
  // 正确的值送出去，未知字段一律丢弃 —— 与「不假设对面传进来的一定合法」一致。
  const plain = normalizeTranslateSettings(cfg);
  try {
    const result = await bridge.settings.save(plain);
    if (!result.ok) {
      log('warn', 'renderer', '翻译设置保存返回失败');
      toast(TOAST_TEXT.settingsSaveFailed);
      return;
    }
    // 备注在弹窗与导航两处共享同一份数据（交互说明 7.4 注）
    state.memo = plain.remark.trim();
    // V1.4：保存即时生效（FR-3.29）——主进程会把新配置推给注入脚本，
    // 这里同步本地镜像，功能栏的「未启用」提示才能立刻消失。
    state.translateEnabled = plain.enabled;
    closeDialog();
    toast(TOAST_TEXT.settingsSaved);
  } catch (err) {
    // 保存失败必须让使用者看得见：静默失败会让「开关明明打开了却没反应」
    // 变成一个无从下手的排查题（本版没有第三方监控，只能靠提示 + 本地日志）。
    log('error', 'renderer', `保存翻译设置失败：${String(err)}`);
    toast(TOAST_TEXT.settingsSaveFailed);
  }
}

export async function resetTranslateSettings(): Promise<WATranslateSettings> {
  try {
    await bridge.settings.reset();
  } catch (err) {
    log('error', 'renderer', `恢复默认翻译设置失败：${String(err)}`);
  }
  const next = await fetchTranslateSettings();
  state.translateEnabled = next.enabled;
  return next;
}

export function setContentWidth(width: number): void {
  state.contentWidth = Math.round(width);
}

export function toast(payload: { message: string; type: ToastType }): void {
  try {
    bridge.toast(payload);
  } catch {
    // 提示失败不影响主流程
  }
}

export function log(level: LogLevel, scope: string, message: string): void {
  try {
    bridge.log({ level, scope, message });
  } catch {
    // 忽略
  }
}

// ── 内部 ───────────────────────────────────────────────────────────────

function armLoadTimeout(): void {
  clearLoadTimeout();
  state.waLoadTimedOut = false;
  loadTimer = window.setTimeout(() => {
    loadTimer = null;
    if (state.waStatus !== 'loading') return;
    state.waLoadTimedOut = true;
    log('warn', 'renderer', `内嵌页面 ${LOAD_TIMEOUT_MS}ms 未加载完成`);
  }, LOAD_TIMEOUT_MS);
}

function clearLoadTimeout(): void {
  if (loadTimer !== null) {
    window.clearTimeout(loadTimer);
    loadTimer = null;
  }
  state.waLoadTimedOut = false;
}

export const workspace = {
  state,
  narrowWindow,
  embedOccluded,
  isNetworkIssue,
  activeFeature,
  waStatusLabel,
  showFaultOverlay,
  showLoading,
  showDisconnectBar,
  translateNeedsAttention,
  translateAttentionText,
};
