'use strict';
/* =========================================================================
 * S0 · 账号纯逻辑（无 Electron 依赖，可被 vitest 直接测试）
 *
 * 纪律来源：design/SHELL-ROUTE.md §六 S0 —— 一号一 partition，扫码登录态持久化。
 * partition 命名即登录态隔离边界：`persist:wa-<id>`。ID 必须先清洗再进
 * partition 名（它会被拼进 Chromium 的存储目录名，绝不能原样透传用户输入）。
 * ========================================================================= */

/** 清洗账号 ID：只留 [a-z0-9_-]，其余折叠为 '-'；返回小写。空/全清洗掉则抛错 */
function sanitizeAccountId(raw) {
  const cleaned = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) {
    throw new Error('账号 ID 清洗后为空，无法用作 partition：' + JSON.stringify(raw));
  }
  return cleaned;
}

/** 一个账号 = 一块独立网页版 = 一个 persist partition（登录态互不串） */
function partitionFor(accountId) {
  return 'persist:wa-' + sanitizeAccountId(accountId);
}

/** S0 出厂账号：一个主号。加号/删号的 UI 属 S2，这里只保证数据形态正确 */
function defaultAccounts() {
  return [{ id: 'main', label: '主号' }];
}

/**
 * 校验账号列表：ID 可清洗、清洗后唯一、label 非空。
 * 返回规范化后的新列表（不动入参）；不合法即抛错（配置坏了要显性失败，不静默）。
 */
function normalizeAccounts(list) {
  if (!Array.isArray(list) || list.length === 0) return defaultAccounts();
  const seen = new Set();
  return list.map((a, i) => {
    if (!a || typeof a !== 'object') {
      throw new Error('accounts[' + i + '] 不是对象');
    }
    const id = sanitizeAccountId(a.id);
    if (seen.has(id)) throw new Error('账号 ID 重复（清洗后）：' + id);
    seen.add(id);
    const label = String(a.label == null ? '' : a.label).trim();
    if (!label) throw new Error('账号 ' + id + ' 缺少 label');
    return { id, label };
  });
}

/** 找当前账号；找不到（配置被手改）回落到第一个并保持幂等 */
function resolveCurrent(accounts, currentId) {
  const hit = accounts.find(a => a.id === currentId);
  return hit ? hit.id : accounts[0].id;
}

module.exports = { sanitizeAccountId, partitionFor, defaultAccounts, normalizeAccounts, resolveCurrent };
