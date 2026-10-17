// 逐步复现 pickAll + pickMessageRows 的真实行为，定位 28 的来源
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const doc = new JSDOM(readFileSync(process.argv[2], 'utf8')).window.document;

const bubbleRow = [
  '[data-testid^="conv-msg-"]:has([data-testid="msg-container"])',
  '[data-testid^="conv-msg-"]',
  '#main [data-id]:has([data-testid="msg-container"])',
];

const messageRoot = [
  '#main [data-testid="conversation-panel-messages"]',
  '#main .copyable-area',
  '#main',
];

// 模拟 pick
function pick(root, cands) {
  for (const s of cands) { const f = root.querySelector(s); if (f) return f; }
  return null;
}
function pickAll(root, cands) {
  for (const s of cands) { const f = root.querySelectorAll(s); if (f.length > 0) return Array.from(f); }
  return [];
}

const matched = pick(doc, messageRoot);
const rootLabel = messageRoot.find((s) => doc.querySelector(s) === matched) ?? '回落';
const root = matched ?? doc.querySelector('#main');
console.log('消息根:', rootLabel);

console.log('\n=== 逐个候选的命中数（在消息根内部）===');
for (const s of bubbleRow) {
  let n;
  try { n = root.querySelectorAll(s).length; } catch (e) { n = `抛异常: ${e.message}`; }
  console.log(`  ${n}\t${s}`);
}

console.log('\n=== pickAll 会返回哪一个 ===');
const raw = pickAll(root, bubbleRow);
console.log('  raw.length =', raw.length);
console.log('  实际用的是候选:', bubbleRow.find((s) => root.querySelectorAll(s).length === raw.length));

console.log('\n=== 代码层兜底过滤 ===');
const hasContent = raw.filter((r) => r.querySelector('[data-testid="msg-container"]') !== null);
console.log('  raw =', raw.length, '｜含容器 =', hasContent.length);
const final = hasContent.length === raw.length ? raw : (hasContent.length > 0 ? hasContent : raw);
console.log('  pickMessageRows 返回 =', final.length);

console.log('\n=== 消息根全量核对 ===');
for (const s of messageRoot) {
  const el = doc.querySelector(s);
  console.log(`  ${el ? el.querySelectorAll('[data-testid^="conv-msg-"]').length : 'null'}\t${s}`);
}
