/**
 * WhatsApp Web 注入脚本的 **DOM 逻辑层**（需求 5.3.7 / FR-3.22 ~ FR-3.30）。
 *
 * 为什么把它从 `wa-inject.ts` 里拆出来：
 * 注入脚本是一条真实存在的功能链路（读消息、插译文、改写输入框、拦截发送），
 * 而它此前是**一个模块级副作用的文件**——一 import 就启动、状态散在模块作用域里，
 * 除了真机手动测之外没有任何办法验证。拆成 `createInjector(port)` 之后：
 *   · 与主进程的通信收敛成一个 `InjectorPort` 端口对象（生产环境传 `ipcRenderer`，
 *     测试环境传替身）——于是**整条 DOM 逻辑可以在 jsdom 下被真实测到**；
 *   · 所有状态收进闭包，用例之间天然隔离，不会互相污染；
 *   · 时序常量可注入，测试不必和真实延时赛跑。
 *
 * 纪律不变（与 `wa-inject.ts` 头部的四条一致）：
 *   1) 只做增量：不轮询官方 DOM、不重写官方结构，只插入我们自己的节点；
 *   2) 出向失败必须阻断（FR-3.26）：宁可发不出去，也不能把中文原文发出去；
 *   3) 选择器集中在 `SELECTORS` 里，改版时只改这一处；
 *   4) 不落库：译文只存在内存里，进程退出即消失（需求 6.2）。
 *
 * 本文件**不 import electron**，也不 import 任何 Node 内置模块 ——
 * 这样它既能被 jsdom 测试直接导入，也能被沙箱 preload 安全打包。
 */
import {
  TRANSLATED_ATTR,
  containsCJK,
  isTranslatable,
  normalizeTranslateText,
  type TranslateRequest,
  type TranslateResult,
  type TranslateRuntimeConfig,
} from '@cd/shared';

// ══════════════════════════════════════════════════════════════════════
// 一、选择器集中配置 —— WhatsApp 改版时**只需要改这一段**
// ══════════════════════════════════════════════════════════════════════

/**
 * 每个键都给多个候选：官方改版通常是「换一个属性、留一个旧的」，
 * 多候选能扛过一两次渐进改版，而不是一次性全线失效。
 */
export const SELECTORS = {
  /** 会话主区域（只在会话打开时存在） */
  main: ['#main'],
  /**
   * 消息列表容器。
   *
   * ✅ 2026-10-14 用真机快照（`tests/dom/fixtures/whatsapp/real-chat-2026-10-14.html`）
   * 定稿：`[data-testid="conversation-panel-messages"]` 是官方给消息列表的
   * 稳定语义标记；旧的 `div[role="application"]` 在真机已是 **0 个**（已死），
   * `.copyable-area` 命中数不稳定，只作兜底。
   */
  messageRoot: [
    '#main [data-testid="conversation-panel-messages"]',
    '#main .copyable-area',
    '#main',
  ],
  /**
   * 消息行（**双方都包含**，方向由 `isIncomingRow()` 判定）。
   *
   * ✅ 2026-10-14 快照实测：官方给每条消息行都挂了
   * `data-testid="conv-msg-<dataId>"`（与 `data-id` 同值）。
   *
   * ⚠️ 但**只匹配 `conv-msg-` 会把占位行一起捞进来**：虚拟列表为已滚出屏的
   * 消息保留同前缀的空壳行（真机 28 个前缀命中里只有 20 个是真实消息，
   * 另外 8 个 `textContent` 为空）。因此用 `:has()` 收敛为
   * 「含 `msg-container` 的行」——`msg-container` 是真机 20/20 都有的内容容器标记。
   *
   * ⚠️ 旧的 `.message-in` / `[class*="message-in"]` 在真机已全部为 0
   * （官方早已换成哈希类名），保留在末尾只为兜住极老版本，不再是主路径。
   */
  bubbleRow: [
    '[data-testid^="conv-msg-"]:has([data-testid="msg-container"])',
    '[data-testid^="conv-msg-"]',
    '#main [data-id]:has([data-testid="msg-container"])',
  ],
  /**
   * @deprecated 旧口径的「对方气泡」选择器，真机已失效。
   * 保留导出只为兼容既有测试与诊断探针；业务路径请改用 `bubbleRow` + `isIncomingRow()`。
   */
  bubbleIn: ['.message-in', '[class*="message-in"]'],
  /**
   * 气泡框（圆角背景那一层）。真机 20/20 都有。
   *
   * 用途：把译文 / 原文节点**收敛到气泡框内部**再插，避免插到气泡外面
   * （消息行 `conv-msg-*` 比气泡框大一圈，直接对它插会跑到框外）。
   */
  bubbleBox: ['[data-testid="msg-container"]', '.copyable-area'],
  /** 消息正文文本 */
  textSpan: ['span.selectable-text', '.copyable-text span[dir]'],
  /** 引用回复区域：里面的文本不是「新消息正文」，要排除 */
  quoted: ['.quoted-mention', '[data-testid="quoted-message"]'],
  /** 输入框 */
  composer: [
    'footer div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"][data-tab="10"]',
    'footer div[contenteditable="true"][data-tab="6"]',
    'footer div[contenteditable="true"]',
  ],
  /** 发送按钮（点它比派发回车更可靠） */
  sendButton: [
    'footer span[data-icon="send"]',
    'footer button[aria-label="Send"]',
    'footer [data-testid="send"]',
  ],
  /** 会话标题区：用于判断是不是群聊 */
  header: ['#main header'],
  /** 群聊标志物（任一命中即判定为群聊 → 按 FR-3.28 整段跳过） */
  groupMark: [
    '[data-icon="default-group"]',
    '[data-icon="group"]',
    '[data-icon="default-user-group"]',
    '[data-icon="group-info"]',
    '[data-icon="default-group-refreshed"]',
  ],
  /** 输入区容器（对它内部的变动不做重扫，否则打字会把扫描打满） */
  footer: ['footer'],
} as const;

/** 富媒体标志物：气泡里出现这些东西就按 FR-3.28 跳过（图片/语音/文件/贴纸/位置等） */
export const MEDIA_MARKS = [
  'video',
  'audio',
  'img[src^="blob:"]',
  'img[src^="data:"]',
  '[data-icon="audio-play"]',
  '[data-icon="media-download"]',
  '[data-icon="media-play"]',
  '[data-icon="document"]',
  '[data-icon="status-sticker"]',
  '[data-icon="location"]',
  '[data-icon="contact"]',
  '[data-icon="default-document"]',
];

/**
 * 气泡候选命中统计用的探针列表（只在诊断日志里用，不参与业务匹配）。
 * 真机选择器失配时，这组数字能直接告诉我们新结构长什么样。
 *
 * 2026-10-14 快照定稿后，`conv-msg-` / `msg-container` 已成为**主路径**选择器；
 * 这里仍把它们列入统计，是为了在失配时能一眼看出「是主锚点没了，
 * 还是方向判据失效了」——两者的修法完全不同。
 */
const BUBBLE_PROBES = [
  '[data-testid^="conv-msg-"]',
  '[data-testid="msg-container"]',
  '.message-in',
  'div[data-id]',
  '[role="row"]',
  '[data-testid="tail-in"]',
  '[data-testid="tail-out"]',
];

/**
 * 🔎 定位「消息列表容器」：在 `#main` 下逐层统计哪一层的子元素最像消息行。
 *
 * 这是 2026-10-14 第三次真机后加的**换角度探针**。前两轮都在
 * `messageRoot`（命中 `.copyable-area`）**内部**找气泡，结果候选全是 0/1，
 * 说明方向可能从一开始就错了 —— 真正的消息列表也许根本不在 `.copyable-area` 里。
 *
 * 判据：一条消息行的典型特征是「恰好包含 1~3 个 `span[dir]` 正文节点」，
 * 且同一父节点下有**多个**这样的兄弟节点（一个会话有多条消息）。
 * 因此从 `#main` 开始做广度优先，找出「有最多符合特征子节点」的那一层，
 * 它就是要找的消息列表容器 —— 由数据决定，而不是继续猜选择器。
 */
