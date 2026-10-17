/**
 * 端到端用例的界面操作封装。
 *
 * 原则：**只包「怎么点」，不包「应该是什么」** —— 断言留在用例里，
 * 这样失败时一眼能看出是哪条业务规则被打破了，而不是某个辅助函数悄悄兜住了。
 */
import type { Page } from '@playwright/test';

/** 界面锚点集中一处，官方改版或我方改样式时只有一个地方要改 */
export const SEL = {
  sidebar: '.app-sidebar',
  domain: '.domain',
  feature: '.feature',
  featureLabel: '.feature__label',
  featureActive: '.feature--active',
  featureDisabled: '.feature--disabled',
  featureDot: '.feature__dot',
  featureMore: '.feature__more',
  featureMenu: '.feature-menu',
  featureMenuItems: '.feature-menu__item',
  featureMemo: '.feature__memo',
  rail: '.feature-rail',
  railBtn: '.rail-btn',
  railAttention: '.rail-btn--attention',
  railDot: '.rail-btn__dot',
  modal: '.modal',
  modalTitle: '.modal__title',
  modalClose: '.modal__close',
  titlebarRole: '.app-titlebar__role',
} as const;

/** 圆点的三个状态类（与 WaRunStatus 一一对应） */
export const DOT_CLASS: Record<string, string> = {
  loading: 'feature__dot--loading',
  running: 'feature__dot--running',
  error: 'feature__dot--error',
};

/** 打开翻译设置弹窗（右侧功能栏的「译」） */
export async function openTranslateDialog(page: Page): Promise<void> {
  await page.locator(`${SEL.railBtn}`, { hasText: '翻译设置' }).click();
  await page.waitForSelector(SEL.modal, { timeout: 10_000 });
  // 弹窗挂载后还要等一次 IPC 读设置，读完「保存修改」才可点
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll('.modal__footer .btn')].find((b) =>
        b.textContent?.includes('保存修改'),
      );
      return btn instanceof HTMLButtonElement && !btn.disabled;
    },
    undefined,
    { timeout: 10_000 },
  );
}

/** 取某一行的开关（按左侧标签精确匹配，避免「发送自动翻译」被「自动翻译」误伤） */
export function rowSwitch(page: Page, label: string) {
  return page.locator(`.tr-row:has(.tr-row__label:text-is("${label}")) .switch`);
}

/** 弹窗底部的按钮 */
export function dialogButton(page: Page, name: string) {
  return page.locator('.modal__footer button', { hasText: name });
}

/** 某个开关是否处于打开态（读 aria-checked，不猜 CSS） */
export async function isSwitchOn(page: Page, label: string): Promise<boolean> {
  return (await rowSwitch(page, label).getAttribute('aria-checked')) === 'true';
}

/** 当前运行状态圆点属于哪一档（读不到返回 null） */
export async function currentDotState(page: Page): Promise<string | null> {
  const cls = (await page.locator(SEL.featureDot).first().getAttribute('class')) ?? '';
  for (const [state, klass] of Object.entries(DOT_CLASS)) {
    if (cls.includes(klass)) return state;
  }
  return null;
}

/** 等功能栏的翻译提示点消失（保存启用后应立刻消失） */
export async function waitForRailAttentionGone(page: Page, timeoutMs = 5_000): Promise<boolean> {
  try {
    await page.locator(SEL.railAttention).waitFor({ state: 'detached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
