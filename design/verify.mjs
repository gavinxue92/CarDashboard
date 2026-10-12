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

console.log('');
if (failed) {
  console.log(failed + ' 项未通过');
  process.exit(1);
}
console.log('全部通过');
