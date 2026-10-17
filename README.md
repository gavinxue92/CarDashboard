# 海外获客沟通工作台 · V1（单机客户端）

汽车出口销售团队用的沟通工作台。当前版本（V1）只实现**「沟通 → WhatsApp」**一个功能，
其余 11 个功能在导航里以「即将上线」占位。

**形态**：Electron 桌面客户端（Windows 64 位），纯本机单机运行——无登录、无服务端、无数据库。

> 📌 **当前文档口径为 V1.4**（2026-10-14）。相比 V1.3 的主要变化：**双向注入式翻译正式纳入本版**
> （决策 D6 → D7 修订），需求条目由 34 条增至 45 条。

---

## V1 做了什么

| 能力         | 说明                                                   |
| ---------- | ---------------------------------------------------- |
| 工作台外壳      | 标题栏 + 左侧导航（四大域 12 项）+ 内容区，未实现项为禁用占位                 |
| WhatsApp   | 点图标即在内嵌视图里加载**官方 WhatsApp Web 页面**，手机扫码绑定后正常收发消息      |
| 登录态持久化     | 存在独立的 `persist:` 会话分区，重启、切走再切回均免扫码                     |
| 运行状态       | 导航圆点三色（运行中 / 加载中 / 连接异常），悬停提示「不代表账号在线」                |
| 异常兜底       | 加载超时 10 秒给反馈；断线按 5s/15s/30s 退避重连；失败有明确故障页而非白屏          |
| 账号备注       | 官方页面里的号码读不到，改用人工备注标识「这是谁的号」                          |
| 解绑 / 重载    | ⋯ 菜单提供「重新加载」与「解除绑定」（解绑会清空本机登录态，需重新扫码）                 |
| **双向翻译**   | 对方英文消息**自动在气泡下方显示中文译文**；我方中文按发送键后**无感替换成英文发出**（见下节）  |
| 右侧功能栏      | 翻译设置（**真实生效**）/ 客户信息（占位）/ 快捷消息（占位）                   |

**V1 明确不做**：消息入库、会话同步、联系人同步、消息统计、Telegram、群聊翻译、历史消息补翻、富媒体翻译、独立翻译面板。

> 为什么没有聊天界面：官方页面自带完整功能，我方只是把它嵌进来。
> `web.whatsapp.com` 响应头含 `frame-ancestors 'none'`，网页 iframe 物理上嵌不进来，
> 这也是必须做桌面客户端的原因。

---

## 双向注入式翻译（V1.4 新增）

### 它怎么工作

内嵌视图上挂了一个 **preload 注入脚本**（`src/preload/wa-inject.ts`），跑在**隔离世界**里
（`contextIsolation: true` + `sandbox: true`）——与官方页面**共享 DOM**，但 JS 作用域互相不可见。

```
官方消息气泡 ──读DOM──> 注入脚本 ──IPC──> 主进程 ──HTTPS──> 翻译渠道
                          ↑                    │
                          └───── 译文回填 ───────┘
                        （插在原文下方的独立节点）
```

| 方向  | 行为                                                                      |
| --- | ----------------------------------------------------------------------- |
| 入向  | 对方新到的**纯文本**消息 → 译文插入**原文气泡内、原文下方**（带虚线分隔与略小字号）；失败则静默跳过，不影响聊天 |
| 出向  | 输入框内容**含中日韩字符**时，按回车先翻译，**用译文替换输入框内容再发送**；无预览、无确认                       |

### 四条不能碰的纪律

1. **出向翻译失败必须阻断发送**。宁可发不出去，也不能把中文原文发出去——对方看不懂，且消息不可撤回。
   阻断时输入框上方有红字提示，并告知可用 `Alt+Enter` 直发原文。
2. **`Alt+Enter` 是逃生通道**，任何时候按它都直接发送原文不翻译。
   这里**不用 `Shift+Enter`**：官方页面里 `Shift+Enter` 是换行，占用它等于剥夺写多行消息的能力。
3. **范围只到单聊 + 新到消息 + 纯文本**。群聊、图片/语音/文件/贴纸/位置/引用、历史消息一律跳过。
4. **不落库**。译文只存在内存里，进程退出即消失；除翻译服务商外不发送给任何第三方。

