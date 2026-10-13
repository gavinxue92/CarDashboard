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
check('prototype: 关键容器存在', ['id="list"', 'id="body"', 'id="input"', 'id="send"'].every(s => html.includes(s)));
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

const zhCount = (html.match(/\bzh:\s*'/g) || []).length;
const enCount = (html.match(/\ben:\s*'/g) || []).length;
check('数据模型: 每条消息同时保留原文与译文', zhCount > 0 && zhCount === enCount, zhCount + ' vs ' + enCount);

const required = ['## 一、', '## 二、', '## 三、', '## 四、', '## 五、', '## 六、'];
check('DESIGN.md: 六个章节齐全', required.every(s => md.includes(s)));
check('DESIGN.md: 记录了未采纳的改动', md.includes('未采纳'));
check('DESIGN.md: 记录了预留入口清单', md.includes('四、预留给后续模块的入口'));

// ---- UNOFFICIAL-ROUTE.md ----
const route = readFileSync(join(root, 'UNOFFICIAL-ROUTE.md'), 'utf8');
check('ROUTE.md: 六个章节齐全', required.every(s => route.includes(s)));
check('ROUTE.md: 记录了决定与被接受的代价', route.includes('违反') && route.includes('ToS') && route.includes('封号作用于号码本身'));
check('ROUTE.md: 明示产品不可对外销售', route.includes('不可对外销售'));
check('ROUTE.md: 写明迁移预案', route.includes('迁移预案') && route.includes('CloudApiAdapter'));
check('ROUTE.md: 两个库的取舍均有对比', route.includes('Baileys') && route.includes('whatsapp-web.js'));

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

console.log('');
if (failed) {
  console.log(failed + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
