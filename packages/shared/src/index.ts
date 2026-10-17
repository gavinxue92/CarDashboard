/**
 * @cd/shared —— IPC 契约与共享类型的单一来源。
 *
 * 主进程（apps/desktop/src/main）、preload、渲染进程都从这里取类型与常量，
 * 避免两侧字段对不上（技术方案 4.6 / 4.7）。
 */
export * from './ipc';
export * from './wa-status';
export * from './translate-settings';
export * from './translate';
export * from './workspace';
export * from './storage';
export * from './bridge';