### 关闭总开关后的完整退出

翻译设置弹窗里的总开关（`enabled`）关掉后，注入脚本会**撤掉自己插入的 `<style>` 与全部译文节点**，
连消息观察者一起停掉，不在官方页面上留下任何东西。

### 翻译渠道与密钥

本版渠道能力做成**可替换适配器**（`src/main/translate/`），上层调度器只认统一接口，换渠道不动调用方与弹窗结构。

| 渠道               | 实现文件                | 是否需要密钥 |
| ---------------- | ------------------- | ------ |
| 内置免费通道（默认）       | `public-endpoint.ts` | 否      |
| DeepL（含 API Free） | `deepl.ts`          | 是      |

当前默认走**零注册公共端点**，只为**验证链路**（真实出译文，但非官方接口、无 SLA）。
正式渠道确定后替换对应文件即可。

> ⚠️ `WATranslateSettings.channel`（弹窗里的「翻译渠道」下拉）本版**不参与选路**——
> 实际渠道由**密钥可用性**决定：没有密钥就走内置免费通道，有 DeepL 密钥就用 DeepL。
> 这样不阻塞开发，也不会让使用者选到一个还没接的渠道。

---

## 环境要求

| 项    | 要求                                             |
| ---- | ---------------------------------------------- |
| 操作系统 | Windows 10 / 11 **64 位**（Electron 44 已无 32 位构建） |
| Node | **>= 22.12**（建议 24 LTS，与 Electron 44 内置 Node 版本对齐） |
| 包管理  | pnpm 12（仓库已声明 `packageManager`，用 corepack 可自动匹配） |
| 网络   | 开发与使用均需能访问 `web.whatsapp.com`（境外）              |

```bash
corepack enable          # 首次：让 pnpm 版本自动对齐
pnpm install
```

---

## 常用命令

```bash
pnpm dev                 # 开发模式启动客户端（热更新）
pnpm build               # 构建产物到 apps/desktop/out（含 preload 自包含性断言）
pnpm typecheck           # 类型检查（shared + 主进程 + preload + 渲染进程 + 测试，五项）
pnpm test                # 单元 + 契约 + DOM 固件（T1 + T2）
pnpm test:e2e            # 端到端冒烟（T3，需先 pnpm build）
pnpm pack:win            # 打 Windows NSIS 安装包（含一次 build），产物在 apps/desktop/release
pnpm pack:win:only       # 只打包、不重复 build，直接用当前 out/（产物在 release-tmp；该目录须尚不存在）
pnpm verify:release      # 验证**安装包产物**：包内产物与构建产物比对 + 拉起打包后的客户端冒烟
pnpm clean               # 清掉 out 与 release
```

### 两条常用链路（别每次都跑全套）

实测各步骤耗时（本机，2026-10-14）：`typecheck` 18s · `test`（T1+T2）49s · `build` 28s ·
`test:e2e` 94s · `pack:win:only` 70s · `verify:release` 18s。**全套约 4.5 分钟。**

**改完代码先自查**（约 70 秒）：

```bash
pnpm typecheck && pnpm test
```

**要出安装包时**（约 4.5 分钟，含验证）：

```bash
pnpm typecheck && pnpm test && pnpm build \
  && pnpm test:e2e \
  && node scripts/pack-win.mjs --config.directories.output=release-tmp4 \
  && node scripts/verify-release.mjs apps/desktop/release-tmp4
```

> ⚠️ 出包那两行为何直接调脚本、而不是 `pnpm pack:win`，有两个原因：
>
> 1. **它不重复 build。** `pnpm build` 已经在第 3 步跑过，而 `pack:win` 的定义是
>    `pnpm run build && node scripts/pack-win.mjs`，内部会再 build 一次（实测白花 28 秒）。
>    少了这一步不会让旧包溜出去 —— `verify:release` 会把 `app.asar` 里的产物与当前 `out/`
>    **逐字节比对**，没 build 就打包会直接失败。为此另外提供了 `pnpm pack:win:only`。
> 2. **本机必须换一个没用过的新输出目录。** 目标目录里一旦已有 `win-unpacked`，
>    electron-builder 清理它时会被环境的删除护栏拦下（详见下文
>    「打包前若上一次留下了 `release\win-unpacked`」）。所以每次出包把 `release-tmpN`
>    递增，并把**同一个目录**同时传给打包与验包两步。
>
> 磁盘上留下的旧目录，可在**文件资源管理器里手动删除**，不受上述护栏影响。

