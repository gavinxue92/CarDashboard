#!/usr/bin/env node
/**
 * 打包产物验证（`pnpm verify:release`）。
 *
 * ── 为什么需要这一步 ──────────────────────────────────────────────
 *
 * 2026-10-14 的真实教训：`pnpm test` 全绿、`pnpm build` 全绿，
 * 但使用者手上那个安装包比生产修复**早了一个小时** —— 源码是新的，包是旧的。
 * 于是「两个真实缺陷修好了吗」这个问题的答案，在源码层面是「修了」，
 * 在交付层面是「没有」。这类问题只有**验包**才能发现，验源码永远发现不了。
 *
 * 所以本脚本做两件事，缺一不可：
 *   ① **一致性**：把 app.asar 里的主进程 / preload 产物抠出来，与当前构建产物
 *      逐字节哈希比对。不一致 = 你验的不是你打的那个包（或是旧包），直接失败。
 *   ② **可用性**：真的拉起打包后的 CarDashboard.exe 跑一遍核心链路
 *      （启动 → 版本号 → 打开翻译设置 → 开总开关 → 保存 → 弹窗关闭 → 落盘 enabled:true）。
 *
 * 用法：
 *   pnpm verify:release                                  # 自动探测产物目录
 *   node scripts/verify-release.mjs apps/desktop/release-tmp
 *
 * 隔离：给被测客户端独立的 `CD_USER_DATA_DIR` 临时目录，绝不碰使用者的
 * `%APPDATA%\CarDashboard`（那里存着 WhatsApp 登录态）。
 * 兼容：默认设 `CD_COMPAT_MODE=1`，原因见 apps/desktop/src/main/graphics.ts。
 */
import { _electron as electron } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoRoot, 'apps', 'desktop');

