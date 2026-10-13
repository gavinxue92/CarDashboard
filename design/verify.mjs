import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
let failed = 0;

function check(name, ok, detail = '') {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  -> ' + detail));
  if (!ok) failed++;
}

const html = readFileSync(join(root, 'prototype.html'), 'utf8');
const md = readFileSync(join(root, 'DESIGN.md'), 'utf8');

check('prototype: 有 DOCTYPE 与 lang', /^<!DOCTYPE html>/i.test(html) && html.includes('lang="zh-CN"'));
check('prototype: 根标签闭合', html.trim().endsWith('</html>'));
check('prototype: 关键容器存在', ['id="waList"', 'id="waMsgs"', 'id="waInput"', 'id="waSend"', 'id="confirm"', 'id="dialog"'].every(s => html.includes(s)));
check('prototype: 预留项均标注 data-reserved', (html.match(/data-reserved=/g) || []).length >= 8);
check('prototype: 无外部依赖（可离线打开）', !/<script[^>]+src=/.test(html) && !/<link[^>]+href="http/.test(html));

const m = html.match(/<script>([\s\S]*?)<\/script>/);
check('prototype: 存在内联脚本', !!m);
if (m) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-verify-'));
  const jsPath = join(dir, 'inline.js');
  writeFileSync(jsPath, m[1], 'utf8');
  try {
    execFileSync(process.execPath, ['--check', jsPath], { stdio: 'pipe' });
    check('prototype: 内联脚本语法正确', true);
  } catch (e) {
    check('prototype: 内联脚本语法正确', false, String(e.stderr || e.message).slice(0, 400));
  }
}

