/**
 * vitest 配置 —— 单元 / 契约 / DOM 固件测试。
 *
 * 与 electron-vite 的构建配置是两套：这里只负责**测试**，不产出交付物。
 *
 * 三处关键设置：
 *   1) `electron` 别名指向 `tests/stubs/electron.ts` —— 主进程模块在导入期就会
 *      访问 `electron.app` / `electron.session`，没有替身就无法在 Node 里导入；
 *   2) `@cd/shared` 指向源码入口，与 electron.vite.config.ts 保持一致
 *      （workspace 内直接消费 TS，不经过 dist）；
 *   3) 默认 node 环境；需要 DOM 的用例在文件顶部声明
 *      `// @vitest-environment jsdom`（渲染层与注入脚本的用例）。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));

const stub = (p: string): string => path.resolve(root, p);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^electron$/, replacement: stub('tests/stubs/electron.ts') },
      { find: /^@cd\/shared$/, replacement: stub('packages/shared/src/index.ts') },
      { find: /^@main\/(.+)$/, replacement: `${stub('apps/desktop/src/main')}/$1` },
      { find: /^@preload\/(.+)$/, replacement: `${stub('apps/desktop/src/preload')}/$1` },
      { find: /^@renderer\/(.+)$/, replacement: `${stub('apps/desktop/src/renderer/src')}/$1` },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/dom/**/*.test.ts'],
    // 不用全局注入，每个用例显式 import —— 便于「这条断言属于哪个测试」一眼可见
    globals: false,
    restoreMocks: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
