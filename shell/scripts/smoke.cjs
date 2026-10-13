'use strict';
/* smoke：以 --smoke 启动 Electron 壳，窗口加载完 index.html 即退出。
 * 通过 = 退出码 0。不依赖外网（不等待 web.whatsapp.com）。 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const r = spawnSync(process.execPath, [path.join(__dirname, 'launch.cjs'), '--smoke'], {
  stdio: 'inherit',
  windowsHide: true
});
process.exit(r.status == null ? 1 : r.status);