function findListContainer(main: Element): { el: Element; count: number; path: string } | null {
  const isRowLike = (el: Element): boolean => {
    const texts = el.querySelectorAll('span[dir]');
    return texts.length > 0 && texts.length <= 3;
  };

  let best: { el: Element; count: number; path: string } | null = null;
  const queue: Array<{ el: Element; depth: number; path: string }> = [
    { el: main, depth: 0, path: '#main' },
  ];
  let visited = 0;

  while (queue.length > 0 && visited < 300) {
    const item = queue.shift()!;
    visited += 1;
    if (item.depth > 6) continue;

    const children = Array.from(item.el.children);
    const rowLike = children.filter(isRowLike);
    if (rowLike.length > (best?.count ?? 0)) {
      best = { el: item.el, count: rowLike.length, path: item.path };
    }
    for (const child of rowLike.slice(0, 3)) {
      const cls = Array.from(child.classList).slice(0, 2).join('.');
      const role = child.getAttribute('role');
      const id = child.getAttribute('data-id');
      queue.push({
        el: child,
        depth: item.depth + 1,
        path:
          `${item.path} > ${child.tagName.toLowerCase()}` +
          `${cls ? `.${cls}` : ''}${role ? `[role=${role}]` : ''}${id ? `[data-id=${id}]` : ''}`,
      });
    }
    // 同时把当前层的直接子节点也纳入，避免「消息行不在 rowLike 分支下」
    for (const child of children.slice(0, 8)) {
      if (rowLike.includes(child)) continue;
      queue.push({
        el: child,
        depth: item.depth + 1,
        path: `${item.path} > ${child.tagName.toLowerCase()}`,
      });
    }
  }
  return best;
}

function dumpListContainer(main: Element): string {
  const best = findListContainer(main);
  if (!best) return '（未找到像消息行的层）';
  const el = best.el;
  const cls = Array.from(el.classList).slice(0, 3).join('.');
  const attrs = ['role', 'data-id', 'data-testid', 'tabindex']
    .map((a) => (el.getAttribute(a) !== null ? `${a}=${el.getAttribute(a)}` : ''))
    .filter((s) => s.length > 0)
    .join(' ');
  return (
    `最像消息列表：${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}` +
    `${attrs ? `（${attrs}）` : ''}｜疑似消息行 ${best.count} 条` +
    `｜路径 ${best.path}` +
    `｜选择器建议 ${el.id ? `#${el.id}` : ''}${
      el.getAttribute('data-testid')
        ? `[data-testid="${el.getAttribute('data-testid')}"]`
        : cls
          ? `.${Array.from(el.classList)[0]}`
          : ''
    }`
  );
}

/**
 * 📋 列出页面里 `data-testid` 的**取值分布**（值 → 出现次数，按次数降序前 12）。
 *
 * 为什么盯 `data-testid`：2026-10-14 真机连续两轮它都是**数量最多**的属性
 * （123 → 156），远多于 `[data-id]`（稳定 27）。数量多说明它被广泛用于标记 UI 部件，
 * 而 `data-testid` 是**开发者显式写下的稳定标识**（不是编译期哈希类名），
 * 抗改版能力远强于 class 名 —— 这是目前最有希望定稿的判据来源。
 */
function dumpTestIds(root: Element, limit = 12): string {
  const counts = new Map<string, number>();
  for (const el of Array.from(root.querySelectorAll('[data-testid]'))) {
    const v = el.getAttribute('data-testid') ?? '';
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return '（无 data-testid 节点）';
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v, n]) => `${v}×${n}`)
    .join(' , ');
}

/**
 * 🔬 决定性探针：把「疑似消息行」逐条摊开，输出每条的
 * `data-id 前缀` + `是否含我方标志物` + `正文首字符数`。
 *
 * 为什么必须逐条看：2026-10-14 第三次真机拿到了 27 个 `data-id`，取值形如
 *   `3EB00E1653D2049A6874CA` / `2A74D6AB08583A6DE542` / `3EB0…` / `2A83…`
 * —— **`3EB0` 与 `2A` 交替出现**，强烈提示前缀就是入向/出向判据
 * （`3EB0…` = 我方发出、`2A…` = 对方发来；这是 WhatsApp 消息 ID 的编码惯例：
 *   `3EB0` 段表示由当前客户端生成，`2A`/`3A` 段表示由对端或服务器生成）。
 * 但**惯例不等于事实**，所以这里同时输出「是否含我方标志物」做交叉验证：
 * 若前缀判定与标志物判定完全一致，才能把规则写进选择器。
 *
 * 这条探针只看结构，不读消息正文（正文只报字符数，不报内容）。
 */
function dumpRows(container: Element, limit = 10): string {
  // 我方消息的候选标志物（任一命中即认为这条是我方发出）
  const OUT_MARKS = [
    '[data-icon="msg-check"]',
    '[data-icon="msg-dblcheck"]',
    '[data-icon="msg-time"]',
    '[data-icon="msg-clock"]',
  ];

  // ⚠️ 2026-10-14 第四次真机教训：直接取 `container.children` **拿不到消息行** ——
  // 输出的每一条都是 `(无)/对方?/aria无/字N`，`data-id` 全为空。
  // 而同一时刻 `root.querySelectorAll('[data-id]')` 有 27 个命中。
  // ⇒ 说明「带 data-id 的消息行」**不在容器的直接子层**，中间还夹着一层（虚拟列表包裹层）。
  // 所以这里改为**向下找带 data-id 的节点**，而不是假设层级。
  const rows = Array.from(container.querySelectorAll('[data-id]')).slice(0, limit);
  if (rows.length === 0) return '（容器内无 data-id 节点）';
  return rows
    .map((row) => {
      const id = row.getAttribute('data-id') ?? '(无)';
      const prefix = id.slice(0, 4);
      const isOut = OUT_MARKS.some((m) => row.querySelector(m) !== null);
      const textLen = (row.textContent ?? '').trim().length;
      const aria = row.getAttribute('aria-label') ?? '';
      // aria-label 常含 "You:" 之类的前缀，是比 class 更稳的入向/出向线索
      const ariaHint = /you[:\s]/i.test(aria) ? 'aria含You' : aria ? 'aria有' : 'aria无';
      // 层级深度：从容器往下几层才到这个 data-id 节点（用于定稿选择器）
      let depth = 0;
      let cur: Element | null = row.parentElement;
      while (cur && cur !== container && depth < 10) {
        depth += 1;
        cur = cur.parentElement;
      }
      const role = row.getAttribute('role') ?? '';
      const testid = row.getAttribute('data-testid') ?? '';
      return (
        `${prefix}${isOut ? '/我方' : '/对方?'}/${ariaHint}/字${textLen}` +
        `/深${depth}${role ? `[role=${role}]` : ''}${testid ? `[${testid}]` : ''}`
      );
    })
    .join(' , ');
}

/**
 * 把消息行上的 `data-id` 取值**完整**压成一行，用于判断「哪条是对方发的」。
 *
 * 2026-10-14 真机两次实测：
 *   · 第一次：`.message-in` = 0、模糊类名 = 0，而 `div[data-id]` = 23、`[role="row"]` = 23；
 *   · 第二次：同一会话里 `div[data-id]` = **1**，样本是 `2AB464C8D7587B…` ——
 *     **既不是 `false_` 也不是 `true_` 前缀**，且数量对不上消息条数。
 * ⇒ 之前的「`data-id^="false_"` 表入向」是**错误推断**，已作废。
 *
 * 因此这里改为输出**完整取值**（不再截断）：前缀判据已经不成立，
 * 必须看全串才能判断它到底是消息标识、会话标识还是别的什么东西。
 * 消息正文本身不会进这行日志，取值只用于结构定位。
 */
function dumpDataIds(root: Element, limit = 8): string {
  const nodes = Array.from(root.querySelectorAll('[data-id]')).slice(0, limit);
  if (nodes.length === 0) return '（无 data-id 节点）';
  return nodes
    .map((el) => {
      const id = el.getAttribute('data-id') ?? '';
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute('role');
      return `${tag}[${role ? `role=${role} ` : ''}${id}]`;
    })
    .join(' , ');
}

/**
 * 探出**消息行候选容器**的结构特征：对给定的几个候选选择器，
 * 各取一个命中节点，输出它的「标签 + 是否含正文 span + 类名前 3 个 + 父链」。
 *
 * 为什么需要这个：骨架日志只能看出「有哪些标签和类名」，看不出「哪一层是消息行」。
 * 选择器要定稿，必须知道**从消息根往下第几层才是承载单条消息的容器**。
 */
function dumpRowCandidates(root: Element): string {
  const probes = ['[role="row"]', 'div[data-id]', 'div[role="listitem"]', 'div[tabindex]'];
  const out: string[] = [];
  for (const sel of probes) {
    const hit = root.querySelector(sel);
    if (!hit) {
      out.push(`${sel}=0`);
      continue;
    }
    const cls = Array.from(hit.classList).slice(0, 3).join('.');
    const hasText = hit.querySelector('span[dir]') !== null;
    // 父链：往上 3 层，帮助定位「消息列表容器」在哪一级
    const chain: string[] = [];
    let cur: Element | null = hit.parentElement;
    for (let i = 0; i < 3 && cur; i += 1) {
      chain.push(`${cur.tagName.toLowerCase()}${cur.id ? `#${cur.id}` : ''}`);
      cur = cur.parentElement;
    }
    out.push(
      `${sel}=1(${hit.tagName.toLowerCase()}${cls ? `.${cls}` : ''}` +
        `｜正文span=${hasText ? '有' : '无'}｜父链=${chain.join('<')})`,
    );
  }
  return out.join(' ');
}

/**
 * 把消息根节点下面的 DOM 结构压成一行「tag.类名」骨架（去重、限深、限量）。
 * 只在「气泡 0 个」的诊断日志里输出 —— 它是真机上订正选择器的唯一线索，
 * 没有它，选择器失配就只能是「静默地什么都不做」。
 */
function dumpSkeleton(root: Element): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const walk = (el: Element, depth: number): void => {
    if (depth >= 4 || parts.length >= 36) return;
    for (const child of Array.from(el.children)) {
      const cls = Array.from(child.classList)
        .filter((c) => c.length > 0 && c.length <= 40)
        .slice(0, 4)
        .join('.');
      const key = `${child.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(key);
      }
      walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return parts.join(' | ').slice(0, 1500);
}

