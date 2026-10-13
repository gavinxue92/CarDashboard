'use strict';
/* 统一启动器：清掉宿主终端可能注入的 ELECTRON_RUN_AS_NODE（WorkBuddy 等 Electron 宿主带此变量，
 * 不清会让壳退化成纯 Node），再拉起 electron。
 * 用法：node scripts/launch.cjs [--smoke] */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const electronBin = require('electron'); // 在包内解析为二进制路径
const appDir = path.join(__dirname, '..');
const extraArgs = process.argv.slice(2); // 如 --smoke

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(electronBin, [appDir, ...extraArgs], { stdio: 'inherit', windowsHide: true, env });
if (r.error) {
  console.error('[launch] 启动失败：', r.error.message);
  process.exit(1);
}
process.exit(r.status == null ? 1 : r.status);