// ---- prototype.html v3：对话交互形态（§三）+ 会话组织模式（§四） ----
const bodyCount = (html.match(/\bbody:\s*\{/g) || []).length;
const transCount = (html.match(/\btranslation:/g) || []).length;
check('原型: 消息模型把方向与语言解耦（body/translation 成对）', bodyCount > 0 && bodyCount === transCount, bodyCount + ' vs ' + transCount);
check('原型: body 携带 lang（语言是数据不是代码）', /body:\s*\{\s*text:[^}]*lang:/.test(html));
check('原型: translation 携带 state（翻译状态）', /translation:\s*\{[^}]*state:/.test(html));
check('原型: 消息有发送状态 delivery', /delivery:\s*'(sending|sent|delivered|read|failed)'/.test(html));
check('原型: 五种翻译状态齐备', ['none', 'pending', 'done', 'failed', 'skipped'].every(s => html.includes("'" + s + "'")));
check('原型: 主气泡按语言选边（不再按方向猜原文）', html.includes('const OUR_LANG') && html.includes('m.body.lang === OUR_LANG'));
check('原型: origin=phone 在气泡上可见', html.includes("origin: 'phone'") && html.includes('手机端 · 未经翻译'));
check('原型: 消息悬浮操作条含必备动作', ['复制', '重译', '引用回复', '收藏为话术', '撤回'].every(s => html.includes(s)) && html.includes('msg-bar'));
check('原型: 出站确认层存在且译文可就地编辑', html.includes('id="confirm"') && html.includes('id="pvBody"') && html.includes('contentEditable'));
check('原型: 译文就绪前禁用「确认并发出」', html.includes('ok.disabled = true') && html.includes('翻译中…'));
check('原型: 术语命中给可点标记', html.includes('const glossary') && html.includes('data-term') && html.includes('术语 · '));
check('原型: 不再输出失效的窗口信息', !/窗口已关|窗口内 |窗口剩 |需模板消息触达|可自由回复/.test(html));
check('原型: 待跟进在列表与会话头均有注入标注（不再有列表徽章/标题行自绘）',
  html.includes("'待跟进 · '") && html.includes('inj-tag-inline') && (html.match(/待跟进/g) || []).length >= 3);
check('原型: 账号维度 = 左栏切号（头像 + 账号弹层 + 连接状态）',
  html.includes('id="acctAvatar"') && html.includes('id="acctPop"') && html.includes('s-ok') && html.includes('需重新扫码') && html.includes('连接断开'));
check('原型: 右栏为功能工具栏（拓译形态，9 入口），不再常驻右栏',
  ['翻译设置', '代理设置', '客户信息', 'AI问答', '快捷消息', '群发', '群管理', '工单管理', '语音输入'].every(s => html.includes(s)) &&
  !html.includes('class="col-side"'));
check('原型: 客户信息与快捷消息走弹层（拓译形态）',
  html.includes('id="custPop"') && html.includes('id="quickPop"') && html.includes('id="recoPop"'));
check('原型: 网页版自己的会话列表（拓译形态：列表是网页版的，我们只注入）',
  html.includes('class="wa-list"') && html.includes('data-wf="all"') && html.includes('特别关注') && html.includes('群组'));
check('原型: 群组按会话类型处理（类型字段 + 群名直显）', html.includes("type: 'group'") && html.includes("phone: '尼日利亚重卡采购群'"));
check('原型: 列表显示手机号/群名（CRM 字段不在网页版伪装）',
  html.includes('+234 803 386 4565') && html.includes('客户档案（注入面板'));
check('原型: 插入 ≠ 发送（话术代写进网页版输入框成草稿）',
  html.includes('插入 ≠ 发送') && html.includes('已代写进网页版输入框') && html.includes('state.draft'));

// ---- prototype.html v5：拓译形态（整块网页版 + 左右窄栏 + 编辑账号弹窗） ----
check('原型: 中间整块标注为官方网页版（含它自己的会话列表）',
  html.includes('此区域 = 官方网页版') && html.includes('web.whatsapp.com') && html.includes('橙色虚线 = 我们注入'));
check('原型: 宿主提示给出适配版本号', html.includes('适配 v5.2.57'));
check('原型: 注入部分有显式标记（.inj + .inj-tag）',
  html.includes('.inj { border-left: 2px dashed') && (html.match(/inj-tag/g) || []).length >= 4);
check('原型: 注入标记覆盖四类（原文副行 / 翻译状态 / 缺口标记 / 消息操作条）',
  ['注入 · 原文', '注入 · 翻译状态', '注入 · 缺口标记', '注入 · 消息操作条'].every(s => html.includes(s)));
check('原型: 输入框归属网页版（原生 contenteditable，不自绘输入框）',
  html.includes('id="waInput"') && html.includes('contenteditable="true"') && !html.includes('<input id="input"'));
check('原型: 外圈 = 左右窄栏 + 弹层（显式标注「我们的」）',
  html.includes('我们的<br>账号栏') && html.includes('功能工具栏（我们的 DOM') || html.includes('右栏：功能工具栏（我们的'));
check('原型: 编辑账号弹窗 = 翻译模式唯一配置入口（拓译同款配置项）',
  ['接收自动翻译', '发送自动翻译', '群聊翻译显示', '群聊自动翻译', '个人历史翻译', '群组历史翻译', '禁发中文', '发送确认',
   '翻译渠道', '对方语言', '我的语言', '推荐回复'].every(s => html.includes(s)));
check('原型: 注入模式行（渠道 × 语言对 + 禁发中文/发送确认）',
  html.includes('id="modeLine"') && html.includes('将[') && html.includes('翻译为 ['));
check('原型: 翻译面板含推荐回复 / 商务角色 / 历史翻译（拓译同款）',
  html.includes('推荐回复') && html.includes('商务 (business)') && html.includes('历史消息不翻译'));
check('原型: 发送确认默认开，且面板标明关闭的风险',
  html.includes('tgConfirm: true') && html.includes('发送确认」已关') || html.includes('这条中文被拦下'));
check('原型: 禁发中文默认开，关闭发送确认后中文被拦', html.includes('tgBan: true') && html.includes('禁发中文已开启'));
check('原型: 出站确认层标注为二期并说明被拦截',
  html.includes('class="badge2">二期') && html.includes('已被圈一 preload 拦下'));
check('原型: 取消后草稿保留（不静默清空）', html.includes('草稿仍留在网页版输入框里'));
check('原型: 放行后声明落库三份', html.includes('落库三份：原文 / 译文 / 实际发出'));

const mdRequired = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、'];
check('DESIGN.md: 六个章节齐全', mdRequired.every(s => md.includes(s)));
check('DESIGN.md: 记录了未采纳的改动', md.includes('未采纳'));
check('DESIGN.md: 记录了预留入口清单', md.includes('四、预留给后续模块的入口'));
check('DESIGN.md: 已同步为 v5 并指向 SHELL-ROUTE.md', md.includes('设计说明（v5）') && md.includes('SHELL-ROUTE.md'));
check('DESIGN.md: 布局图标明中间是官方网页版', md.includes('<webview>（别人的页面，整块）'));
check('DESIGN.md: v5 变更表逐条记录用户反馈', md.includes('v5 相对 v4 的变更') && md.includes('为什么左侧聊天列表还是自绘的'));
check('DESIGN.md: 就地记录被推翻的 v3/v4 结论', md.includes('v5 被推翻的 v3/v4 结论') && md.includes('常驻'));

// ---- UNOFFICIAL-ROUTE.md ----
const route = readFileSync(join(root, 'UNOFFICIAL-ROUTE.md'), 'utf8');
check('ROUTE.md: 六个章节齐全', mdRequired.every(s => route.includes(s)));
check('ROUTE.md: 记录了决定与被接受的代价', route.includes('违反') && route.includes('ToS') && route.includes('封号作用于号码本身'));
check('ROUTE.md: 明示产品不可对外销售', route.includes('不可对外销售'));
check('ROUTE.md: 写明迁移预案', route.includes('迁移预案') && route.includes('CloudApiAdapter'));
check('ROUTE.md: 两个库的取舍均有对比', route.includes('Baileys') && route.includes('whatsapp-web.js'));
check('ROUTE.md: 已就地标注载体变更', route.includes('载体已更新（2026-10-13）') && route.includes('WebviewBridgeAdapter'));
check('ROUTE.md: 标出第三个候选并说明已采用', route.includes('Electron 套壳官方网页版'));
check('ROUTE.md: 阶段表 P3/P4 标注作废并指向 S0–S5', route.includes('已作废') && route.includes('S0–S5'));

// 通道契约必须给出两个接口，且花括号配对
const tsBlock = (route.match(/```ts\n([\s\S]*?)```/) || [])[1] || '';
check('ROUTE.md: 给出通道契约代码块', tsBlock.length > 0);
check('ROUTE.md: 契约含两个核心接口', tsBlock.includes('interface NormalizedMessage') && tsBlock.includes('interface ChannelAdapter'));
check('ROUTE.md: 契约含 origin 字段（区分手机手打）', /\borigin:/.test(tsBlock) && tsBlock.includes("'phone'"));
check('ROUTE.md: 契约花括号配对', (() => {
  let d = 0;
  for (const ch of tsBlock) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; }
  return d === 0;
})(), '括号不平衡');
check('ROUTE.md: 说明通道层可插拔', route.includes('MockAdapter') && route.includes('BaileysAdapter'));
check('ROUTE.md: 有使用纪律一节而非反检测工程', route.includes('不是「反检测工程」') && route.includes('不做大规模群发'));
check('ROUTE.md: 明示开工需用户点头', route.includes('未经明确同意不擅自开工'));