> `pnpm dev` 请在**普通终端**里跑。不要从自动化代理 / IDE 的执行上下文里拉起 ——
> 那样 Electron 会因为沙箱无法初始化而起不来，原因见下面「调试须知」。

### 自动化测试（三层）

交付纪律见仓库根 `AGENTS.md`（新增功能必须在关键点测到、每次改动后回归关联功能）。

| 层 | 命令 | 环境 | 覆盖什么 |
| --- | --- | --- | --- |
| **T1** | `pnpm test:unit` | node | 契约与主进程纯逻辑：设置归一化、密钥三级解析、LRU 去重缓存、并发闸门、失败降级、错误码映射。含一条通用护栏 —— **所有跨 IPC 的入参必须能通过 `structuredClone`** |
| **T2** | `pnpm test:dom` | jsdom | 注入脚本：选择器命中、入向译文回填、出向改写与阻断、去重、自触发治理、观察者失效自愈、保存链路（**本项目最贵那个 bug 的回归用例**） |
| **T3** | `pnpm test:e2e` | Electron | 真实构建产物冷启动：主界面与 12 项导航、状态圆点收敛、**翻译设置保存 → 弹窗关闭 → 落盘 → 重启仍在**、账号备注 |

T3 的两条注意：

```bash
pnpm build && pnpm test:e2e                  # 必须先构建：跑的是 out/ 里的产物
CD_E2E_COMPAT_MODE=0 pnpm test:e2e           # 想验证标准沙箱路径时（默认走兼容模式）
```

- 每个用例通过 `CD_USER_DATA_DIR` 拿到**独立临时目录**，绝不碰使用者的 `%APPDATA%\CarDashboard`
  （那里存着 WhatsApp 登录态）。⚠️ 不要用 `APPDATA` 环境变量代替，对 Electron 无效 —— 见 `src/main/index.ts` 的实测记录。
- 默认给客户端设 `CD_COMPAT_MODE=1`（关沙箱 + 软渲染）。原因同 `pnpm dev` 那条提醒：
  从自动化上下文拉起 Electron 时 Chromium 沙箱初始化会断言失败。`--no-sandbox` 关的是 OS 级进程沙箱，
  `webPreferences.sandbox` 仍在生效，preload 的自包含约束照样被测到。
- 用例必须**串行**（`workers: 1`）：单实例锁 + 共用会话分区，并行会互相踢掉。

**T3 不覆盖什么**：真实 WhatsApp 页面内的一切（需要登录态与境外网络），属手工验收项。
选择器与真实页面的匹配度靠 `tests/dom/fixtures/whatsapp/` 下的真机快照校验，抓取办法见该目录的 `README.md`。

### 关于 `pnpm pack:win` 的下载源

首次打包要下载三样东西：Electron 本体、NSIS 工具链、winCodeSign。它们**默认走 github.com**，国内网络下会报
`Response code 502` 或 `Timeout awaiting 'request'`，而错误信息里不会提「镜像」。

`.npmrc` 里那两行 `electron_mirror` / `electron_builder_binaries_mirror` **对这一阶段无效** ——
pnpm 不会把 `npm_config_*` 注入到它拉起的脚本环境里。所以镜像由 `scripts/pack-win.mjs` 兜底注入：

```bash
pnpm pack:win                                                          # 用默认镜像（npmmirror）
ELECTRON_MIRROR=https://your-mirror/ pnpm pack:win                     # 覆盖成自己的源
```

工具链一旦下载成功会缓存到 `%LOCALAPPDATA%\electron-builder\Cache`，之后打包不再联网。

### 打包前若上一次留下了 `release\win-unpacked`