function pick(root: ParentNode, candidates: readonly string[]): Element | null {
  for (const sel of candidates) {
    const found = root.querySelector(sel);
    if (found) return found;
  }
  return null;
}

/**
 * 取「真实渲染出来的消息行」。
 *
 * 为什么不直接用 `SELECTORS.bubbleRow[0]` 就完事：
 * `:has()` 是**选择器层**的过滤，一旦官方结构变动导致它静默失配，
 * 我们只会看到「消息行 0 条」而不知道原因。这里再做一层**代码级**校验 ——
 * 命中数 > 0 但其中没有任何一行含 `msg-container` 时，说明 `:has()` 没生效，
 * 此时回落到「按内容容器过滤」的等价逻辑，保证不会因为选择器退化而全线失效。
 *
 * 过滤规则：一行必须是真实消息 —— 它有 `msg-container`（内容容器）。
 * 虚拟列表为滚出屏的消息保留同前缀的空壳行，必须排除。
 */
function pickMessageRows(root: ParentNode): Element[] {
  const raw = pickAll(root, SELECTORS.bubbleRow);
  if (raw.length === 0) return [];
  // 已经全是真实消息行（`:has` 生效）→ 直接用
  const hasContent = raw.filter((r) => r.querySelector('[data-testid="msg-container"]') !== null);
  if (hasContent.length === raw.length) return raw;
  // `:has` 未生效（把空壳行也捞进来了）→ 在代码里过滤
  return hasContent.length > 0 ? hasContent : raw;
}

