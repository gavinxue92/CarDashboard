#!/usr/bin/env node
/**
 * Windows 打包入口（`pnpm pack:win` 的实际执行体）。
 *
 * ── 为什么需要这个包装脚本，而不是直接写 electron-builder ──────────────
 *
 * 打包期 electron-builder 要从**两个不同的地方**下载二进制：
 *   1. Electron 本体（经 @electron/get）—— 受 `ELECTRON_MIRROR` 控制；
 *   2. 打包工具链 nsis / winCodeSign / 7zip（经 electron-builder-binaries）—— 受
 *      `ELECTRON_BUILDER_BINARIES_MIRROR` 控制。
 *
 * 这两处的镜像**只能通过进程环境变量指定**。`.npmrc` 里写的
 * `electron_mirror` / `electron_builder_binaries_mirror` 一点用都没有：
 * pnpm 不会把 `npm_config_*` 注入到它拉起脚本的环境里（已实测为 undefined）。
 *
 * 后果是默认全部走 github.com。国内网络下表现为 **"Response code 502" 或
 * "Timeout awaiting 'request'"**，而且错误信息里完全不提"镜像"两个字 ——
 * 排查成本很高（本次为了定位它，动用了链式代理抓请求目标）。
 *
 * 所以在脚本这一层把默认镜像兜住：**已显式设置的环境变量不覆盖**，
 * 自建镜像或直连 GitHub 的机器可以照常覆盖。
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** 默认镜像（与 .npmrc 里保持一致；.npmrc 那份只对 pnpm 自身下载依赖生效） */
const DEFAULT_MIRRORS = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

const env = { ...process.env };
const applied = [];
for (const [key, value] of Object.entries(DEFAULT_MIRRORS)) {
  if (!env[key]) {
    env[key] = value;
    applied.push(key);
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(repoRoot, 'apps', 'desktop');

// 用包根目录 + cli.js 解析，避开 exports 字段对子路径的限制
const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');

console.log(
  applied.length > 0
    ? `[pack:win] 已注入默认下载镜像（可用同名环境变量覆盖）：${applied.join(', ')}`
    : '[pack:win] 使用调用方已设置的下载镜像环境变量',
);

// 只报「有没有」，**绝不打印密钥内容**。
// 密钥是在上一步 `pnpm run build` 时被编译进主进程的，打包这一步只是来复核一下；
// 这里提示是为了避免出现「以为内置了密钥、实际打了个用公共端点的包」这种沉默的错。
console.log(
  env.CD_TRANSLATE_KEY
    ? '[pack:win] 检测到 CD_TRANSLATE_KEY，翻译密钥已编译进主进程产物'
    : '[pack:win] 未设置 CD_TRANSLATE_KEY，本包将回落到零注册公共翻译端点（仅验证链路用）',
);

const result = spawnSync(
  process.execPath,
  [cli, '--win', '--config', 'electron-builder.yml', ...process.argv.slice(2)],
  { cwd: appDir, stdio: 'inherit', env },
);

if (result.error) {
  console.error(`[pack:win] 启动 electron-builder 失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
