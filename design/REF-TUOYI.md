# 拓译翻译客户端 —— 接入方式逆向分析

> 对象：`D:\拓译翻译\tuoyitranslate`（`tuoyitranslate.exe`，232 MB）
> 分析方式：静态解包（`resources/app.asar` → 4448 个文件）+ 字符串/字节码分析
> 分析日期：2026-10-13
> 目的：判断「它是怎么把翻译嵌进聊天软件的」，为 CarDashboard 的通道层选型提供实证参照。

---

## 一、结论（先说答案）

**它不注入任何已经安装在电脑上的聊天客户端**（不碰 WhatsApp Desktop / Telegram Desktop / 微信桌面版）。

它采用的是：

> **Electron 套壳 → 在自己的窗口里跑官方网页版 → preload 桥接 → 运行时解密一段脚本并塞进该网页的主世界。**

一句话对照：**形态上等同于 `whatsapp-web.js`，但宿主不是 headless Chromium + Puppeteer，而是自带完整界面的 Electron 工作台。**

三条互斥的「嵌入」路径里，它走的是**第三条**：

| 路径 | 做法 | 拓译是否采用 |
|---|---|---|
| A. 协议直连 | 直接实现多设备协议（Baileys 一类），无浏览器 | ✗ |
| B. 原生客户端劫持 | 注入进程 / 挂钩窗口消息 / UI Automation 操作已安装的桌面端 | ✗ |
| C. 网页版宿主 + 页面注入 | 自己开浏览器内核跑官方网页版，往页面里塞脚本 | ✓ **本客户端** |

---

## 二、七层证据

### 1. 打包形态：Electron

- 根目录：`LICENSE.electron.txt`、`chrome_100_percent.pak`、`resources.pak`、`icudtl.dat`、`ffmpeg.dll`、`vulkan-1.dll`。
- `resources/app.asar`（61.6 MB）+ `app.asar.unpacked/node_modules/better-sqlite3`（原生模块，必须解包才能加载）。
- `resources/app-update.yml` + 依赖 `electron-updater` → 自带自动更新。
- `resources/extraExtensions/ophjlpahpchlmihnnnihgmmeilfjmjjc/3.7.2_0/` → **Chrome 扩展**，`manifest.json` 里 `"name":"LINE"`，`key` 就是 LINE 官方扩展的签名公钥。主进程字节码中有 `loadExtension`。
  → 即：**为了在自家里跑 LINE 网页版，干脆把 LINE 的官方 Chrome 扩展装进了自己的 Electron 会话**。

`package.json`（asar 内）：

```json
{
  "name": "tuoyitranslate",
  "productName": "ty",
  "version": "4.2.59",
  "main": "main-jsc.js",
  "author": { "name": "四川云奥雅网络科技有限公司" },
  "dependencies": {
    "@electron/remote": "^2.1.3",     "@sentry/electron": "^7.13.0",
    "@vueuse/core": "^12.0.0",        "better-sqlite3": "^12.11.1",
    "bytenode": "^1.6.0",             "dexie": "^4.2.1",
    "electron-log": "^5.4.4",         "electron-store": "^10.1.0",
    "electron-updater": "^6.8.6",     "franc": "^6.2.0",
    "https-proxy-agent": "^7.0.6",    "node-cron": "^4.2.1",
    "proxy-chain": "^2.3.0",          "socks-proxy-agent": "^8.0.5",
    "ws": "^8.18.3",                  "xlsx": "^0.18.5"
  }
}
```

两个依赖已经透露关键信息：**`franc`**（语言识别，翻译管线的入口）、**`proxy-chain` + `socks-proxy-agent` + `https-proxy-agent`**（每账号代理）。

### 2. 源码保护：bytenode 字节码 + 混淆

- 主进程与公共模块全部编译为 V8 字节码：`buildv8/**/*.jsc`，配套的 `*.js` 只有一行：

  ```js
  module.exports = require('./domObserve.jsc');
  ```

- 入口 `main-jsc.js` 首行 `require('bytenode')`，再按 `buildv8/manifest.json` 找到 main 对应的 `.jsc` 加载。
  里面还有一段细节：若 `\\.\NUL` 打不开（说明标准流被宿主禁用），会 `app.relaunch({args:[...,'--no-stdio-init','--__tuoyi_restarted']})` 重启自己。