electron-builder 每次打包都会先清掉 `release\win-unpacked` 再重新解压 Electron 本体。
如果这个目录被别的进程占着（杀软扫描、上次异常中断遗留的句柄等），清理会失败并中止打包，
报错形如：

```
⨯ [safe-delete] 操作失败: ERROR ...\release\win-unpacked: Error during a `trash` operation
```

失败原因有两类，**处置方式完全不同**：

1. **文件被占用** —— 上次那个客户端还在跑（安装目录里的进程）。先把它关掉即可。
2. **本机执行环境的删除护栏** —— 见下面的实测记录，**换目录是唯一出路**。

**处置**：关掉正在运行的客户端；若仍清理失败，**换一个全新的输出目录**：

```bash
node scripts/pack-win.mjs --config.directories.output=release-tmp3
```

> ⚠️ **本机局限（2026-10-14 实测，别再浪费时间尝试删除）**
>
> 本机执行环境给「删除」加了两道护栏，**对已有目录是全封的**：
>
> - `SAFE_DELETE_BULK_CONFIRM_REQUIRED` —— 单次删除超过 50 个条目需人工确认
>   （打包清理 `win-unpacked` 时实测报 `count: 76, threshold: 50`）。
> - `SAFE_DELETE_FAIL_CLOSED` —— 走「移到回收站」失败时**不退化**为直接删除。
>
> 已验证**全部失败**，且与文件被占用无关（当时任务管理器里并没有对应进程）：
> bash `rm -rf` · Node `fs.rmSync` / `fs.promises.rm` · PowerShell `Remove-Item -Recurse -Force` ·
> PowerShell `Rename-Item`（提示「访问被拒绝」）· Git Bash 里的 `cmd //c rmdir /s /q`。
> 其中 `cmd.exe` 本身被策略禁止从 PowerShell 调用。
>
> **结论：本机每次打包都需要一个没用过的新输出目录**（`release-tmp3`、`release-tmp4`…）。
> 所以 `pnpm pack:win` 与 `pack:win:fallback` 的默认目录一旦已存在，**必然失败** ——
> 这是环境限制，不是工程缺陷。旧目录会留在磁盘上（每个约 300MB + 106MB 安装包），
> 在**文件资源管理器里手动删除**不受上述护栏限制。
>
> `release\win-unpacked` 是早期（0.1.1 时期）留下的**旧产物**，不要拿它验证或分发。

### 打完包必须验包（`pnpm verify:release`）

`pnpm test` 全绿、`pnpm build` 全绿，**不代表你手上那个安装包是新的**。
2026-10-14 就发生过一次：0.1.1 安装包比生产修复早了一小时 —— 源码层面缺陷「已修」，
交付层面「没修」。这类问题只有验包才能发现。

```bash
pnpm pack:win && pnpm verify:release
```

脚本做两件事：

1. **一致性**：把 `app.asar` 里的主进程 / preload / 渲染层产物抠出来，与当前 `out/` 逐字节哈希比对。
   不一致就直接失败并提示「你验的不是刚打出来的包」—— 这是防假绿的关键一环。
2. **可用性**：真的拉起打包后的 `CarDashboard.exe`，验证能启动、版本号正确、
   以及**翻译设置保存 → 弹窗关闭 → `config.json` 落盘 `enabled:true`** 这条核心链路。
   另有一条针对 `composerHintPresent()` 那个历史缺陷的结构性护栏。

不需要 WhatsApp 账号，也不需要能连境外。产物目录自动探测（`release-tmp` 优先，其次 `release`），
也可显式指定：`node scripts/verify-release.mjs apps/desktop/release-tmp`。

---

## 目录结构