function pickAll(root: ParentNode, candidates: readonly string[]): Element[] {
  for (const sel of candidates) {
    const found = root.querySelectorAll(sel);
    if (found.length > 0) return Array.from(found);
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════
// 一·B、消息方向判定 —— 入向/出向的唯一判据（2026-10-14 快照定稿）
// ══════════════════════════════════════════════════════════════════════

/**
 * 判定一条消息行是不是**对方发来的**（入向）。
 *
 * ## 为什么要单独成函数
 * WhatsApp Web 不给消息行任何「in/out」语义属性：真正的方向标记是
 * `tail-in` / `tail-out`，但**官方只在连续气泡的首尾才画小尾巴**，
 * 真机 20 条里只有 10 条带 tail。所以不能靠单一选择器筛出「对方气泡」，
 * 必须「先拿全部消息行，再逐行判方向」——这就是本函数存在的理由。
 *
 * ## 判据（按可靠性排序，全部为**语义/稳定属性**，不含任何哈希类名）
 *
 * | 优先级 | 信号 | 覆盖 | 依据 |
 * |---|---|---|---|
 * | 1 | `[data-testid="tail-out"]` | 组尾/组首 | 官方显式方向标记，最可靠 |
 * | 1 | `[data-testid="tail-in"]`  | 组尾/组首 | 同上 |
 * | 2 | `aria-label` 以 `You:` 开头 | 我方 | 自己发的消息读屏文案是「You:…」 |
 * | 2 | `aria-label` 为回执（`Read`/`Delivered`/…） | 我方 | 只有自己发的消息才有送达/已读回执 |
 * | 3 | `[data-testid="msg-meta"][role="button"]` | **全部出向** | 自己发的时间戳可点（看送达详情），对方的不行 |
 * | 4 | 兜底 | 入向 | 保守选择：宁可漏译也不误译我方消息 |
 *
 * ## 实测结果
 * 在真机快照 20 条消息上：单一 `role="button"` 规则即 **20/20** 正确；
 * 即便人为剥掉全部 `tail-*` 与 `aria-label`，`role="button"`（第 3 层）
 * 仍能独立判出全部 10 条出向 —— 不存在「所有信号同时失效」的脆弱点。
 * 回归用例见 `tests/dom/wa-incoming-selectors.test.ts`。
 *
 * @param row 一条消息行（`SELECTORS.bubbleRow` 命中的元素）
 * @returns `true` = 对方消息（应翻译）；`false` = 我方消息（**绝不能翻译**）
 */
export function isIncomingRow(row: Element): boolean {
  // ── 1. 官方显式方向标记（最可靠，但只在连续气泡的首尾出现） ──
  if (row.querySelector('[data-testid="tail-out"]')) return false;
  if (row.querySelector('[data-testid="tail-in"]')) return true;

  // ── 2. aria-label：自称「You:」与送达回执都是出向专有 ──
  //    多语言兜底：WhatsApp 界面语言跟着账号走，中文界面会是「你:」，英文是「You:」。
  const labels = Array.from(row.querySelectorAll('[aria-label]')).map((el) =>
    (el.getAttribute('aria-label') ?? '').trim(),
  );
  if (labels.some((l) => /^(you|你|您|du|tú|você|vous|вы|あなた)\s*[:：]/i.test(l))) return false;
  if (labels.some((l) => /^(read|delivered|sent|已读|已送达|已发送|既読)$/i.test(l))) return false;

  // ── 3. 时间戳可点击 = 我方发出（可查看送达详情）；此项覆盖全部出向 ──
  //     ⚠️ 必须限定在 msg-meta 上：行内其它按钮（如「回复」）双方都有，会误判。
  if (row.querySelector('[data-testid="msg-meta"][role="button"]')) return false;

  // ── 4. 兜底：判为入向。漏译一条对方消息只是少一条译文，
  //       误判我方消息则会把中文原文再译一遍插回去 —— 取轻。 ──
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// 二、端口与常量
// ══════════════════════════════════════════════════════════════════════

/**
 * 注入层与主进程之间的端口。
 * 生产实现是 `ipcRenderer`（见 `wa-inject.ts`）；测试实现是一个纯内存替身。
 * 把「怎么发」抽出来，是这块逻辑能被自动测试的前提。
 */
export interface InjectorPort {
  /** 请求一次翻译；约定永不 reject（主进程侧已折叠成 ok:false） */
  translate(req: TranslateRequest): Promise<TranslateResult>;
  /** 上报日志（写入主进程本地日志文件） */
  log(level: 'debug' | 'info' | 'warn', message: string): void;
}

/** 时序常量：可注入，便于测试不依赖真实延时 */
export interface InjectorOptions {
  /** 扫描去抖：官方 DOM 一次交互往往触发几十条 mutation，合并成一次扫描 */
  scanDebounceMs?: number;
  /** 出向写入后的二次校验延时 */
  sendVerifyDelayMs?: number;
  /** 观察者看门狗间隔；传 0 关闭 */
  watchdogMs?: number;
  /** 连续失败达到该次数后暂停一段时间 */
  failPauseMs?: number;
  /** 本地译文缓存条数上限 */
  localCacheLimit?: number;
}

const DEFAULTS = {
  scanDebounceMs: 200,
  sendVerifyDelayMs: 30,
  watchdogMs: 5_000,
  failPauseMs: 60_000,
  localCacheLimit: 300,
};

/** 连续失败达到该次数即暂停 */
const FAIL_PAUSE_THRESHOLD = 3;
/** 我方节点的样式类名前缀（属性用于标识归属，类名用于上样式，两者不混用） */
const CLS = 'cd-tr';
const STYLE_ID = 'cd-translate-style';

export interface Injector {
  /** 下发/更新运行时配置（主进程在页面加载后与设置变更后调用） */
  applyConfig(next: TranslateRuntimeConfig): void;
  /** 键盘拦截（生产环境由 `start()` 挂到 document 捕获阶段） */
  handleKeyDown(event: KeyboardEvent): void;
  /** 挂载：注册键盘监听与看门狗。返回卸载函数 */
  start(): () => void;
  /** 立即扫描一次（不等去抖），供测试与「配置下发后补扫」使用 */
  scanNow(): void;
  /** 观察者是否在挂且挂载点仍在文档里 */
  isObserving(): boolean;
  /** 输入区上方是否留有我方提示条（关闭总开关后必须为 false） */
  hasComposerHint(): boolean;
  /** 内部状态快照，仅用于测试与排障 */
  debugState(): {
    epoch: number;
    cacheSize: number;
    inflight: number;
    scans: number;
    paused: boolean;
  };
}

// ══════════════════════════════════════════════════════════════════════
// 三、实现
// ══════════════════════════════════════════════════════════════════════

export function createInjector(port: InjectorPort, options: InjectorOptions = {}): Injector {
  const opts = { ...DEFAULTS, ...options };

  // ── 配置（与主进程下发的快照同构；默认全关，等配置下发） ────────────
  const cfg: TranslateRuntimeConfig = {
    enabled: false,
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
  };

  /** 因「含富媒体」被跳过的气泡，避免每次都重新判定 */
  const skipped = new WeakSet<Element>();
  /**
   * 在途的入向请求，按**文本**共享同一个 Promise。
   * 用 Map 而不是 Set：同一句文本完全可能同时出现在两个气泡里（引用、重复消息、
   * 虚拟列表里的新旧两份），各自 await 同一个 Promise 即可，不必互相让路 ——
   * 早期用 Set + 「发现重复就把自己的占位节点删掉」的写法，会让第二个气泡在
   * 没有后续 mutation 时永远等不到译文。
   */
  const inflight = new Map<string, Promise<TranslateResult>>();
  /** 文本 → 译文。配置变化时清空（换语言/换简繁后旧译文不可复用） */
  const localCache = new Map<string, string>();

  let seqCounter = 0;
  let observer: MutationObserver | null = null;
  /** 观察者挂载的目标；用来发现「挂载点已脱离文档」这种静默失效 */
  let observedTarget: Element | null = null;
  let flushTimer: number | null = null;
  let watchdogTimer: number | null = null;
  let started = false;
  let composerBusy = false;
  let composerHintEl: HTMLElement | null = null;
  let consecutiveFail = 0;
  let pauseUntil = 0;
  /**
   * 出向中文回填的在途请求：`我方气泡的英文 → 翻译 Promise`。
   *
   * 🔴 为什么是「回译」而不是「记下原文」（2026-10-15 用户拍板方案 2）：
   * 发消息时把「英文 → 中文原文」记进一张表，看起来更精确，但那张表**只在内存里**，
   * 而内嵌页会频繁重载（真机日志实证）—— 重载即失忆，表现为「发的时候有中文，
   * 过一会儿就没了」。改用回译后就没有这个源头依赖：我方气泡里的英文**始终在
   * 官方 DOM 里**，任何时候重扫重译都能恢复，与入向译文同一条链路、同样稳。
   *
   * 与入向共用 `localCache` / `inflight`（键空间不冲突：方向由请求参数决定，
   * 缓存键在主进程侧已带语言对，故「英→中」与「中→英」不会串味）。
   */
  const outgoingInflight = new Map<string, Promise<TranslateResult>>();
  /**
   * 「真的扫到气泡列表」的探针是否已报过（每次页面加载只报一条，避免刷屏）。
   *
   * ⚠️ 这个标志**只在成功进入气泡判定时**才置位（2026-10-14 修正）。
   * 此前它被「没找到消息区域」那条分支抢先置位，而配置下发时 `#main` 往往还没渲染
   * （WhatsApp 自己的 JS 在跑握手 + 拉会话），于是唯一的一次探针机会被用在了
   * 最没有信息量的时刻 —— 之后即便气泡选择器完全失配，也再不会吐任何日志，
   * 表现为「功能不工作而且日志一片空白」，无法定位。
   */
  let bubbleProbeLogged = false;
  /** 「未找到消息区域」的上报次数，用于节流（可重复报，但不刷屏） */
  let missingRootLogs = 0;
  /** 实际执行过的扫描次数（排障与测试用：能直接看出 mutation 过滤是否生效） */
  let scanCount = 0;
  /**
   * 配置代次。语言 / 简繁 / 渠道一变就自增，用来作废「变更前发出、变更后才回来」的译文。
   * 只清缓存与旧节点是不够的：在途请求回来时会把上一个语言的译文写进缓存，
   * 于是下一次扫描直接命中错误译文 —— 所以必须在回填处也校验代次。
   */
  let configEpoch = 0;

  // ── 日志 ─────────────────────────────────────────────────────────
  const logDebug = (m: string): void => port.log('debug', m);
  /**
   * 生命周期日志。
   *
   * 为什么这几条用 info 而不是 debug：默认日志级别就是 info，debug 不落盘。
   * 而「脚本有没有被加载」「配置有没有下发成功」「观察者有没有挂上」正是真机
   * 出问题时最先要确认的三件事 —— 它们要是也看不见，排查就只剩猜。
   * 用量上每个页面加载各一条，可忽略。
   */
  const logInfo = (m: string): void => port.log('info', m);
  const logWarn = (m: string): void => port.log('warn', m);

  function rememberLocal(text: string, translated: string): void {
    localCache.delete(text);
    localCache.set(text, translated);
    while (localCache.size > opts.localCacheLimit) {
      const oldest = localCache.keys().next().value;
      if (oldest === undefined) break;
      localCache.delete(oldest);
    }
  }

  // ── 样式（我方节点自带样式，不依赖官方 class，避免跟着改版一起烂掉） ──

  function css(): string {
    const fg = cfg.textColor !== 'default' ? `color: ${cfg.textColor} !important;` : '';
    const bg = cfg.textBgColor !== 'default' ? `background: ${cfg.textBgColor} !important;` : '';
    // 译文框与「出向中文原文框」共用同一套视觉（用户 2026-10-15：两边要一样）
    // 用户在设置里指定的前景/背景色仍作为覆盖项压在上面（!important 已在值里带上）
    const boxStyle = `
  display: block;
  margin-top: 5px;
  padding: 5px 8px;
  border: 1px solid rgba(11,110,85,.35);
  border-radius: 6px;
  background: rgba(11,110,85,.08);
  font-size: ${Math.max(cfg.fontSize - 1, 11)}px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
  ${fg}
  ${bg}`;
    return `
.${CLS} {${boxStyle}
}
.${CLS}--pending { opacity: .5; }
.${CLS}-orig {${boxStyle}
}
/*
 * 出向中文是**回译**结果（英→中的二次翻译），不是使用者手写的那句中文。
 * 用一条极淡的虚线边 + 角标区分，避免把机器译文误当成自己说过的话。
 */
.${CLS}-orig::before {
  content: '回译';
  display: inline-block;
  margin-right: 5px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 9px;
  line-height: 14px;
  vertical-align: 1px;
  color: rgba(11,110,85,.75);
  background: rgba(11,110,85,.12);
}
.${CLS}-hint {
  display: block;
  margin: 0 12px 4px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  background: rgba(224,82,82,.12);
  color: #e05252;
}
.${CLS}-hint--info {
  background: rgba(128,128,128,.14);
  color: inherit;
  opacity: .85;
}
`.trim();
  }

  function ensureStyle(): void {
    const head = document.head ?? document.documentElement;
    if (!head) return;
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
      if (existing.textContent !== css()) existing.textContent = css();
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css();
    head.appendChild(style);
  }

  /**
   * 移除我方样式。
   * 关闭总开关时调用 —— 需求要求「关掉后注入层完整退出，不再动页面任何东西」，
   * 留一个我们插的 <style> 在官方 head 里就不算完整退出。
   */
  function removeStyle(): void {
    document.getElementById(STYLE_ID)?.remove();
  }

  // ── 入向：把对方的消息译成我的语言，插在原文下方（FR-3.23） ──────────

  function hasMedia(bubble: Element): boolean {
    for (const sel of MEDIA_MARKS) {
      if (bubble.querySelector(sel)) return true;
    }
    return false;
  }

  /**
   * 取气泡里的正文文本。
   * 注意两点：① 排除引用回复区域，引用的是**上一条**的内容，不是新消息正文；
   * ② 用 `innerText`（保留 <br> 换行），拿不到时回落 `textContent`。
   */
  function bubbleText(bubble: Element): string {
    const spans = pickAll(bubble, SELECTORS.textSpan).filter(
      (s) => s.closest(SELECTORS.quoted[0]) === null,
    );
    if (spans.length === 0) return '';
    let raw = '';
    for (const span of spans) {
      const el = span as HTMLElement;
      raw += `${typeof el.innerText === 'string' && el.innerText ? el.innerText : (span.textContent ?? '')}\n`;
    }
    return normalizeTranslateText(raw);
  }

  /** 是否已经插过译文节点（DOM 层判断，能扛住 React 局部重渲染） */
  function hasTranslationNode(bubble: Element): boolean {
    return bubble.querySelector(`[${TRANSLATED_ATTR}]`) !== null;
  }

  /** 把译文节点插在正文最后一段之后 —— 最贴近原文，最不容易破坏官方 flex 布局 */
  function insertTranslationNode(bubble: Element): HTMLElement | null {
    // 二次防御：同一个气泡在 React 局部重渲染后可能被再次扫到，绝不能插出两个译文
    if (hasTranslationNode(bubble)) return null;

    // 收敛到气泡框内部再插：`conv-msg-*` 消息行比气泡框大一圈，
    // 直接用消息行当作用域会让译文跑到气泡框外面（2026-10-15 用户反馈）。
    const scope = bubble.querySelector(SELECTORS.bubbleBox[0]) ?? bubble;
    const spans = pickAll(scope, SELECTORS.textSpan).filter(
      (s) => s.closest(SELECTORS.quoted[0]) === null,
    );
    const anchor = spans[spans.length - 1];
    if (!anchor) return null;

    const node = document.createElement('div');
    node.className = `${CLS} ${CLS}--pending`;
    node.setAttribute(TRANSLATED_ATTR, 'translation');
    node.textContent = '翻译中…';
    anchor.insertAdjacentElement('afterend', node);
    return node;
  }

  function registerFailure(): void {
    consecutiveFail += 1;
    if (consecutiveFail >= FAIL_PAUSE_THRESHOLD) {
      pauseUntil = Date.now() + opts.failPauseMs;
      logWarn(`翻译连续失败 ${consecutiveFail} 次，暂停 ${opts.failPauseMs / 1000} 秒后再试`);
    }
  }

  async function translateIncoming(bubble: Element): Promise<void> {
    const text = bubbleText(bubble);
    if (!text) return;

    const node = insertTranslationNode(bubble);
    if (!node) return;

    // 本地缓存命中：连 IPC 都不用走（虚拟列表回收重建后最常见的情况）
    const cached = localCache.get(text);
    if (cached !== undefined) {
      node.textContent = cached;
      node.classList.remove(`${CLS}--pending`);
      return;
    }

    const epoch = configEpoch;
    try {
      let job = inflight.get(text);
      if (!job) {
        job = port.translate({ seq: ++seqCounter, text, direction: 'in' });
        inflight.set(text, job);
        // 无论成败都要撤掉在途标记，否则同一条文本永远不会再被请求。
        // 这里单独挂 catch 是必要的：不处理的话 .finally() 的返回值会成为
        // 一个无人接管的 rejected promise，在渲染进程里报未捕获错误。
        void job.finally(() => inflight.delete(text)).catch(() => undefined);
      }
      const res = await job;

      // 等回来时配置已经换过（语言/简繁/渠道）：这条译文按旧口径生成，一律作废，
      // 既不回填也不入缓存 —— 缓存入错了比不入更糟，它会一直骗到下次变更。
      if (epoch !== configEpoch) {
        node.remove();
        return;
      }

      if (!res.ok) {
        // 入向失败：静默降级（FR-3.32）。不刷屏、不影响聊天本身
        node.remove();
        registerFailure();
        logDebug(`入向翻译跳过（${res.error ?? 'unknown'}）`);
        return;
      }
      consecutiveFail = 0;
      rememberLocal(text, res.text);
      if (!node.isConnected) return; // 期间气泡被回收了，重建时会用缓存补上
      node.textContent = res.text;
      node.classList.remove(`${CLS}--pending`);
    } catch (err) {
      node.remove();
      registerFailure();
      logWarn(`入向翻译异常：${String(err)}`);
    }
  }

  // ── 扫描与观察（FR-3.22：只做增量监听） ────────────────────────────

  function isGroupChat(): boolean {
    const header = pick(document, SELECTORS.header);
    if (!header) return false;
    return pick(header, SELECTORS.groupMark) !== null;
  }

  function scan(): void {
    scanCount += 1;
    // 出向中文回填（我方气泡的英文 → 中文）放在开关闸门之前：
    // 它跟的是「发」这条线，不该因为关掉「收」就一起失效。
    // ⚠️ 它与入向一样会走翻译接口、消耗配额 —— 但只在气泡**首次可见**时各一次，
    //    之后进本地/主进程缓存，重复滚动不再请求。
    //    开关口径：只认总开关 enabled（关掉总开关就是全关）。
    if (cfg.enabled) {
      try {
        flushOutgoingOriginals();
      } catch (err) {
        logWarn(`出向中文回填失败：${String(err)}`);
      }
    }
    if (!cfg.enabled || !cfg.autoReceive || !cfg.personalShow) return;
    if (Date.now() < pauseUntil) return;

    // FR-3.28：群聊整段跳过
    if (isGroupChat()) return;

    const matched = pick(document, SELECTORS.messageRoot);
    const root = matched ?? document.querySelector(SELECTORS.main[0]);
    if (!root) {
      // 未找到消息区域是「时序问题」而不是「选择器问题」的典型表现（页面还没渲染完），
      // 所以这里**不消耗气泡探针的机会**，只做有限次上报（前 3 次），
      // 等后面的补扫真正扫到时再给出选择器层面的结论。
      if (missingRootLogs < 3) {
        missingRootLogs += 1;
        logWarn(
          `扫描时未找到消息区域（第 ${missingRootLogs} 次；页面可能尚未渲染完成，稍后重扫）`,
        );
      }
      return;
    }

    // 记录「消息根节点是哪一个候选命中的」——若 messageRoot 全部失配而回落到 #main，
    // 后续所有 querySelectorAll 都会在整片会话区里找，气泡必然为 0，
    // 这时问题其实出在 messageRoot 上而不是 bubbleIn 上。这条信息决定了该改哪个键。
    const rootLabel = matched
      ? SELECTORS.messageRoot.find((s) => document.querySelector(s) === matched) ?? '未知'
      : '回落到 #main（messageRoot 全部失配）';

    // 取**全部**真实渲染的消息行（双方都含），再用 `isIncomingRow()` 判方向。
    // 不能直接用选择器筛「对方气泡」：官方只有连续气泡首尾才画 tail，
    // 单靠 tail 选择器会漏掉同组中间的消息（真机 20 条里漏 10 条）。
    const rows = pickMessageRows(root);
    const bubbles = rows.filter((row) => isIncomingRow(row));
    const count = bubbles.length;
    if (!bubbleProbeLogged) {
      bubbleProbeLogged = true;
      if (rows.length > 0) {
        logInfo(
          `消息行扫描：消息根=${rootLabel}｜消息行 ${rows.length} 条｜` +
            `判定为对方消息 ${count} 条`,
        );
      } else {
        // 一条消息行都没找到：把候选命中数、data-id 取值、行候选结构、结构骨架
        // 一并上报，据此订正选择器，而不是让使用者反复「装了新版本还是不翻译」。
        const stats = BUBBLE_PROBES.map((p) => `${p}=${root.querySelectorAll(p).length}`).join(' ');
        logWarn(
          `气泡选择器疑似失配：消息行 0 个｜消息根=${rootLabel}` +
            `｜候选命中 ${stats}` +
            `｜data-id 取值 ${dumpDataIds(root)}` +
            `｜行候选 ${dumpRowCandidates(root)}` +
            `｜结构 ${dumpSkeleton(root)}`,
        );
        // 跨作用域换角度探针：在**整个 #main** 里找真正的消息列表容器。
        // 前两轮证明了「在 messageRoot 内部找」可能是错误方向（候选全是 0/1），
        // 这条不受 messageRoot 选对与否影响，能从数据上直接指出容器在哪。
        const mainEl = document.querySelector(SELECTORS.main[0]);
        if (mainEl) {
          logWarn(`消息列表定位（换角度探针）：${dumpListContainer(mainEl)}`);
          const container = findListContainer(mainEl);
          if (container && container.count > 0) {
            logWarn(`消息行逐条（决定性探针）：${dumpRows(container.el)}`);
          }
          // data-testid 取值分布：目前最有希望定稿的稳定判据来源
          logWarn(`data-testid 分布：${dumpTestIds(mainEl)}`);
        }
      }
    }

    for (const bubble of Array.from(bubbles)) {
      // 判定「已处理」只认 DOM 上的译文节点，**不用 WeakSet 记「已翻译过」**：
      // React 重渲染可能把我们插的节点删掉，若用 WeakSet 记了「这条已处理」，
      // 译文就再也补不回来了（虚拟列表滚动时必然发生）。
      if (hasTranslationNode(bubble)) continue;
      if (skipped.has(bubble)) continue;
      if (hasMedia(bubble)) {
        skipped.add(bubble);
        continue;
      }
      void translateIncoming(bubble);
    }
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      try {
        scan();
      } catch (err) {
        logWarn(`扫描消息失败：${String(err)}`);
      }
    }, opts.scanDebounceMs);
  }

  /**
   * 某条 mutation 是否**只**和我方节点有关 → 是的话不必重扫，避免自触发循环。
   *
   * 🔴 判据必须同时看 `addedNodes` 与 `removedNodes`（2026-10-15 修正）。
   * 只看 `addedNodes` 会误判：我们插节点时 mutation 的 `target` 是**官方的**
   * `msg-container`（父节点），`addedNodes` 恰好只有我们那一个 —— 于是整条 record
   * 被当成「纯我方变动」跳过。而官方在同一批 mutation 里可能同时加了新消息，
   * 结果就是**新消息要等下一次无关变动才被扫到**，表现为"要点一下别的地方才出译文"。
   * 加上 `removedNodes` 之后，官方删/换节点的 record 一律不再被我方判据吞掉。
   */
  function onlyOurNodes(record: MutationRecord): boolean {
    if (record.addedNodes.length === 0 && record.removedNodes.length === 0) return false;
    for (const node of Array.from(record.addedNodes)) {
      if (node.nodeType !== 1) return false;
      if (!(node as Element).hasAttribute(TRANSLATED_ATTR)) return false;
    }
    for (const node of Array.from(record.removedNodes)) {
      if (node.nodeType !== 1) return false;
      if (!(node as Element).hasAttribute(TRANSLATED_ATTR)) return false;
    }
    return true;
  }

  function onMutations(records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type !== 'childList') continue;

      const target = record.target;
      const el = target.nodeType === 1 ? (target as Element) : null;

      // 输入区（footer）的变动不关心：打字会把扫描打满
      if (el?.closest(SELECTORS.footer[0])) continue;

      // 只看会话区（#main）里的变动。挂在 body 上是为了扛住「退出登录 → #main 被
      // 整体替换 → 观察者跟着失效」的情况，但绝大多数 body 变动与我们无关，
      // 要靠这道过滤挡掉，否则扫描会被侧栏、通知之类刷满。
      const inMain = el !== null && el.closest(SELECTORS.main[0]) !== null;
      const bringsMain = Array.from(record.addedNodes).some(
        (n) =>
          n.nodeType === 1 &&
          ((n as Element).matches?.(SELECTORS.main[0]) ||
            (n as Element).querySelector?.(SELECTORS.main[0]) !== null),
      );
      if (!inMain && !bringsMain) continue;

      if (onlyOurNodes(record)) continue;

      // 新的会话区刚插进来（登录完成 / 退出登录后重扫码 / 切换账号）：
      // 页面结构已经换了一轮，探针必须重新武装，否则重扫码之后再失配就没有任何线索。
      if (bringsMain) {
        bubbleProbeLogged = false;
        missingRootLogs = 0;
      }

      scheduleFlush();
      return; // 一次去抖就够，不必逐条处理
    }
  }

  /**
   * 挂上观察者。
   *
   * 挂在 `body` 而不是 `#main` 上，是一个刻意的选择：
   * `#main` 会随「退出登录 / 重新扫码 / 切换账号」被整体替换，
   * 观察者跟着被替换掉的节点一起失效 —— 而失效是静默的，
   * 表现为「翻译莫名其妙不工作了」，极难排查。
   * body 自始至终存在，观察者不会失效；代价是要靠上面的过滤挡掉无关变动。
   */
  function attachObserver(): void {
    if (observer) return;
    const target = document.body ?? document.documentElement;
    if (!target) return;
    observer = new MutationObserver(onMutations);
    observer.observe(target, { childList: true, subtree: true });
    observedTarget = target;
    logInfo('消息观察已启动（挂在 body 上，按 #main 过滤）');
  }

  function detachObserver(): void {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    observedTarget = null;
  }

  /**
   * 观察者是否还「真的」在工作。
   *
   * 只判断 `observer` 变量非空是不够的：观察者是挂在某个具体节点上的，
   * 一旦那个节点被整体替换掉（页面把 `body` 换掉这类极端情况），
   * 观察者对象依然存在、`disconnect()` 也不会被调用，但它已经收不到任何变动 ——
   * **静默失效**，表现为「翻译莫名其妙不工作了」。所以要连挂载点是否还在文档里一起看。
   */
  function observerAlive(): boolean {
    if (!observer) return false;
    return observedTarget !== null && observedTarget.isConnected;
  }

  // ── 出向：拦截发送键 → 翻译 → 改写输入框 → 发送（FR-3.24/3.25/3.26） ──

  function getComposer(): HTMLElement | null {
    return pick(document, SELECTORS.composer) as HTMLElement | null;
  }

  function composerText(box: HTMLElement): string {
    return normalizeTranslateText(box.innerText ?? box.textContent ?? '');
  }

  /** 选中输入框全部内容（写入前必做：替换而不是追加） */
  function selectAllContents(box: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(box);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /**
   * 合成粘贴通道：官方编辑器（Lexical）对 paste 事件有自己的处理路径，
   * 与 execCommand 触发的输入路径不同。execCommand 写入被退回时，
   * 这是第二条真正有机会被接受的通道（真机 2026-10-14：长句写入被整体退回）。
   * jsdom 不支持 ClipboardEvent/DataTransfer —— 特性探测不过就如实返回 false，走后续分支。
   */
  function tryPasteWrite(box: HTMLElement, text: string): boolean {
    const ClipCtor = (window as unknown as Record<string, unknown>).ClipboardEvent;
    const DTCtor = (window as unknown as Record<string, unknown>).DataTransfer;
    if (typeof ClipCtor !== 'function' || typeof DTCtor !== 'function') return false;
    try {
      const dt = new (DTCtor as new () => { setData: (t: string, v: string) => void })();
      dt.setData('text/plain', text);
      const ev = new (ClipCtor as new (type: string, init: unknown) => Event)('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      box.focus();
      selectAllContents(box);
      box.dispatchEvent(ev);
      return true;
    } catch {
      return false;
    }
  }

  /** 改写输入框内容。必须用 execCommand，才能触发官方受控组件（Lexical/React）的输入事件 */
  function setComposerText(box: HTMLElement, text: string): void {
    box.focus();
    selectAllContents(box);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      // 回落到直接赋值 + 手动派发 input 事件
      box.textContent = text;
      box.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          inputType: 'insertText',
          data: text,
        }),
      );
      const s2 = window.getSelection();
      if (s2) {
        const r2 = document.createRange();
        r2.selectNodeContents(box);
        r2.collapse(false);
        s2.removeAllRanges();
        s2.addRange(r2);
      }
    }
  }

  /** 触发发送：优先点官方发送按钮，失败再派发回车 */
  function triggerSend(box: HTMLElement): void {
    const icon = pick(document, SELECTORS.sendButton);
    const button = icon?.closest('button') ?? icon?.closest('[role="button"]') ?? null;
    if (button instanceof HTMLElement) {
      button.click();
      return;
    }
    // 我们派发的事件 isTrusted = false，会被 handleKeyDown 主动放行
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      } as KeyboardEventInit),
    );
  }

  function showComposerHint(message: string, kind: 'error' | 'info'): void {
    const footer = document.querySelector(SELECTORS.footer[0]);
    if (!footer) return;
    if (!composerHintEl || !composerHintEl.isConnected) {
      composerHintEl = document.createElement('div');
      // 打上归属标记，关闭翻译时能被统一清理掉
      composerHintEl.setAttribute(TRANSLATED_ATTR, 'composer-hint');
      footer.insertAdjacentElement('afterbegin', composerHintEl);
    }
    composerHintEl.className = kind === 'error' ? `${CLS}-hint` : `${CLS}-hint ${CLS}-hint--info`;
    composerHintEl.textContent = message;
  }

  function clearComposerHint(): void {
    if (composerHintEl?.isConnected) composerHintEl.remove();
    composerHintEl = null;
  }

  /** 是否有我方提示条留在页面上 */
  function composerHintPresent(): boolean {
    return document.querySelector(`.${CLS}-hint`) !== null;
  }

  /**
   * 出向文本口径：压成单行。
   * 输入框里回车即发送，译文若带换行，行为会不可控；多句译文以空格连接。
   */
  function composerSingleLine(text: string): string {
    return normalizeTranslateText(text.replace(/\s*\n+\s*/g, ' '));
  }

  /**
   * 出向主流程。
   * ⚠️ 这条链路上有一条红线（FR-3.26）：**翻译失败或写入失败，一律不发**。
   * 宁可让使用者重试，也不能把中文原文发出去 —— 对方看不懂，且消息不可撤回。
   */
  async function translateAndSend(box: HTMLElement, original: string): Promise<void> {
    if (composerBusy) return;
    composerBusy = true;
    clearComposerHint();
    showComposerHint('翻译中…', 'info');

    const epoch = configEpoch;
    try {
      const res = await port.translate({ seq: ++seqCounter, text: original, direction: 'out' });

      // 翻译途中改了语言/渠道：译文口径已经变了，按红线一律不发
      if (epoch !== configEpoch) {
        showComposerHint('翻译设置已变更，消息未发送。请重新按回车', 'error');
        logWarn('出向翻译期间配置变更，已阻断发送');
        return;
      }

      if (!res.ok) {
        registerFailure();
        showComposerHint('翻译未完成，消息未发送。可重试，或按 Alt+回车直接发送原文', 'error');
        logWarn(`出向翻译失败，已阻断发送（${res.error ?? 'unknown'}）`);
        return;
      }
      consecutiveFail = 0;

      const sendText = composerSingleLine(res.text);
      const expected = normalizeTranslateText(sendText);
      setComposerText(box, sendText);

      // 二次确认：官方组件可能未接受写入。写进去的不是译文就绝不发送
      await new Promise<void>((resolve) => window.setTimeout(resolve, opts.sendVerifyDelayMs));
      let written = composerText(box);
      let channels = 'exec';

      if (written !== expected) {
        // 第一次写入未被官方编辑器接受：换合成粘贴通道再试一次。
        // 真机（2026-10-14）短句可写入、长句被整体退回 —— Lexical 对两条输入路径
        // 的接受度不同，换通道重试是恢复发送的唯一自动机会；仍失败才按红线阻断。
        channels = 'exec+paste';
        logDebug('出向写入校验不一致，改用粘贴通道重试');
        tryPasteWrite(box, sendText);
        await new Promise<void>((resolve) => window.setTimeout(resolve, opts.sendVerifyDelayMs));
        written = composerText(box);
      }

      if (written !== expected) {
        // 期望/实际都转义后截断 —— 这行日志是判断「写回为什么被退回」的关键证据
        const exp = JSON.stringify(expected).slice(0, 120);
        const act = JSON.stringify(written).slice(0, 120);
        showComposerHint('译文写入输入框失败，消息未发送。请重试或手动发送', 'error');
        logWarn(`出向写入校验失败（${channels}）｜期望=${exp}｜实际=${act}`);
        return;
      }

      clearComposerHint();
      triggerSend(box);
      // 发出成功 → 无需在这里做任何「记下原文」的动作。
      // 中文回填改为**回译**：气泡渲染出来后由扫描发现我方消息、按「英→中」翻回来。
      // 好处是与入向同一条链路（英文始终在官方 DOM 里，任何时候都能重算），
      // 不存在「重启/重载后历史消息失忆」的问题。
    } catch (err) {
      registerFailure();
      showComposerHint('翻译异常，消息未发送', 'error');
      logWarn(`出向翻译异常：${String(err)}`);
    } finally {
      composerBusy = false;
    }
  }

  // ── 出向中文回填：把我方气泡里的英文**回译**成中文，以带框样式补显在英文下方 ──
  //
  // 语义说明（用户已知晓并接受）：显示的是「英 → 中」的二次翻译结果，
  // **不等于**你当初手写的那句中文。好处是永远不缺失、不依赖任何本地记忆。

  /**
   * 回译失败过的气泡标记：不再反复重试，避免网络差时把配额与日志刷满。
   * 挂在我方**消息行**上（不是节点上），因为失败时占位节点已经被移除。
   */
  const OUTGOING_SKIP_ATTR = 'data-cd-tr-skip';

  /**
   * 插占位节点（回译中）并返回它；若该行已有中文节点则返回 null。
   *
   * 锚点取气泡框（`msg-container`）内的最后一个正文 span，与入向译文同一位置策略，
   * 保证中文落在英文气泡内部而不是跑到框外。
   */
  function insertOriginalPlaceholder(row: Element): HTMLElement | null {
    if (row.querySelector(`[${TRANSLATED_ATTR}="original"]`)) return null;
    const scope = row.querySelector(SELECTORS.bubbleBox[0]) ?? row;
    const spans = pickAll(scope, SELECTORS.textSpan).filter(
      (s) => s.closest(SELECTORS.quoted[0]) === null,
    );
    const anchor = spans[spans.length - 1];
    if (!anchor) return null;

    const node = document.createElement('div');
    node.className = `${CLS}-orig ${CLS}--pending`;
    node.setAttribute(TRANSLATED_ATTR, 'original');
    node.textContent = '回译中…';
    anchor.insertAdjacentElement('afterend', node);
    return node;
  }

  /**
   * 处理一条我方消息的回译与回填。
   *
   * 与入向的差异只有两点：① 落库位置用 `original` 标记；② 失败时记 skip 不重试。
   * 其余全部复用入向那套（本地缓存 / 在途去重 / 配置代次校验）。
   */
  async function translateOutgoing(row: Element): Promise<void> {
    const text = bubbleText(row);
    if (!text) return;
    if (!isTranslatable(text)) return;

    const node = insertOriginalPlaceholder(row);
    if (!node) return;

    // 本地缓存命中：连 IPC 都不用走（虚拟列表回收重建后最常见的情况）
    const cached = localCache.get(text);
    if (cached !== undefined) {
      node.textContent = cached;
      node.classList.remove(`${CLS}--pending`);
      return;
    }

    const epoch = configEpoch;
    try {
      let job = outgoingInflight.get(text);
      if (!job) {
        // ⚠️ 方向必须用 `in`（页面上的外语 → 我的语言）。
        //    出向的 `out` 是「我输入的中文 → 对方语言」，方向正好相反，不能用。
        job = port.translate({ seq: ++seqCounter, text, direction: 'in' });
        outgoingInflight.set(text, job);
        void job
          .finally(() => outgoingInflight.delete(text))
          .catch(() => undefined);
      }
      const res = await job;
      if (epoch !== configEpoch) {
        node.remove();
        return;
      }
      if (!res.ok) {
        node.remove();
        row.setAttribute(OUTGOING_SKIP_ATTR, '1');
        logDebug(`出向中文回填跳过（${res.error ?? 'unknown'}）`);
        return;
      }
      rememberLocal(text, res.text);
      if (!node.isConnected) return;
      node.textContent = res.text;
      node.classList.remove(`${CLS}--pending`);
    } catch (err) {
      node.remove();
      row.setAttribute(OUTGOING_SKIP_ATTR, '1');
      logWarn(`出向中文回填异常：${String(err)}`);
    }
  }

  /**
   * 回填我方气泡的中文：对**每一条**我方消息行，只要还没有中文节点就发起回译。
   *
   * 由扫描（观察者去抖）驱动 —— 气泡渲染出来必然引发一次 mutation。
   * 因为源头（英文）始终在官方 DOM 里，所以气泡被虚拟列表回收后滚回来，仍会被重新补上。
   */
  function flushOutgoingOriginals(): void {
    const matched = pick(document, SELECTORS.messageRoot);
    const root = matched ?? document.querySelector(SELECTORS.main[0]);
    if (!root) return;

    for (const row of pickMessageRows(root)) {
      if (isIncomingRow(row)) continue;
      if (row.querySelector(`[${TRANSLATED_ATTR}="original"]`)) continue;
      if (row.hasAttribute(OUTGOING_SKIP_ATTR)) continue;
      void translateOutgoing(row);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    // 只处理真实用户按键：我们自己派发的回车 isTrusted = false，必须放行，
    // 否则改写完成后的发送会被自己拦下来
    if (!e.isTrusted) return;
    if (e.key !== 'Enter') return;

    const box = getComposer();
    if (!box) return;
    const target = e.target as Node | null;
    if (!target || !box.contains(target)) return;

    // 翻译期间锁死输入，避免用户在翻译途中继续改内容造成竞态
    if (composerBusy) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const text = composerText(box);
    if (!text) return;

    // FR-3.24：只有含中日韩字符才翻译。纯英文/数字/表情原样发出去
    if (!containsCJK(text)) {
      clearComposerHint();
      return;
    }

    if (!cfg.enabled || !cfg.autoSend) return;

    // FR-3.25：逃生通道 —— Alt+回车强制发送原文（不翻译）
    // 说明：Shift+回车在官方页面是「换行」，不能占用，故改用 Alt+回车
    if (e.altKey) return;

    // Ctrl/⌘+回车 官方未占用，但不属于我们要拦截的发送手势，放行
    if (e.ctrlKey || e.metaKey) return;

    // 到这里就是「回车发送中文」→ 拦下官方的发送，改走翻译链路
    e.preventDefault();
    e.stopImmediatePropagation();
    void translateAndSend(box, text);
  }

  // ── 配置下发 ──────────────────────────────────────────────────────

  function applyConfig(next: TranslateRuntimeConfig): void {
    const prev = { ...cfg };
    Object.assign(cfg, next);

    // 关掉总开关时连样式一起撤掉：不留任何我们插的东西在官方页面上
    if (cfg.enabled) ensureStyle();
    else removeStyle();

    // 语言 / 简繁 / 字号变了，旧译文与旧缓存都不可复用
    const stale =
      prev.myLanguage !== cfg.myLanguage ||
      prev.peerLanguage !== cfg.peerLanguage ||
      prev.traditionalChinese !== cfg.traditionalChinese ||
      prev.providerId !== cfg.providerId;

    if (stale || !cfg.enabled) {
      configEpoch += 1;
      localCache.clear();
      inflight.clear();
      consecutiveFail = 0;
      pauseUntil = 0;
      for (const node of Array.from(document.querySelectorAll(`[${TRANSLATED_ATTR}]`))) {
        (node as Element).remove();
      }
      composerHintEl = null;
    }

    if (cfg.enabled && cfg.autoReceive && cfg.personalShow) {
      // 观察者常驻 body（见 attachObserver 注释），此处只负责挂上并补扫一次：
      // 配置是登录后才下发的，此刻消息通常已经渲染好了，不补扫就漏掉当前屏幕上的那些。
      attachObserver();
      scheduleFlush();
    } else {
      detachObserver();
    }

    logInfo(
      `收到配置：启用=${cfg.enabled} 收=${cfg.autoReceive} 发=${cfg.autoSend} ` +
        `单聊显示=${cfg.personalShow} 简繁=${cfg.traditionalChinese ? '繁' : '简'} ` +
        `${cfg.peerLanguage}→${cfg.myLanguage} 渠道=${cfg.providerId}`,
    );
  }

  // ── 启动 ─────────────────────────────────────────────────────────

  function start(): () => void {
    if (started) return stop;
    started = true;

    // 不在这里插样式：此刻配置还没下发，不知道使用者是否启用。
    // 启用与否由 applyConfig 决定（见那里的 ensureStyle / removeStyle）。
    document.addEventListener('keydown', handleKeyDown, true);

    // ⚠️ 这里**不做周期性扫描**。FR-3.22 明确要求「只做增量监听，不轮询官方 DOM」，
    // 一个几秒一次的扫全量气泡会直接违背它，而且是永久开销。
    //
    // 覆盖各种时序靠的是观察者本身，而不是轮询：
    //   · 扫码阶段还没有 #main → 登录后 #main 插入，body 上的观察者会看到（bringsMain 分支）；
    //   · 配置下发前屏幕上已有消息 → applyConfig 里挂上观察者后立刻补扫一次；
    //   · 退出登录 → 重新扫码、切换会话、虚拟列表回收重建 → 都是 #main 内的 mutation。
    //
    // 这一路轮询只剩一个职责：**看我们自己的观察者还在不在**。
    // 挂在 body 上基本不会失效，但万一挂载点被换掉（见 observerAlive 的说明），
    // 重挂一次比静默不工作好。成本是一次变量判断，不碰官方 DOM。
    if (opts.watchdogMs > 0) {
      watchdogTimer = window.setInterval(() => {
        if (!cfg.enabled || !cfg.autoReceive || !cfg.personalShow) return;
        ensureStyle(); // 样式被官方清掉时补回（只在我们自己的开关打开时才碰页面）
        if (observerAlive()) return;
        detachObserver(); // 挂载点已经不在文档里：清掉这个收不到消息的观察者
        attachObserver();
        scheduleFlush(); // 重挂之后补扫一次，把断档期间漏掉的补上
        logDebug('观察者缺失或挂载点已失效，已重新挂载并补扫');
      }, opts.watchdogMs);
    }

    logInfo('注入脚本已就绪，等待配置下发');
    return stop;
  }

  /** 卸载：摘掉监听、断开观察者、清掉我方在页面上留下的一切 */
  function stop(): void {
    if (watchdogTimer !== null) {
      window.clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    document.removeEventListener('keydown', handleKeyDown, true);
    detachObserver();
    removeStyle();
    clearComposerHint();
    for (const node of Array.from(document.querySelectorAll(`[${TRANSLATED_ATTR}]`))) {
      (node as Element).remove();
    }
    // 探针重新武装：下次启动时能重新输出一次诊断（哪怕选择器已经订正，也不怕多一条）
    bubbleProbeLogged = false;
    missingRootLogs = 0;
    // 在途回译请求的标记清空（Promise 本身无法取消，回来时靠 configEpoch / isConnected 丢弃）
    outgoingInflight.clear();
    started = false;
  }

  return {
    applyConfig,
    handleKeyDown,
    start,
    scanNow: scan,
    isObserving: observerAlive,
    hasComposerHint: composerHintPresent,
    debugState: () => ({
      epoch: configEpoch,
      cacheSize: localCache.size,
      inflight: inflight.size + outgoingInflight.size,
      scans: scanCount,
      paused: Date.now() < pauseUntil,
    }),
  };
}