- **只有 webview 侧的适配脚本没有编译成字节码，而是用 javascript-obfuscator 混淆的明文 JS。** → 这正是我们要读的部分。

### 3. 目标通道全部是「网页版」

全部平台配置集中在渲染层 bundle `buildv8/dist/assets/main-e734435e.js`，结构统一为
`{ name, icon, color, phoneLabel, phonePlaceholder, phoneType, defaultAccountName, baseUrl, userAgent, webPreferences, features, handlerClass }`：

| 平台 | baseUrl |
|---|---|
| WhatsApp | `https://web.whatsapp.com` |
| Telegram / TelegramK | `https://web.telegram.org`（K 版为 `/k/`） |
| Messenger | `https://www.messenger.com` |
| Facebook / FB-business | `www.facebook.com` / `business.facebook.com` |
| Instagram | `https://www.instagram.com/direct/inbox/` |
| TikTok | `https://www.tiktok.com/messages` |
| Twitter | `https://twitter.com/messages` |
| Line | `https://chrome.google.com/webstore/detail/line/ophjlpahpchlmihnnnihgmmeilfjmjjc`（装扩展） |
| LineBiz / LineWorks | `https://manager.line.biz/` / `https://line-works.com/` |
| Snapchat / Vkontakte / Zalo / Band / Bip / DisCord | `snapchat.com` / `vk.ru/im` / `chat.zalo.me` / `band.us` / `web.bip.com` / `discord.com` |
| Teams | `https://teams.live.com/` |
| （通用） | `baseUrl: ""`，globe 图标 → **自定义 URL 通道** |

**所有平台共用的 `webPreferences` 是同一个固定串**（这是 `<webview webpreferences="...">` 的属性值）：

```
backgroundThrottling=..., nodeIntegration=false, contextIsolation=true,
allowRunningInsecureContent=true, sandbox=false, offscreen=false,
spellcheck=false, enableWebSQL=false, v8CacheOptions=code, javascript=true,
additionalArguments=--enable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure
```

⚠️ 注意 `allowRunningInsecureContent=true`：为注入让路而放宽了安全检查。
另有一个内部用的变体（`contextIsolation=false, nodeIntegration=true`），只给它自己的页面用。

### 4. 宿主：Electron `<webview>` 标签 + 一号一环境

- 主进程字节码中出现 `webviewTag` → 渲染进程开启了 `<webview>` 标签能力。
- 渲染层出现 `webview-host` / `webview-container` / `webview-ref-change` / `webviewGetter(accountId)` → **每个账号一个 webview 实例**。
- 每个账号一个**持久化会话分区**：

  ```js
  async generateAccountPartition(platform, account) {
    const safe = account.appId.replace(/[^a-zA-Z0-9]/g, '_');
    const partition = `persist:${platform}_${account.id}_${safe}`;   // ← 独立 cookie/localStorage/缓存
    // 若账号配置了代理：(settingsJson.proxy.enable && proxy.port > 0)
    const proxy = await window.electronAPI.createProxyChain(proxyPort, String(account.id));
    return { partition, proxyResult: proxy };
  }
  ```

- **UA 与 UA-CH 一起伪造**：`Xi()` 拼 `Mozilla/5.0 (Windows NT …) AppleWebKit/537.36 … Chrome/…`；
  `Zi()` 拼 `navigator.userAgentData` 的 `brands` / `fullVersionList` / `platform` / `architecture`。
- 另有 `webviews/fingerprint.js` + 主进程 IPC 通道 `db-account-fingerprint-upsert` → 指纹落库。

> 这印证了竞品那套「一号一 IP / 指纹隔离」在代码层的原貌：**一号一 partition + 一号一代理链 + UA/UA-CH 伪造**。

### 5. preload 桥：每个平台一份 DOM 适配器（隔离世界）