const failures = [];
function check(label, pass, extra = '') {
  console.log(`${pass ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!pass) failures.push(label);
}

// ── 定位产物目录 ─────────────────────────────────────────────────────
//
// 依次探测：命令行参数 → release-tmp → release。
// 为什么要把 release-tmp 排在前面：某些受限环境里 `release/win-unpacked` 删不掉
// （删除被接到回收站并 fail-closed），此时只能换输出目录绕开，见 README「调试须知」。
function resolveOutDir() {
  const candidates = [
    process.argv[2],
    path.join(appDir, 'release-tmp'),
    path.join(appDir, 'release'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'win-unpacked', 'resources', 'app.asar'))) return path.resolve(dir);
  }
  return null;
}

const outDir = resolveOutDir();
if (!outDir) {
  console.error('✗ 找不到任何含 win-unpacked/resources/app.asar 的产物目录。请先执行：pnpm pack:win');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const exe = path.join(outDir, 'win-unpacked', 'CarDashboard.exe');
const asar = path.join(outDir, 'win-unpacked', 'resources', 'app.asar');
const setup = path.join(outDir, `CarDashboard-Setup-${version}.exe`);

console.log(`产物目录：${outDir}`);
console.log(`目标版本：${version}`);
console.log('');

check('安装包存在', fs.existsSync(setup), fs.existsSync(setup) ? `${(fs.statSync(setup).size / 1024 / 1024).toFixed(1)}MB` : setup);
check('win-unpacked/CarDashboard.exe 存在', fs.existsSync(exe));
check('app.asar 存在', fs.existsSync(asar));

// ── ① 一致性：asar 内产物 vs 当前构建产物 ────────────────────────────
const hashOf = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
const asarBin = path.join(repoRoot, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');

// ⚠️ asar 内的路径在 Windows 上就是**反斜杠**（`\out\main\index.js`），
// 传正斜杠会报 `"..." was not found in this archive`，所以用 path.join 生成。
const ARTIFACTS = [
  path.join('out', 'main', 'index.js'),
  path.join('out', 'preload', 'index.js'),
  path.join('out', 'preload', 'wa-inject.js'),
  path.join('out', 'renderer', 'index.html'),
];

let drift = 0;
for (const rel of ARTIFACTS) {
  // main/index.js 与 preload/index.js 同名，各用独立目录，避免互相覆盖
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-asar-'));
  const result = spawnSync(process.execPath, [asarBin, 'extract-file', asar, rel], {
    cwd: tmp,
    encoding: 'utf8',
  });
  const extracted = path.join(tmp, path.basename(rel));
  const built = path.join(appDir, rel);
  if (!fs.existsSync(extracted)) {
    check(`asar 内含 ${rel}`, false, (result.stderr ?? '').trim().split('\n')[0] || '提取失败');
    drift += 1;
    continue;
  }
  const a = hashOf(extracted);
  const b = hashOf(built);
  check(`asar 内 ${rel} 与当前构建产物一致`, a === b, `${a} vs ${b}`);
  if (a !== b) drift += 1;
}

if (drift > 0) {
  console.error('');
  console.error('⚠️ 包内产物与当前构建产物不一致 —— 你验的不是刚打出来的包。');
  console.error('   最常见原因：拿错了输出目录，或打包时没有先跑 pnpm build。');
  process.exit(1);
}

/**
 * 已知缺陷的**结构性**护栏：提示条查询必须是类名（带前导点）。
 *
 * 背景：`composerHintPresent()` 曾写成 `querySelector(`${CLS}-hint`)`（按**标签名**查，
 * 永远查不到），导致出向翻译失败时那条「消息未发出」的提示显示不出来 ——
 * 红线本身生效，但使用者以为消息发出去了。esbuild 会保留模板字符串与 CLS 变量，
 * 所以能在产物里精确区分修与未修。
 */
const waInject = fs.readFileSync(path.join(appDir, 'out', 'preload', 'wa-inject.js'), 'utf8');
check(
  '注入产物用类名选择器查提示条（缺陷回归护栏）',
  waInject.includes('querySelector(`.${CLS}-hint`)') && !waInject.includes('querySelector(`${CLS}-hint`)'),
);

// ── ② 可用性：真的把打包后的客户端拉起来 ─────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-verify-'));
const env = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
// 执行上下文可能注入它，会让 Electron 退化成纯 Node（app 是 undefined）
delete env.ELECTRON_RUN_AS_NODE;
env.CD_USER_DATA_DIR = userDataDir;
env.CD_COMPAT_MODE = '1';

const app = await electron.launch({ executablePath: exe, cwd: path.dirname(exe), env });
const page = await app.firstWindow();

const rendererErrors = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  // 外网资源失败与被测逻辑无关（本脚本不要求能连境外）
  if (/net::ERR_|Failed to load resource/i.test(msg.text())) return;
  rendererErrors.push(msg.text());
});
page.on('pageerror', (err) => rendererErrors.push(String(err)));

await page.waitForSelector('.app-sidebar', { timeout: 30_000 });
check('打包产物能启动到主界面', true);

const info = await page.evaluate(async () => await window.cd.appInfo());
check(`产物版本号 = ${version}`, info.appVersion === version, `实际 ${info.appVersion}`);

const titleRole = (await page.locator('.app-titlebar__role').textContent()) ?? '';
check(`标题栏显示 v${version}`, titleRole.includes(version), titleRole);

// 核心回归：翻译设置保存链路（不需要 WhatsApp 账号）
await page.locator('.rail-btn', { hasText: '翻译设置' }).click();
await page.waitForSelector('.modal', { timeout: 10_000 });
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll('.modal__footer .btn')].find((b) =>
    b.textContent?.includes('保存修改'),
  );
  return btn instanceof HTMLButtonElement && !btn.disabled;
});

const switchLocator = page.locator('.tr-row:has(.tr-row__label:text-is("是否启用")) .switch');
check('总开关默认关闭', (await switchLocator.getAttribute('aria-checked')) === 'false');

await switchLocator.click();
await page.locator('.modal__footer button', { hasText: '保存修改' }).click();
await page.waitForSelector('.modal', { state: 'detached', timeout: 10_000 });
check('保存后弹窗关闭', true);

// 落盘走 200ms 防抖，轮询而不是固定等待
const configPath = path.join(userDataDir, 'config.json');
let persisted = false;
for (let i = 0; i < 50 && !persisted; i += 1) {
  try {
    persisted = JSON.parse(fs.readFileSync(configPath, 'utf8')).translate?.enabled === true;
  } catch {
    // 还没写出来
  }
  if (!persisted) await new Promise((r) => setTimeout(r, 100));
}
check('config.json 落盘 enabled:true', persisted, configPath);

const readBack = await page.evaluate(async () => (await window.cd.settings.get()).enabled);
check('IPC 读回 enabled:true', readBack === true);

const attentionGone = await page
  .locator('.rail-btn--attention')
  .waitFor({ state: 'detached', timeout: 5_000 })
  .then(() => true)
  .catch(() => false);
check('功能栏「未启用」提示消失', attentionGone);

check('渲染层无我方报错', rendererErrors.length === 0, rendererErrors.slice(0, 3).join(' | '));

await app.close();

// 临时目录交给脱离子进程去删：本机删除一个目录要 ~30 秒，不能挂住验证流程。
// 必须用 spawn（异步）+ unref；spawnSync 是同步的，detached 对它没有意义。
try {
  const child = spawn(
    process.execPath,
    ['-e', 'const fs=require("node:fs");try{fs.rmSync(process.argv[1],{recursive:true,force:true})}catch{}', userDataDir],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
} catch {
  // 删不掉不影响结论
}

console.log('');
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项：${failures.join('；')}`);
  process.exit(1);
}
console.log(`产物验证全部通过（${setup}）`);