// ---- REF-TUOYI.md（第三方客户端接入方式逆向分析） ----
const ref = readFileSync(join(root, 'REF-TUOYI.md'), 'utf8');
check('REF-TUOYI.md: 七层证据与结论齐全', ref.includes('## 一、结论') && ref.includes('## 二、七层证据') && ref.includes('## 四、对 CarDashboard'));
check('REF-TUOYI.md: 明确否定原生客户端注入', ref.includes('不碰 WhatsApp Desktop') && ref.includes('全部为 0 命中'));
check('REF-TUOYI.md: 记录 Electron + webview 套壳结论', ref.includes('Electron 套壳') && ref.includes('webviewTag'));
check('REF-TUOYI.md: 记录一号一 partition 与代理链', ref.includes('persist:${platform}_${account.id}') && ref.includes('createProxyChain'));
check('REF-TUOYI.md: 记录 AES-256-CBC + PBKDF2 解密注入', ref.includes('aes-256-cbc') && ref.includes('createDecipheriv') && ref.includes('index.enc'));
check('REF-TUOYI.md: 记录 preload/page 两层 RPC 协议', ref.includes("source: 'preload-rpc'") && ref.includes("source: 'page-rpc'"));
check('REF-TUOYI.md: 指出不应照抄的不安全做法', ref.includes('allowRunningInsecureContent=true') && ref.includes('不应照抄'));
check('REF-TUOYI.md: 不写入任何凭据或密钥值', !/(password|token|secret)\s*[:=]\s*['"][^'"]+['"]/i.test(ref));