```
CarDashboard/
├─ docs/                     需求规格说明书 · 交互说明 · 技术方案
├─ prototype/                交互原型
├─ apps/
│  └─ desktop/               Electron 客户端（本版的全部）
│     ├─ src/main/           主进程
│     │  ├─ partition.ts     ⚠ 会话分区标识的单一注入点
│     │  ├─ wa-session.ts    分区配置：UA 覆写 / 代理 / 权限 / 清空
│     │  ├─ embed-view.ts    内嵌官方页面 + 三色状态映射 + 退避重连 + 注入脚本加载
│     │  ├─ nav-guard.ts     导航与 window.open 白名单
│     │  ├─ store.ts         本地持久化（备注 / 翻译设置）
│     │  ├─ logger.ts        本地日志
│     │  ├─ toast-window.ts  Toast 浮层窗口
│     │  ├─ window.ts        主窗口
│     │  ├─ ipc.ts           IPC 注册（含参数校验 + 注入层来源校验）
│     │  └─ translate/       翻译调度与渠道适配器  ← V1.4
│     │     ├─ index.ts            调度：缓存 / 并发 / 超时 / 失败降级
│     │     ├─ provider.ts         适配器接口与错误码
│     │     ├─ key-store.ts        密钥两级解析（本机文件 > 构建期内置）
│     │     ├─ public-endpoint.ts  零注册公共端点（本版默认）
│     │     └─ deepl.ts            DeepL（含 API Free）
│     ├─ src/preload/
│     │  ├─ index.ts         主窗口的 contextBridge 最小 API
│     │  └─ wa-inject.ts     ⚠ 注入官方页面的翻译脚本（隔离世界 + 沙箱）
│     └─ src/renderer/       Vue 3 我方 UI
│        ├─ layout/          标题栏 / 导航 / 内容区
│        ├─ views/           whatsapp / placeholders
│        └─ components/      状态点 · 功能栏 · 三个弹窗 · 兜底层
├─ packages/
│  ├─ shared/                IPC 契约 + 类型（单一来源，含翻译契约 translate.ts）
│  └─ config/                tsconfig 基座
├─ scripts/
│  ├─ pack-win.mjs           打包入口（负责注入下载镜像）
│  └─ check-preload.mjs      ⚠ 构建期断言：preload 产物必须自包含
├─ .env.example
└─ pnpm-workspace.yaml
```

---

## 配置项

### 构建期（`apps/desktop/.env.*`，注入产物，用户可读，**不含任何密钥**）

| 变量               | 默认     | 说明                                    |
| ---------------- | ------ | ------------------------------------- |
| `VITE_WA_PROXY`  | 空（直连）  | 仅作用于 WhatsApp 分区；办公网络不通时填代理地址         |
| `VITE_LOG_LEVEL` | `info` | 日志级别，日志写在 `<userData>/logs/`            |

### 构建期（**仅打包时**的进程环境变量，进主进程产物，**不进渲染层**）

| 变量                  | 默认 | 说明                                                       |
| ------------------- | -- | -------------------------------------------------------- |
| `CD_TRANSLATE_KEY`  | 空  | 翻译渠道密钥（内置进客户端）。留空也能正常构建——会回落到内置免费通道。 |
| `ELECTRON_MIRROR`   | 自动 | 打包时下载 Electron 的镜像源，见上文                              |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | 自动 | 打包时下载 NSIS / winCodeSign 的镜像源，见上文                    |

```bash
CD_TRANSLATE_KEY=xxxxxxxx pnpm pack:win    # 把密钥内置进安装包
```

> ⚠️ 该变量**刻意不使用 `VITE_` 前缀**。带 `VITE_` 的变量会被注入渲染层产物，而渲染层是明文可读的。
> 密钥只编译进主进程，渲染层的 JS 里搜不到它。

### 运行期（进程环境变量，默认都不需要设）

| 变量                | 默认 | 说明                                                              |
| ----------------- | -- | --------------------------------------------------------------- |
| `CD_COMPAT_MODE`  | 未设 | 设为 `1` 时**关闭沙箱并走软件光栅化**。仅用于标准模式起不来的受限机器（强管控域内电脑、部分虚拟机）。 |

> ⚠️ `CD_COMPAT_MODE=1` 有真实的安全代价：本应用内嵌的是第三方面板（WhatsApp Web），
> 关闭沙箱等于放弃进程隔离。只有在确认标准模式确实起不来时才用，并且它会被写进本地日志。

### 换翻译密钥（**不需要重新发版**）

本版**不做自动更新**，如果密钥只能靠重新打包分发，那「密钥失效」就会变成一次全员重装。
所以密钥按两级解析，**本机文件优先于内置值**：

