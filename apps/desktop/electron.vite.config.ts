import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { loadEnv } from 'vite';

/**
 * 主进程 / preload / 渲染进程共用一份「共享契约」入口。
 * 指向源码而非 dist：workspace 内直接消费 TS，构建期由 Vite 编译，省掉一层产物。
 */
const sharedEntry = resolve(__dirname, '../../packages/shared/src/index.ts');

export default defineConfig(({ mode }) => {
  // 本版环境变量只有两个，且都不含密钥（技术方案 5 节）
  const env = loadEnv(mode, __dirname, 'VITE_');
  const waProxy = env.VITE_WA_PROXY ?? '';
  const logLevel = env.VITE_LOG_LEVEL ?? 'info';

  // 翻译渠道密钥（FR-3.32）。刻意**不走 VITE_ 前缀**：
  // VITE_ 变量会被注入渲染层产物，而渲染层是明文可读的。
  // 这里只进主进程，且为空也能正常构建（回落零注册公共端点）。
  const translateKey = process.env.CD_TRANSLATE_KEY ?? '';

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: { '@cd/shared': sharedEntry },
      },
      // 主进程跑在 CJS 里，用编译期常量注入环境变量，避免 import.meta.env 的互操作问题
      define: {
        __WA_PROXY__: JSON.stringify(waProxy),
        __LOG_LEVEL__: JSON.stringify(logLevel),
        __TRANSLATE_KEY__: JSON.stringify(translateKey),
      },
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/main/index.ts') },
        },
      },
    },

    preload: {
      plugins: [externalizeDepsPlugin()],
      resolve: {
        alias: { '@cd/shared': sharedEntry },
      },
      build: {
        rollupOptions: {
          input: {
            // 我方 UI（主窗口）的桥
            index: resolve(__dirname, 'src/preload/index.ts'),
            // 注入到官方 WhatsApp 页面的脚本（V1.4 决策 D7）。
            // 输出必须是可预测的文件名：主进程要按路径把它交给 WebContentsView。
            'wa-inject': resolve(__dirname, 'src/preload/wa-inject.ts'),
          },
          output: {
            entryFileNames: '[name].js',
          },
        },
      },
    },

    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      resolve: {
        alias: {
          '@cd/shared': sharedEntry,
          '@renderer': resolve(__dirname, 'src/renderer/src'),
        },
      },
      plugins: [vue()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/renderer/index.html') },
        },
      },
    },
  };
});
