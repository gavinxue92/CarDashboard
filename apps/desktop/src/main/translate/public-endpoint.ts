/**
 * 零注册公共端点适配器（FR-3.31 的本版默认实现）。
 *
 * ⚠️ 定位说明（不要误用）：
 * 用户 2026-10-14 决定「先接零注册公共端点验证链路」。它**不需要注册、不需要密钥**，
 * 接上即有真实英中译文，用于验证注入链路（读 DOM → 插入节点 → 改写输入框 → 发送）。
 * 但它属于**非官方接口**：无 SLA、可能被限流，**仅用于验证，不用于正式交付**。
 * 正式渠道确定后替换本文件即可，调用方与弹窗结构不受影响（FR-3.31）。
 *
 * 关于源语言：入向用 `sl=auto` 自动识别。对方不一定始终写英语
 * （外贸场景里出现西语、阿语询盘很常见），写死英语会显著掉质量；
 * 出向源语言已知（就是我方语言），显式指定，避免被误判。
 */
import { resolveLangCode } from '@cd/shared';
import {
  errorCodeFromStatus,
  TranslateError,
  type ProviderContext,
  type TranslateJob,
  type TranslateProvider,
} from './provider';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

interface GoogleSegment {
  0?: unknown;
}

/**
 * 解析 `translate_a/single` 的响应。
 *
 * 形状：`[[["译文","原文",null,null,10],["第二段","src",...]],null,"en",...]`
 * 第 0 项是**分段数组**，长文本会被切成多段，必须拼接而不是只取第一段，
 * 否则长消息只会显示开头一句。
 */
export function parseGoogleResponse(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new TranslateError('bad-response', '响应不是合法 JSON');
  }

  if (!Array.isArray(data)) throw new TranslateError('bad-response', '响应结构异常');
  const segments = data[0];
  if (!Array.isArray(segments)) throw new TranslateError('bad-response', '响应缺少分段');

  let out = '';
  for (const seg of segments as GoogleSegment[]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') out += seg[0];
  }

  if (!out.trim()) throw new TranslateError('bad-response', '译文为空');
  return out;
}

export function createGooglePublicProvider(): TranslateProvider {
  return {
    id: 'google-public',
    label: '内置免费通道',
    ready: () => true,

    async translate(job: TranslateJob, ctx: ProviderContext): Promise<string> {
      const target = resolveLangCode(job.toLabel, 'google', job.traditionalChinese);
      const source =
        job.direction === 'in' ? 'auto' : resolveLangCode(job.fromLabel, 'google', false);

      const url =
        `${ENDPOINT}?client=gtx&dt=t` +
        `&sl=${encodeURIComponent(source)}` +
        `&tl=${encodeURIComponent(target)}` +
        `&q=${encodeURIComponent(job.text)}`;

      const res = await ctx.request(url, { method: 'GET', signal: ctx.signal });
      if (!res.ok) {
        throw new TranslateError(errorCodeFromStatus(res.status), `HTTP ${res.status}`);
      }
      return parseGoogleResponse(await res.text());
    },
  };
}
