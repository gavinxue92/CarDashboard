# WhatsApp 页面固件（真机快照）

这个目录放的是**从真实页面抓下来的 DOM 快照**，供
`tests/dom/wa-selector-fixtures.test.ts` 与 `tests/dom/wa-incoming-selectors.test.ts`
验证 `apps/desktop/src/preload/wa-dom.ts` 里的 `SELECTORS` 与方向判据是否还对得上官方结构。

## 为什么需要它

`SELECTORS` 是从已知页面结构写出来的候选集，而 WhatsApp Web 会改版。
改版后失配的症状非常隐蔽：**聊天一切正常，只是不翻译了** —— 不报错、不白屏。
唯一能自动发现的途径，就是拿一份真实快照当固件。

> 2026-10-14 已实测确认过这件事：注入层日志 `气泡选择器疑似失配：消息行 0 个`，
> 当时官方页面**已不含 `.message-in`**，选择器失配、翻译静默失效。

其余 DOM 逻辑（去重、跳过规则、阻断发送、自触发治理）用的固件是
`tests/dom/helpers/whatsapp-dom.ts` **按真机结构手工搭出来的**，
因此那些用例证明的是「逻辑正确 + 方向判据与真机一致」，
**证明不了「官方下次改版后仍然吻合」** —— 后者只能靠本目录的真机快照。
这条边界必须说清楚，否则「固件测试全绿」会被误读成「官方随便改都还能用」。

## 现有固件

| 文件 | 抓取日期 | 内容 | 用途 |
|---|---|---|---|
| `real-chat-2026-10-14.html` | 2026-10-14 | 单聊，20 条真实消息（入向 10 / 出向 10） | 验证选择器 + **方向判据** |

### `real-chat-2026-10-14.html` 里已确认的事实

| 项 | 结论 |
|---|---|
| 消息列表容器 | `[data-testid="conversation-panel-messages"]` |
| 旧容器 `div[role="application"]` | **0 个**（已死） |
| 消息行 | `[data-testid^="conv-msg-"]` + `data-id`，**裸前缀命中 28** |
| ⚠️ 虚拟列表空壳行 | 28 个里有 **8 个是空壳**（`textContent` 为空），须用 `:has([data-testid="msg-container"])` 收敛到 20 |
| 消息行内容容器 | `[data-testid="msg-container"]`（20/20 都有） |
| 正文 | `span[data-testid="selectable-text"]` |
| **方向判据** | ① `tail-in`/`tail-out`（**只在连续气泡首尾**，20 条里只有 10 条有）② `aria-label`（`You:` / `Read`）③ `[data-testid="msg-meta"][role="button"]`（出向专有，**覆盖全部出向**） |
| ⚠️ 不可用的判据 | `data-id` 前缀 —— `2A**` 里既有入向也有出向 |

方向判定的完整实现见 `wa-dom.ts` 里的 `isIncomingRow()`；逐条真值与回归断言见
`tests/dom/wa-incoming-selectors.test.ts`。

## 怎么抓（约 2 分钟）

1. 在**源码仓库**（`D:\CarDashboard`，有 `package.json`）里跑 `pnpm dev`，
   Electron 窗口内按 `Ctrl+Shift+I` 打开 DevTools；
2. 进一个**含对方消息的单聊**，在 Elements 面板里选中 `<body>`（或整个 `#app` 容器）；
3. 右键该节点 → `Copy` → `Copy outerHTML`；
4. 存成 `fixtures/whatsapp/real-chat-<YYYY-MM-DD>.html`（**必须以 `real-` 开头**，
   否则不会被固件用例认到）。

> 抓整页（而不是单条气泡）是刻意的：方向判据涉及**兄弟气泡之间的相对关系**
> （谁和谁在同一组、谁是组首组尾），单条气泡的 outerHTML 里没有这些信息。

> ⚠️ `pnpm dev` 只能在源码仓库跑。安装目录（如 `D:\测试应用\CarDashboard`）
> 里只有打包产物，没有可运行的脚本。

## 抓到之后

跑 `pnpm test:dom`：

- **通过** = 选择器与方向判据都还与该版本页面吻合；
- **失败** = 失败信息会直接指出是「找不到消息行」还是「方向判错」，
  据此订正 `SELECTORS` 或 `isIncomingRow()`。

## 抓取时请一并记下

- 客户端版本（安装包版本号）与日期 —— 官方改版时要能对上是哪个时点的结构；
- 会话类型：单聊 / 群聊（群聊按 FR-3.28 整段跳过，固件应取单聊）；
- 消息类型：纯文本（富媒体会被跳过，不属于本固件的覆盖范围）。

> ⚠️ 快照里含**真实客户号码与消息正文**。
> 这是本机测试固件，请不要把它提交到公开仓库；
> 提交前建议把号码与正文替换成占位内容（只要结构不变，固件仍然有效）。