// ---- CONVERSATION-MODE.md（客户对话模式 v3 设计） ----
const conv = readFileSync(join(root, 'CONVERSATION-MODE.md'), 'utf8');
const convChapters = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、', '## 七、', '## 八、', '## 九、'];
check('CONV.md: 九个章节齐全', convChapters.every(s => conv.includes(s)));
check('CONV.md: 逐条列出重做原因且带证据', conv.includes('现状证据') && conv.includes('## 一、为什么要重做'));
check('CONV.md: 修正 24 小时窗口这一失效指标', conv.includes('24 小时窗口') && conv.includes('官方 Cloud API 的约束') && conv.includes('误导信息'));
check('CONV.md: 记录账号维度缺失并给出调和方案', conv.includes('账号切换器') && conv.includes('不推翻该决定'));
check('CONV.md: 恢复群组并说明理由', conv.includes('群组') && conv.includes('路线变更后恢复'));
check('CONV.md: 对 REF-TUOYI.md 的快捷插入栏结论做勘误', conv.includes('勘误') && conv.includes('不是抄来的'));
check('CONV.md: origin=phone 必须在界面可见', conv.includes('origin=phone') && conv.includes('未经翻译'));
check('CONV.md: 插入不等于发送（不许绕过译文确认）', conv.includes('插入 ≠ 发送'));
check('CONV.md: 翻译开关章节标注决策状态', conv.includes('决策已定') && conv.includes('## 五、翻译开关粒度'));
check('CONV.md: 阶梯 L0–L4 逐档逐项列出', ['L0', 'L1', 'L2', 'L3', 'L4'].every(s => conv.includes('**' + s + ' —')));
check('CONV.md: 决策记录含 6 项采纳明细', conv.includes('### 决策记录') && conv.includes('L1 全部 4 项 + L2 的 1 项 + L4 的术语可视化 1 项 = 6 项'));
check('CONV.md: 列出明确排除项与开放项', conv.includes('明确排除（6 项）') && conv.includes('开放项（本轮不定）'));
check('CONV.md: 24 小时窗口三处全换成待跟进（已确认）', conv.includes('全部换成「待跟进」') && conv.includes('三处'));
check('CONV.md: 不抄清单存在且含关键项', conv.includes('## 七、不抄清单') && conv.includes('allowRunningInsecureContent=true') && conv.includes('声音克隆'));
check('CONV.md: 明确本轮不改原型与代码', conv.includes('只出设计文档') && conv.includes('不改 `prototype.html`'));

