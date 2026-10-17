#!/usr/bin/env node
/**
 * 构建后断言：preload 产物必须是**自包含**的单文件。
 *
 * 为什么必须有这道检查：
 *   注入脚本跑在**沙箱渲染进程**里，沙箱下 preload 的 `require` 只认
 *   `electron` / `events` / `timers` / `url` 这几个内置模块，
 *   **不能加载相对路径的本地文件**。
 *
 *   而打包器默认会把「两个 preload 入口都引用的模块」抽成公共 chunk
 *   （如 `chunks/ipc-xxxx.js`）。一旦出现，注入脚本一加载就报
 *   "module not found"，而且**报错只会在用户的机器上出现**，
 *   本地构建全程绿灯 —— 是最难排查的那类故障。
 *
 *   所以这里把它从「靠自觉」变成「构建期硬失败」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../apps/desktop/out/preload');

const REQUIRED = ['index.js', 'wa-inject.js'];
/** 相对路径 require / import，在沙箱 preload 里一律不可用 */
const RELATIVE_REQUIRE = /\brequire\(\s*["']\.\.?\//;

const problems = [];

if (!fs.existsSync(outDir)) {
  problems.push(`preload 产物目录不存在：${outDir}`);
} else {
  const entries = fs.readdirSync(outDir);

  for (const name of REQUIRED) {
    if (!entries.includes(name)) problems.push(`缺少产物文件：${name}`);
  }

  for (const name of entries) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(outDir, name);
    const code = fs.readFileSync(file, 'utf8');

    const rel = code.match(RELATIVE_REQUIRE);
    if (rel) {
      problems.push(
        `${name} 含相对路径依赖（${rel[0]}…）—— 沙箱 preload 加载不到，注入脚本会在运行时失败`,
      );
    }
  }

  const chunksDir = path.join(outDir, 'chunks');
  if (fs.existsSync(chunksDir) && fs.readdirSync(chunksDir).length > 0) {
    problems.push(
      `存在公共 chunk 目录 out/preload/chunks/ —— 说明两个 preload 入口共享了运行时模块。` +
        `请把被共享的模块拆开（见 packages/shared/src/translate.ts 中 INJECT_IPC 的说明）`,
    );
  }
}

if (problems.length > 0) {
  console.error('\n[check-preload] ✗ preload 产物自包含性检查未通过：\n');
  for (const p of problems) console.error(`  · ${p}`);
  console.error('');
  process.exit(1);
}

console.log('[check-preload] ✓ preload 产物自包含（无相对依赖、无公共 chunk）');
