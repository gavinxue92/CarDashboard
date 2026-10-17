/**
 * Playwright 配置 —— 端到端冒烟（T3）。
 *
 * 本套用例**不需要下载任何浏览器**：它不驱动 Chromium，而是用 `_electron`
 * 直接拉起打包前的客户端产物（`apps/desktop`），因此：
 *   · 覆盖的是真实运行条件 —— 真沙箱渲染进程、真 IPC、真配置下发；
 *   · 不需要 WhatsApp 账号，也不需要人为操作。
 *
 * ⚠️ 运行前必须先构建：`pnpm build`（用例会自己检查 `out/main/index.js` 是否存在，
 * 不存在就直接报错说明该跑什么命令，而不是给一个看不懂的启动失败）。
 *
 * 隔离：每个用例都给客户端一个**独立的用户数据目录**（`CD_USER_DATA_DIR`），
 * 绝不触碰使用者的 `%APPDATA%\CarDashboard`（那里存着 WhatsApp 登录态）。
 * 注意 `APPDATA` 环境变量对 Electron 无效 —— 见 main/index.ts 里的实测说明。
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // 拉起客户端 + 等首屏 + 等落盘，给足时间（单条用例都不长，但冷启动较慢）
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // 单实例锁 + 共用用户数据目录：必须串行，不能并行
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'tests/e2e/.artifacts',
});