```
buildv8/webviews/
  webview-preload.js / webview-preload-line.js     ← 桥接入口（字节码）
  webviewController.js                             ← 按账号装载/重载
  transHandler.js                                  ← 解密 + 注入（见 §6）
  common/                                          ← 与平台无关的公共件
    index.js  domObserve(187 KB)  observe/ObserveManager
    interceptor/interactionInterceptor(88 KB)      ← 拦截「发送」动作
    replaceInput/  pendingOriginal  extraPage/{translationConfirmDialog,messageBar,AiRecommendCommon}
    ipcMethod/ipc_mainInvokeWeb  ipcMethod/ipc_webInvokemain  syncIPC  interval/someInterval
  <Platform>/                                      ← 每平台一份
    webview.js (混淆明文)  webview.css  webview.json {version: 如 5.2.57}
    index.enc（WhatsApp 563 KB / Telegram 14.5 KB）← 加密载荷（见 §6）
```

`webview.json` 里带版本号（WhatsApp `5.2.57`、LINE `1.8.9`、Telegram `3.5.31`），说明**适配脚本要跟着对方网页改版持续维护**。

以 WhatsApp 的 `webview.js` 为例（可直接读到常量数组），它做四件事：

**(a) 声明选择器** —— 直接吃对方的 DOM 结构，包括新版 WhatsApp 已经换成的 Lexical 编辑器：

```js
const selectors = {
  input: 'footer > div.copyable-area [data-lexical-editor="true"]',
  sendBtn: 'footer [data-tab="11"]:not([type="button"])',
  files: {
    inputBox: 'div[contenteditable="true"][aria-placeholder].x1lkfr7t',
    sendBtn:  'div.x1247r65.xng8ra div.x1n2onr6 [role="button"][aria-label][tabindex="0"]'
  },
  crm: { listener: '#pane-side', top: '#main header div:nth-child(2) span[dir="auto"]',
         lasttop: '#main header>div[role="button"]:nth-child(2)>div:nth-child(1)>div:last-child',
         leftPosition: 'prepend', loadOnChange: true }
};
// 其他散落选择器：
// [data-testid="msg-container"]  [data-testid="conversation-info-header-chat-title"]
// #pane-side div[role="gridcell"] [data-testid="cell-frame-title"] span[dir="auto"]
// div.xwib8y2 div.copyable-text span[dir]    div.x1n2onr6 > span[dir]
```

**(b) 给消息节点打自己的标记**（原文/译文成对落地）：

```
data-translated  data-translating  data-ai-recommend-done
data-msg-key  data-mid  data-original-value  data-chat-id  data-placeholder
```

**(c) 往对方 UI 里插自己的按钮**（带数量上限，避免刷屏）：

```js
[{ selector: '.retranslate-icon-btn', type: 'retrans',    maxUp: 1 },
 { selector: '.translate-btn',       type: 'translate',   maxUp: 1 },
 { selector: '.ai-recommend-btn',    type: 'ai-recommend',maxUp: 1 }]
```

**(d) 用自家侧栏顶掉对方侧栏** —— 把 WhatsApp 自带的 `#side` 隐藏，并用 500 ms 定时器反复压制，防止被页面重排还原：

```js
if (show) el.style.setProperty('display', 'flex', 'important');
else {
  el.style.setProperty('display', 'none', 'important');
  timer = setInterval(() => { if (el.style.display !== 'none')
      el.style.setProperty('display', 'none', 'important'); }, 500);
}
```

**(e) 顺手把页面自己的 localStorage 当身份源**：`last-wid-md`（当前登录 WID）、`WACachedProfilePicEURL`（头像）、以及几个 base64 名字的键 —— 用于判断「这个 webview 里登的是哪个号」。

### 6. 关键一步：运行时解密，注入页面「主世界」（绕过对方 CSP）

`buildv8/webviews/transHandler.jsc` 里的函数名和常量把这件事说得很清楚：