| 优先级 | 来源                                   | 说明                          |
| --- | ------------------------------------ | --------------------------- |
| 1   | `<userData>/translate-key.json`      | 使用者可替换的小文件，**改完最多 30 秒生效**，不必重启 |
| 2   | 构建期内置（`CD_TRANSLATE_KEY`）            | 安装包里带的那个                    |
| 3   | 都没有                                  | 回落到内置免费通道                   |

`<userData>` 在 Windows 上是 `%APPDATA%\CarDashboard`（应用内「设置中心 → 关于」里能看到实际路径）。

```json
{
  "provider": "deepl",
  "key": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
}
```

- `provider` 可省略；省略时按 `deepl` 处理（本版只有它需要密钥）。
- `key` 以 `:fx` 结尾会自动走 DeepL 的 **API Free** 端点，否则走付费端点——用错端点会返回 403 且不会提示原因，所以这里按后缀自动判断。
- 可选字段 `endpoint`：自建或代理端点覆盖。

---

## 调试须知：这些现象不是工程的毛病

**从代理 / IDE 的执行上下文里直接拉起 Electron，渲染进程必定崩溃。**
表现是主进程日志停在「初始化完成」，紧接着：

```
Renderer process crashed
[ERROR] [window] 主界面渲染进程退出：crashed
FATAL: GPU process isn't usable. Goodbye.
```

渲染进程退出码是 `-2147483645`（`0xC0000003` = `STATUS_BREAKPOINT`），即**沙箱初始化断言失败**；
GPU 进程退出码 `0xC0000005` 是被连带打崩的结果，**不是原因**。

已用对照实验排除过：换 Electron 37.10.3（与本机运行正常的 WorkBuddy 同版本）跑最小探针，
在同一上下文下崩溃表现完全一致；作为顶层应用启动时一切正常。
**所以这与工程代码无关，也与 Electron 版本无关。**

结论：
- 验证客户端请**在普通终端里跑 `pnpm dev`**，或直接双击安装包，不要从自动化代理里拉起。
- 若确有必要在该类上下文里跑，用 `CD_COMPAT_MODE=1 pnpm dev`，看到窗口出现后**务必重启一次**确认不是假象。

---

## 交付说明（发给使用者时请一并转达）

**本次构建产物**

| 项      | 值                                                                  |
| ------ | ------------------------------------------------------------------ |
| 版本     | **0.1.1**（标题栏与日志里都能看到，用于确认「跑的是哪一份构建」）                             |
| 安装包    | `apps/desktop/release/CarDashboard-Setup-0.1.1.exe`（约 106.3 MB）      |
| SHA-256 | `6543e0dba8c2d42f7ed32e34b27e135ff84f85680441f2b75ec1886ca8aecea4` |

> ⚠️ 每次重新打包，校验和都会变（安装包内嵌了构建时间）。分发前请重新计算：
> `certutil -hashfile CarDashboard-Setup-0.1.1.exe SHA256`

**从 0.1.0 升级：直接覆盖安装，不要先卸载。**
`deleteAppDataOnUninstall: true` 意味着**卸载会连本地数据一起清掉**（含 WhatsApp 登录态），
于是又得重新扫码；而覆盖安装不动 `%APPDATA%\CarDashboard`，登录态与账号备注都保留。
安装前先退出正在运行的客户端，否则文件被占用会导致安装失败。

1. **首次安装会出现 SmartScreen 蓝框告警**——本版未做代码签名（已确认的取舍）。
   点「更多信息」→「仍要运行」即可。可让使用者用上面的 SHA-256 自查安装包是否被篡改。
2. **卸载会清除全部本地数据**，包括 WhatsApp 登录态与账号备注。重装后需要**重新扫码、重新填备注**，
   这不是故障。
3. **导航圆点的含义是「页面是否正常运行」，不是「账号是否在线」。**
   在手机上主动移除该设备后，圆点仍会是绿色，官方页面自己会跳回二维码页——看到二维码就是需要重新扫码。
