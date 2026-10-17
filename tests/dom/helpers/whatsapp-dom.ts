/**
 * jsdom 下的 WhatsApp 页面替身与注入器测试台。
 *
 * 这里解决两件事：
 *
 * ① **造一个结构符合当前 `SELECTORS` 的页面**。
 *    注意边界：本文件造的是「按我们的选择器写出来的页面」，因此能验证**逻辑**
 *    （去重、跳过、阻断、自触发……），但**验证不了选择器与真实页面的匹配度** ——
 *    那需要真实登录态与境外网络，属于手工验收项。这个边界不能含糊，
 *    否则「固件测试全绿」会被误读成「真机上一定好使」。
 *
 * ② **把不可控的外部条件收成可控的开关**：
 *    · 翻译结果由 `setReply` 决定（无网络）；
 *    · `document.execCommand` 可切成「接受写入 / 假成功 / 不存在」三种形态，
 *      用来覆盖出向改写输入框的三条分支；
 *    · `KeyboardEvent.isTrusted` 在 jsdom 里恒为 false，而注入层刻意只处理真实
 *      按键事件，所以要把它改写成 true 才能模拟真人按回车。
 */
import { vi } from 'vitest';
import type { TranslateRequest, TranslateResult, TranslateRuntimeConfig } from '@cd/shared';
import { createInjector, type Injector, type InjectorOptions } from '@preload/wa-dom';

// ── 页面构造 ─────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; attrs?: Record<string, string> } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  return node;
}

/** 造一个「已打开会话」的页面骨架：`#main` + 消息列表 + footer 输入区 */
export function setupChat(opts: { group?: boolean } = {}): { main: HTMLElement; list: HTMLElement } {
  document.body.innerHTML = '';

  const main = el('div', { attrs: { id: 'main' } });
  const header = el('header');
  if (opts.group) header.appendChild(el('span', { attrs: { 'data-icon': 'default-group' } }));
  else header.appendChild(el('span', { attrs: { 'data-icon': 'default-user' } }));
  main.appendChild(header);

  // 消息列表容器：与真机一致用 `data-testid="conversation-panel-messages"`。
  // 旧骨架写的是 `div[role="application"]`，但真机快照实测该选择器已是 0 个 ——
  // 骨架必须贴合真实结构，否则「选择器测通」没有意义。
  const list = el('div', { attrs: { 'data-testid': 'conversation-panel-messages' } });
  main.appendChild(list);
  document.body.appendChild(main);

  const footer = el('footer');
  footer.appendChild(el('div', { class: 'footer-inner' }));
  document.body.appendChild(footer);

  return { main, list };
}

function messageRoot(): HTMLElement {
  return document.querySelector(
    '#main [data-testid="conversation-panel-messages"]',
  ) as HTMLElement;
}

/** 消息行序号：真机里每行 `data-id` / `data-testid` 前缀唯一，这里用递增数模拟 */
let msgSeq = 0;

/**
 * 造一条**消息行**（含方向标记），结构与真机快照一致：
 *
 * ```
 * div[data-testid="conv-msg-<id>"][data-id="<id>"]     ← 行（bubbleRow 命中它）
 *   └ div[data-testid="msg-container"]                  ← 内容容器（判定「真实消息行」的依据）
 *       ├ span[data-testid="tail-in|tail-out"]          ← 方向标记（可选，真机只在组首尾有）
 *       └ div
 *           └ div[data-testid="msg-meta"][role=button?] ← 出向的时间戳可点
 *           └ div.copyable-text
 *               └ span.selectable-text[dir]             ← 正文
 * ```
 *
 * 方向判定依据（`isIncomingRow`）在此被**如实重建**，因此这些用例测的是
 * 与真机同一套判据，而不是「只要 class 叫 message-in 就算对方消息」。
 */
function buildRow(
  input: 'in' | 'out',
  opts: { tail?: boolean },
): { row: HTMLElement; body: HTMLElement } {
  const id = `TEST${String(++msgSeq).padStart(4, '0')}AAAA`;
  const row = el('div', {
    attrs: { 'data-testid': `conv-msg-${id}`, 'data-id': id },
  });
  const container = el('div', { attrs: { 'data-testid': 'msg-container' } });

  // 方向标记：真机只在「连续气泡的首尾」才画 tail，所以这里是可选的。
  // 不画 tail 时，方向必须靠 msg-meta / aria-label 判出来 —— 这正是真机 20 条里
  // 另外 10 条的处境，也是这个 fixture 必须支持 `tail:false` 的原因。
  if (opts.tail !== false) {
    container.appendChild(
      el('span', { attrs: { 'data-testid': input === 'in' ? 'tail-in' : 'tail-out' } }),
    );
  }

  const inner = el('div');
  const meta = el('div', { attrs: { 'data-testid': 'msg-meta' } });
  if (input === 'out') {
    // 出向：时间戳可点（可查看送达详情）——真机最稳的单点判据
    meta.setAttribute('role', 'button');
    meta.appendChild(el('span', { attrs: { 'aria-label': 'You:' }, text: '10:00' }));
    meta.appendChild(el('span', { attrs: { 'aria-label': ' Read ' } }));
  } else {
    meta.appendChild(el('span', { attrs: { 'aria-label': '+86 138 0000 0000:' }, text: '10:00' }));
  }
  inner.appendChild(meta);

  const body = el('div', { class: 'copyable-text' });
  inner.appendChild(body);
  container.appendChild(inner);
  row.appendChild(container);

  (messageRoot() ?? document.querySelector('#main'))!.appendChild(row);
  return { row, body };
}

