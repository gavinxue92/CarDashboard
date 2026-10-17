/**
 * ⚠️ WhatsApp 会话分区标识的**单一注入点**（技术方案 3.2）。
 *
 * 为什么单独一个文件：这是全工程唯一不能省的预防性设计。
 *
 * - **本版**（无工作台登录层）：返回固定标识，隔离由 Windows 用户目录承担。
 * - **加入登录层后**：把 `getWaPartitionId()` 改为返回用户标识即可，
 *   其余代码（session 创建、清除、内嵌视图）一行都不用改。
 *
 * 反面教材：如果这里写死分区名、后续版本又沿用同名分区，会出现
 * 「任何人登录后都能看到同一个已绑定的号」的串号问题——那正是 FR-4.2 要防的事。
 * 届时代价是销售需要重新扫一次码，属于可接受的一次性成本。
 */

/** 本版固定标识 */
const FIXED_PARTITION_ID = 'local';

/** 分区标识（不含 `persist:` 前缀），用于日志与排障展示 */
export function getWaPartitionId(): string {
  return FIXED_PARTITION_ID;
}

/** Electron session 分区名。带 `persist:` 前缀才会落盘，重启免扫码（FR-3.9） */
export function getWaPartitionName(): string {
  return `persist:wa-${getWaPartitionId()}`;
}
