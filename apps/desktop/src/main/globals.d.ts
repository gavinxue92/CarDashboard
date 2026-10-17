/**
 * 构建期注入的常量（由 electron.vite.config.ts 的 define 提供）。
 * 主进程输出 CJS，用编译期常量替代 import.meta.env，避免 ESM/CJS 互操作问题。
 */

/** WhatsApp 分区代理出口，空字符串 = 直连 */
declare const __WA_PROXY__: string;

/** 日志级别：debug | info | warn | error */
declare const __LOG_LEVEL__: string;

/**
 * 构建期内置的翻译渠道密钥（FR-3.32），空字符串 = 未内置。
 *
 * ⚠️ **只注入主进程**，绝不进渲染层产物：
 * 渲染层的 JS 是明文可读的，一旦注入等于把密钥印在界面上。
 * 构建方式：打包前设 `CD_TRANSLATE_KEY` 环境变量（见 scripts/pack-win.mjs）。
 *
 * 注意：内置密钥**可以被从安装包中提取**，这是本版已知代价。
 * 兜底手段是本机文件覆盖（`<userData>/translate-key.json`），换 key 不必重新发版。
 */
declare const __TRANSLATE_KEY__: string;