const convTs = (conv.match(/```ts\n([\s\S]*?)```/g) || []).join('\n');
check('CONV.md: 给出数据结构改动代码块', convTs.includes('interface ChatMessage') && convTs.includes('CustomerPrefs') && convTs.includes('interface ChatSession'));
check('CONV.md: 数据结构代码块花括号配对', convTs.length > 0 && [...convTs].reduce((d, ch) => (ch === '{' ? d + 1 : ch === '}' ? d - 1 : d), 0) === 0, '括号不平衡');
check('CONV.md: 标明增量字段而非新发明', conv.includes('真正的增量只有'));
check('CONV.md: 不写入任何凭据或密钥值', !/(password|token|secret)\s*[:=]\s*['"][^'"]+['"]/i.test(conv));
check('CONV.md: 已标注套壳导致 §三 C 形态被推翻',
  conv.includes('本条形态被推翻') && conv.includes('只剩一条路') && conv.includes('SHELL-ROUTE.md'));
check('CONV.md: 已标注载体变更（两次）并说明列表/右栏归属变更',
  conv.includes('载体已更新（2026-10-13，两次）') && conv.includes('列表交还网页版') && conv.includes('功能工具栏 + 弹层'));
check('CONV.md: 记录发送确认开关的放开与默认值底线',
  conv.includes('开关还给用户，默认值替用户把关') && conv.includes('发送确认=开'));

// ---- SHELL-ROUTE.md（套壳路线实施方案） ----
const shell = readFileSync(join(root, 'SHELL-ROUTE.md'), 'utf8');
const shellChapters = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、', '## 七、', '## 八、', '## 九、'];
check('SHELL.md: 九个章节齐全', shellChapters.every(s => shell.includes(s)));
check('SHELL.md: 记录用户决定原话与配套决策',
  shell.includes('我需要套壳，套壳后再进行扩展') && shell.includes('对话区归属') && shell.includes('一期只做观测同步'));
check('SHELL.md: 记录 v5 二次决定（布局完全照拓译）',
  shell.includes('2026-10-13 二次决定') && shell.includes('整块网页版（含它自己的会话列表）+ 左右两条窄栏'));
check('SHELL.md: §5.4 已标注自绘列表被推翻并给出新方案',
  shell.includes('自绘会话列表依然是对的」已被用户推翻') && shell.includes('网页版原生列表 + 注入标注'));
check('SHELL.md: 给出三圈扩展与下沉纪律',
  shell.includes('**外圈**') && shell.includes('**圈一**') && shell.includes('**圈二**') && shell.includes('绝不下沉'));
check('SHELL.md: 说明 webview 优于 WebContentsView 的硬理由',
  shell.includes('webviewTag') && shell.includes('WebContentsView') && shell.includes('出站确认层必须覆盖对话区'));
check('SHELL.md: 显式记录幂等是套壳路线的头号风险',
  shell.includes('幂等是套壳路线的头号风险') && shell.includes('messageId'));
check('SHELL.md: 声明通道契约不变、只新增实现',
  shell.includes('WebviewBridgeAdapter') && shell.includes('一字不改'));
check('SHELL.md: 给出分期 S0–S5 与验收标准',
  ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'].every(s => shell.includes('**' + s + ' ·')) && shell.includes('真扫码'));
check('SHELL.md: 显式记录被这条路推翻的既有设计',
  shell.includes('被这条路**推翻**的既有设计') && shell.includes('CONVERSATION-MODE.md` §三 C'));
check('SHELL.md: 不抄清单含 webSecurity 与 AES 注入',
  shell.includes('allowRunningInsecureContent=true') && shell.includes('index.enc'));
check('SHELL.md: 不写入任何凭据或密钥值', !/(password|token|secret)\s*[:=]\s*['"][^'"]+['"]/i.test(shell));

console.log('');
if (failed) {
  console.log(failed + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