/** 把当前会话标记成群聊（在标题区放一个群图标即可） */
export function markGroupChat(): void {
  const header = document.querySelector('#main header') as HTMLElement;
  header.appendChild(el('span', { attrs: { 'data-icon': 'default-group' } }));
}

/** 首次访问时把输入区补上（有些用例只测入向，不需要输入框） */
export function ensureComposer(): HTMLElement {
  let footer = document.querySelector('footer');
  if (!footer) {
    footer = el('footer');
    document.body.appendChild(footer);
  }
  let box = document.querySelector(
    'footer div[contenteditable="true"][role="textbox"]',
  ) as HTMLElement | null;
  if (!box) {
    box = el('div', { attrs: { contenteditable: 'true', role: 'textbox' } });
    footer.appendChild(box);
  }
  return box;
}

/** 在输入区放一个发送按钮；返回它，供断言「是否真的发出去了」 */
export function ensureSendButton(): HTMLButtonElement {
  const footer = document.querySelector('footer') as HTMLElement;
  const existing = footer.querySelector('button[data-cd-test="send"]') as HTMLButtonElement | null;
  if (existing) return existing;
  const button = el('button', { attrs: { 'data-cd-test': 'send' } });
  button.appendChild(el('span', { attrs: { 'data-icon': 'send' } }));
  footer.appendChild(button);
  return button;
}

/**
 * 造一条**对方发来的**消息；`quote` 用于构造引用回复。
 *
 * @param opts.tail 是否画 `tail-in` 方向标记（默认画）。
 *   置 `false` 可复现真机里「连续气泡中间那条没有 tail」的情形 ——
 *   此时方向必须由 `msg-meta` 判出，用来守住兜底逻辑不退化。
 * @param opts.parent 指定挂载父节点（默认挂到消息列表）
 */
export function addIncoming(
  text: string,
  opts: { media?: boolean; quote?: string; parent?: HTMLElement; tail?: boolean } = {},
): HTMLElement {
  const { row, body } = buildRow('in', { tail: opts.tail });

  if (opts.quote !== undefined) {
    const quoted = el('div', { class: 'quoted-mention' });
    quoted.appendChild(el('span', { class: 'selectable-text', text: opts.quote }));
    body.appendChild(quoted);
  }
  if (opts.media) {
    body.appendChild(el('img', { attrs: { src: 'blob:https://web.whatsapp.com/abc' } }));
  }

  body.appendChild(el('span', { class: 'selectable-text', text, attrs: { dir: 'ltr' } }));
  if (opts.parent) opts.parent.appendChild(row);
  return row;
}

/** 我们自己发出的消息（本版不翻译，用于确认不会误伤） */
export function addOutgoing(text: string, opts: { tail?: boolean } = {}): HTMLElement {
  const { row, body } = buildRow('out', { tail: opts.tail });
  body.appendChild(el('span', { class: 'selectable-text', text, attrs: { dir: 'auto' } }));
  return row;
}

/** 取出所有我方译文节点 */
export function translationNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-cd-tr="translation"]'));
}

/** 取某个气泡下的译文文本 */
export function translationTextOf(bubble: Element): string | null {
  const node = bubble.querySelector('[data-cd-tr="translation"]');
  return node ? (node.textContent ?? '') : null;
}

// ── 按键 ─────────────────────────────────────────────────────────────
//
// 这里要处理一个 jsdom 的硬限制：**它无法产生 isTrusted = true 的事件**，
// 而 `isTrusted` 在 jsdom 里是事件实例上**不可配置的自有属性**
// （`Object.defineProperty` 直接抛 "Cannot redefine property"），改不了。
//
// 于是分两条路测，两条都不可省：
//   · `dispatchEnter` —— 派发**真实**事件。jsdom 里它必然 isTrusted = false，
//     正好等于「我们自己合成的回车」，用来验证注入层**不会把自己的事件拦下**
//     （否则改写完输入框后触发的发送会被自己吃掉，形成死锁）。
//   · `fakeEnter` —— 鸭子类型事件对象，只带注入层真正读到的字段，喂给
//     `handleKeyDown` 走完整逻辑。注入层只读 key / altKey / ctrlKey / metaKey /
//     target / isTrusted / preventDefault / stopImmediatePropagation，
//     因此这条路能忠实覆盖真实按键的全部判断分支。

/** 派发一个真实（但 isTrusted=false）的回车事件 */
export function dispatchEnter(
  target: Element,
  opts: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    altKey: Boolean(opts.alt),
    ctrlKey: Boolean(opts.ctrl),
    metaKey: Boolean(opts.meta),
  });
  target.dispatchEvent(event);
  return event;
}