```
injectEncryptedJsForPlatform(platform, targetDoc)   injectEncryptedJs   injectEncryptedTelegramJs
injectJs   injectJsCsp   injectInlineScriptToDoc   injectScriptViaBlob   injectScriptViaBlobFromBinary   injectCss
createDecipheriv   deriveKeyPBKDF2   aes-256-cbc   sha256   iterations / keylen / saltLength / ivLength / setAutoPadding
WHATSAPP_SALT   TELEGRAM_SALT   wa-static-salt-v1   tg-static-salt-v1
encrypted-wa-inject   encrypted-tg-inject   my-wa-inject
'inline inject failed, try blob method'   'injectScriptViaBlobFromBinary timeout'
'targetDoc is null'   'targetDoc has no head/documentElement'   'Script load error: '
DOMContentLoaded   iframe   createObjectURL / revokeObjectURL
```

- **载荷是加密的**：`webviews/whatsapp/index.enc` 是高熵二进制（头部 `9e c9 11 b3 a2 d8 61 b3 …`），
  用 AES-256-CBC + PBKDF2-SHA256，按平台取静态盐（`wa-static-salt-v1` / `tg-static-salt-v1`）在运行时解密。
- **注入对象不是 preload 自己，而是页面的 main world**：
  先尝试内联 `<script>`，被 WhatsApp / Telegram 的 CSP 挡下后**退化为 `Blob` + `createObjectURL` 生成 script 标签**加载。
  目标是 webview 的 `contentDocument`；失败会报 `targetDoc has no head/documentElement`。
- 结论：**「打开对方网页，再往它自己的 JS 世界里塞代码」**，而不是改对方的安装包。

### 7. 两层 RPC + 出站拦截（业务能力的来源）

**协议**（preload 侧 → 页面侧）：用 `window.postMessage` 做双向 RPC，带 `callId` 与超时（10 s / 30 s 不等）。

```js
// preload → page
{ source: 'preload-rpc', type: 'RPC_CALL',  callId, method, args }
// page → preload
{ source: 'page-rpc',    type: 'RPC_RESPONSE', callId, result, error }
```

**方法名直接暴露能力边界** —— 这些不是 DOM 能拿到的，必须调页面内部对象：

```
currentActiveChatId      getContacts            getContactsForFansBase
getChatBuckets           getChatFriendByFriendId getChatPreviewByFriendId
sendBatchMessage         openFriendChat          markAllChatsAsRead
joinGroup / leaveGroup   generateGroupInviteCode addGroupMembers / removeGroupMembers
updateGroupName / updateGroupDescription         sendTtsVoiceToPage
```

→ 与 `whatsapp-web.js` 对 `window.Store` 的调用同源（chat / contact / group 集合操作）。
即：**DOM 负责「看见的」（渲染标记、插入按钮、藏侧栏），页面内部接口负责「拿得到的」（联系人、群成员、批量发送、标记已读）**。这是混合式。

**出站方向被显式拦截**（`common/interceptor/interactionInterceptor.jsc`）：

```
buildClickSendMessageParams   buildSendMessageParams   needSendBtnSend
beforSend   realSend   sendConfirm   sendConfirmCache   sendConfirmCancel
writeTextAndPaste   handleCopy   data-original-value
'translated-result selectable-text copyable-text'
```

账号字段里也有对应开关：

```js
{ autoTranslate: true, translateLanguage: 'zh',
  sourceLanguage: '', targetLanguage: '', confirmBeforeSend: true }
```

`confirmBeforeSend` + `translationConfirmDialog` = **发送前先看译文再发**。
`writeTextAndPaste` = 把译文写进对方编辑器并派发粘贴事件（把消息「交回」给对方页面自己发出去）。
`domObserve.jsc`（187 KB）负责收报文配对：`receiveTrans` / `receiveFromChinese` / `isSelfSend` / `data-translated`。

### 8. 反证：确认「没有」原生注入

在整包（含全部字节码）中检索以下特征，**全部为 0 命中**：

```
EnumWindows   FindWindow   FindWindowEx   SetWindowsHookEx   GetWindowThreadProcessId
GetForegroundWindow   user32   uiautomation
child_process + .exe（拉起/挂钩 WhatsApp.exe / Telegram.exe / WeChat.exe）
```

→ 它不读你的进程列表、不挂钩窗口、不操作已安装的桌面客户端。
（`main-e734435e.js` 里的 `taskList` 只是界面上的「任务列表」，不是 `tasklist.exe`。）

---

## 三、完整链路（一图话）

