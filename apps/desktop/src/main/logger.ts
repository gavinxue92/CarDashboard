/**
 * 本地日志（技术方案 4.5）。
 *
 * 本版不接 Sentry 等第三方监控（已在方案第 0 节排除），崩溃与运行日志写本地文件。
 * 用途：排查办公网络可达性、断线重连次数等问题（交互说明 IX-5.3 要求记入本地日志）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { LogLevel } from '@cd/shared';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let logDir = '';
let logFile = '';
let minLevel: LogLevel = 'info';
let stream: fs.WriteStream | null = null;

export function initLogger(level: LogLevel): void {
  minLevel = level;
  try {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, `app-${new Date().toISOString().slice(0, 10)}.log`);
    stream = fs.createWriteStream(logFile, { flags: 'a' });
  } catch {
    // 日志不可用不应阻塞应用启动
    stream = null;
  }
}

export function getLogDir(): string {
  return logDir;
}

export function getLogFile(): string {
  return logFile;
}

export function log(level: LogLevel, scope: string, message: string): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  try {
    stream?.write(`${line}\n`);
  } catch {
    // 忽略写入失败
  }
}

export function closeLogger(): void {
  try {
    stream?.end();
  } catch {
    // 忽略
  }
  stream = null;
}
