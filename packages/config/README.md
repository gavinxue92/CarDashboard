# @cd/config

共享构建配置。各包通过**相对路径** `extends` 本目录下的 tsconfig，不依赖包解析。

| 文件                 | 用途                          |
| ------------------ | --------------------------- |
| `tsconfig.base.json` | 公共编译选项（strict、ESM、Bundler 解析） |
| `tsconfig.node.json` | 主进程 / preload（Node 环境）       |
| `tsconfig.web.json`  | 渲染进程（DOM 环境）                 |

本版无 eslint 依赖：需求未要求，且方案第 5 节把 ESLint / Prettier 归在编辑器一栏，非工程硬依赖。