```
用户操作
  └─ Electron 主进程 (main.jsc)
       ├─ 建 <webview>：src=web.whatsapp.com，preload=webview-preload.js
       │   partition=persist:{app}_{accountId}_{app}   proxy=createProxyChain(port, accountId)
       │   useragent=伪造UA     webpreferences=…allowRunningInsecureContent=true
       ├─ session.loadExtension(extraExtensions/<LINE 官方扩展>)
       │
       ├─ preload（隔离世界）  webviews/<Platform>/webview.js（混淆明文）
       │    ├─ MutationObserver 观察 [data-testid="msg-container"]，打 data-translated / data-msg-key
       │    ├─ 插入 .translate-btn / .retranslate-icon-btn，隐藏对方 #side（500ms 压制）
       │    └─ window.postMessage({source:'preload-rpc', type:'RPC_CALL', …})
       │
       ├─ transHandler：解密 webviews/<Platform>/index.enc
       │      AES-256-CBC + PBKDF2-SHA256（wa-static-salt-v1）
       │      → 内联 <script> 注入页面的 main world
       │      → 被 CSP 挡下则 Blob + createObjectURL 兜底
       │
       └─ 页面 main world（解密后的载荷）
             ├─ 接管【收】：新消息 → 原文落库 → 翻译 → 回填，DOM 标 data-translated
             ├─ 接管【发】：拦 Enter/发送按钮 → 生成译文 → confirmBeforeSend 确认 → 写回编辑器
             └─ 应答 RPC：getContacts / getChatBuckets / sendBatchMessage / joinGroup …
```

---

## 四、对 CarDashboard 的三点判断

1. **这是「非官方路线」的第三条实现，前面没列出来。**
   §3 的结论（走非官方路线）依然成立，但载体有三种：Baileys 直连协议、`whatsapp-web.js` 驱动 Chromium、**Electron 套壳跑网页版**（本客户端）。
   第三种的最大好处是**天生自带 UI 与多开工作台形态**，正好对应我们要的「快捷插入栏」；代价是适配脚本必须跟着对方网页改版长期维护（`webview.json` 的版本号就是证据）。

2. **它的「注入」边界只在自家 webview 内。**
   不碰手机端、不碰用户已安装的客户端。所以老问题依旧：**业务员在手机上手打的对外消息仍然绕过翻译层**，「对外报价/技术类回复走电脑端」的约定仍然必要。

3. **可以直接借鉴的四点（都在本客户端里有现成做法）**
   - 一号一 partition + 一号一代理链 + UA/UA-CH 伪造 → 对应我们「少数几个号自用」的最小可用版本（不必上养号池那套）；
   - 消息节点用自定义属性配对原文/译文（`data-translated` / `data-original-value` / `data-msg-key`）→ 与「原文与译文分列存储、永不合并」一致；
   - 发送动作单独拦截 + `confirmBeforeSend` → 与「出站拆 draft/send 两步」一致；
   - 隐藏对方侧栏、用自家 UI 顶掉 → 印证「工作台」与「网页版客户端」的分水岭在**快捷插入栏**，不在聊天窗口本身。

⚠️ 同时注意它的两处「为注入让路」的做法，我们不应照抄：
`webSecurity=no` / `allowRunningInsecureContent=true`、以及对页面 localStorage 的直接读取（密钥以 base64 明文命名）。

---

## 附：分析方法留档

```bash
# app.asar 头部：u32@4 = 内层 header 长度，u32@12 = JSON 长度，JSON 从 offset 16 开始
#            文件数据基址 base = 8 + u32@4；注意 offset 字段是「字符串」
node asar.cjs <app.asar> list            # 列清单
node asar.cjs <app.asar> read  <内部路径>  # 取单文件
node asar.cjs <app.asar> extract <目录>    # 全量解包（4448 项）
node strings.cjs <file> 6                # 从 .jsc 字节码里抽字符串常量
# whichfile.cjs <app.asar> <lo> <hi>     # 由绝对偏移反查所属文件
```

`.jsc` 是 V8 字节码，反编译不可行，但字符串常量池完整保留 → 靠函数名、选择器、错误文案已足够定性。