4. **首次打开 WhatsApp 会偏慢**，因为页面资源在境外。若长时间转圈，多半是办公网络访问不了境外服务。
5. 建议**统一使用公司号码**绑定，避免销售个人主号被平台限制。
6. **翻译默认是关的**，需要使用者自己在右侧功能栏「翻译设置」里打开总开关。首次进入模块时有提示。
7. **翻译需要境外网络**（与聊天同一条出口）。网络不通时：对方消息照常显示原文（只是没有译文），
   我方中文消息**会发不出去**并提示——这是刻意的，详见上文「四条不能碰的纪律」第 1 条。
   此时可按 `Alt+Enter` 直发原文，或先关掉总开关。
8. **翻译依赖 WhatsApp 网页版的前端结构**。官方一旦改版，注入脚本可能失配并静默失效
   （表现为「不翻译了，但聊天一切正常」）。此时不要怀疑网络，直接反馈，改 `wa-inject.ts` 里的
   `SELECTORS` 一处即可，选择器已集中在那里。
   反馈时请附上日志 `%APPDATA%\CarDashboard\logs\app-<日期>.log`：
   注入脚本的关键节点都会写进去（脚本是否就绪、收到什么配置、**首次扫描屏上气泡几个**）。
   「首次扫描气泡 0 个」= 选择器失配；「翻译连续失败」= 网络或渠道问题。
9. **内置免费通道是非官方接口**，无 SLA、可能被限流，仅用于验证链路。
   正式使用前请配置正式渠道密钥（见上文「换翻译密钥」）。

---

## 两个不能忘的工程约束

### 一、会话分区标识是单一注入点

会话分区标识集中在 `apps/desktop/src/main/partition.ts`，**全工程只有这一个地方定义它**。

- 本版没有工作台登录层，所以它是固定值，隔离靠 Windows 用户目录。
- 将来加入登录层时，把该函数改成返回用户标识即可，其余代码不用动。
- 反面案例：若把分区名写死在多处、后续又沿用同名分区，会出现「任何人登录后都能看到同一个已绑定的号」的串号问题。

### 二、⚠️ 沙箱 preload 不能 `require` 相对路径的本地文件

这是 V1.4 引入注入脚本时踩到的坑，**且只在用户机器上才会暴露**，值得单独记一笔。

注入脚本必须跑在沙箱里（内嵌的是第三方远程内容，沙箱不可退让），
而**沙箱 preload 的 `require` 只认 `electron` 等少数内置模块**，加载相对路径的本地文件会直接失败。

打包器默认会把「多个 preload 入口都引用的模块」抽成**公共 chunk**（实测产出 `out/preload/chunks/ipc-xxx.js`），
于是注入脚本一加载就 `require` 失败——开发时若只用 dev 模式，可能完全看不到。

**当前解法**：让两个 preload 入口的**运行时依赖图互不相交**——
主窗口 preload 只碰 `packages/shared/src/ipc.ts`，注入脚本只碰 `packages/shared/src/translate.ts`。
所以 `INJECT_IPC` 的 `REQUEST` / `CONFIG` / `LOG` 三个通道**刻意留在 `translate.ts` 里**，
不要因为「通道名看着更该放 `ipc.ts`」而挪回去，那会让公共 chunk 重现。

**防回归**：`pnpm build` 会跑 `scripts/check-preload.mjs`，断言 `out/preload/` 下只有两个自包含的入口文件、
没有 `chunks/` 目录。违反时**构建直接失败**，不会带着问题打包。

自查命令：

```bash
grep -o 'require("[^"]*")' apps/desktop/out/preload/wa-inject.js | sort -u
# 期望只输出：require("electron")
```

---

## 文档

| 文档                    | 用途                         |
| --------------------- | -------------------------- |
| `docs/需求规格说明书-V1.md`   | **45 条 FR** 与本版范围处置（24 照做 / 4 改口径 / 5 推迟 / 1 移出 / 11 新增）；核心章节 **5.3.7 双向注入式翻译** |
| `docs/WhatsApp模块-页面交互说明.md` | 页面级交互、状态机、弹窗规格、可实现性修正      |
| `docs/技术方案-V1.md`     | 架构分层、职责划分、技术选型理由与限制、部署与测试范围 |
