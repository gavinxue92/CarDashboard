'use strict';
/* 命令行旗标解析（纯逻辑，可测）。目前只有 --smoke（smoke 测试用：窗口起来即退出） */

function parseFlags(argv) {
  const list = Array.isArray(argv) ? argv : [];
  return { smoke: list.includes('--smoke') };
}

module.exports = { parseFlags };