export interface FakeKeyEvent extends KeyboardEvent {
  /** 记录是否被 preventDefault / stopImmediatePropagation */
  readonly calls: { preventDefault: number; stopImmediatePropagation: number };
}

/** 造一个「真人按下」的回车事件，直接喂给 handleKeyDown */
export function fakeEnter(
  target: Element,
  opts: { alt?: boolean; ctrl?: boolean; meta?: boolean; key?: string } = {},
): FakeKeyEvent {
  let prevented = 0;
  let stopped = 0;
  const event = {
    isTrusted: true,
    key: opts.key ?? 'Enter',
    altKey: Boolean(opts.alt),
    ctrlKey: Boolean(opts.ctrl),
    metaKey: Boolean(opts.meta),
    target,
    preventDefault: (): void => {
      prevented += 1;
    },
    stopImmediatePropagation: (): void => {
      stopped += 1;
    },
    get calls() {
      return { preventDefault: prevented, stopImmediatePropagation: stopped };
    },
  };
  return event as unknown as FakeKeyEvent;
}

// ── execCommand 的三种形态 ───────────────────────────────────────────

/** execCommand 的行为模式：官方组件正常接受 / 假成功（实际没写进去）/ 环境里不存在 */
export type ExecMode = 'accept' | 'fake-ok' | 'absent';

let execTarget: HTMLElement | null = null;

/** 指定「改写输入框」时 execCommand 应写入的目标 */
export function setExecTarget(node: HTMLElement | null): void {
  execTarget = node;
}

export function stubExecCommand(mode: ExecMode): void {
  if (mode === 'absent') {
    // 让它既不是自有属性也不是原型方法：调用时会抛 TypeError，注入层走回落分支
    delete (document as unknown as Record<string, unknown>).execCommand;
    return;
  }
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    writable: true,
    value: (command: string, _showUI?: boolean, value?: string): boolean => {
      if (command !== 'insertText') return false;
      if (mode === 'fake-ok') return true; // 声称成功，但一个字都没写进去
      if (!execTarget) return false;
      execTarget.textContent = value ?? '';
      return true;
    },
  });
}

// ── 注入器测试台 ─────────────────────────────────────────────────────

export interface Harness {
  injector: Injector;
  /** 收到的翻译请求（顺序即发生顺序） */
  calls: TranslateRequest[];
  /** 注入层上报的日志 */
  logs: Array<{ level: string; message: string }>;
  /** 换掉翻译结果的产出方式（模拟失败、超时、慢响应） */
  setReply(fn: (req: TranslateRequest) => TranslateResult | Promise<TranslateResult>): void;
  /** 断言用：某级别日志里的文本 */
  logText(level?: string): string[];
}

export function mountInjector(opts: {
  reply?: (req: TranslateRequest) => TranslateResult | Promise<TranslateResult>;
  injectorOptions?: InjectorOptions;
  /** 是否自动 start()（挂键盘监听与观察者） */
  autoStart?: boolean;
} = {}): Harness {
  const calls: TranslateRequest[] = [];
  const logs: Array<{ level: string; message: string }> = [];

  let reply =
    opts.reply ?? ((req: TranslateRequest): TranslateResult => ({ seq: req.seq, ok: true, text: `译:${req.text}` }));

  const injector = createInjector(
    {
      translate: async (req) => {
        calls.push(req);
        return reply(req);
      },
      log: (level, message) => {
        logs.push({ level, message });
      },
    },
    {
      // 测试里把两个延时压到很短：既能走真实的「异步 + 去抖」路径，又不拖慢用例。
      // 失败暂停保持生产值（60 秒）：用例里要断言「暂停后不再重试」，
      // 暂停窗口必须长于用例自身的执行时间，否则断言会随机翻车。
      scanDebounceMs: 5,
      sendVerifyDelayMs: 5,
      watchdogMs: 0,
      failPauseMs: 60_000,
      ...opts.injectorOptions,
    },
  );

  if (opts.autoStart !== false) injector.start();

  return {
    injector,
    calls,
    logs,
    setReply: (fn) => {
      reply = fn;
    },
    logText: (level) =>
      logs
        .filter((l) => !level || l.level === level)
        .map((l) => l.message),
  };
}

/** 启用总开关的运行时配置（与主进程下发的快照同构） */
export function enabledConfig(
  overrides: Partial<TranslateRuntimeConfig> = {},
): TranslateRuntimeConfig {
  return {
    enabled: true,
    autoReceive: true,
    autoSend: true,
    bypassWithAlt: true,
    providerId: 'google-public',
    providerLabel: '内置免费通道',
    peerLanguage: '英语（英国）',
    myLanguage: '中文',
    traditionalChinese: false,
    fontSize: 11,
    textBgColor: 'default',
    textColor: 'default',
    personalShow: true,
    ...overrides,
  };
}

/** 等待到条件成立（默认 1 秒）。比固定 sleep 稳，也比 fake timers 简单 */
export async function until(assert: () => void, timeout = 1000): Promise<void> {
  await vi.waitFor(assert, { timeout, interval: 5 });
}

/** 让去抖与微任务都跑完 */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}
