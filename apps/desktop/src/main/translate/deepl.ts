/**
 * DeepL 适配器（FR-3.31 的正式渠道候选之一）。
 *
 * 本版默认**不启用**：只有在配置了密钥时（本机文件覆盖或构建期内置）才会被选中。
 * 见 `key-store.ts`。DeepL API Free 注册即得 50 万字符/月、不需要信用卡，
 * 也是 `WATranslateSettings.channel` 的默认值。
 *
 * 端点区分免费版与付费版：用错端点会直接返回 403，
 * 而报错信息里不会说明「你该换端点」，所以这里按密钥后缀判断并给出更明确的日志。
 */
import { resolveLangCode } from '@cd/shared';
import {
  errorCodeFromStatus,
  TranslateError,
  type ProviderContext,
  type TranslateJob,
  type TranslateProvider,
} from './provider';

const FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate';
const PRO_ENDPOINT = 'https://api.deepl.com/v2/translate';

/** DeepL 免费版密钥以 `:fx` 结尾，这是官方约定的识别方式 */
function defaultEndpointFor(key: string): string {
  return key.trim().endsWith(':fx') ? FREE_ENDPOINT : PRO_ENDPOINT;
}

/**
 * DeepL 的源语言不接受 EN-GB / ZH-HANS 这类细分写法。
 * 目标语言接受细分，源语言要收敛到主语言码。
 */
function toSourceLang(code: string): string {
  if (code.startsWith('ZH')) return 'ZH';
  if (code.startsWith('EN')) return 'EN';
  if (code.startsWith('PT')) return 'PT';
  return code;
}

interface DeepLResponse {
  translations?: Array<{ text?: unknown }>;
}

export function parseDeepLResponse(raw: string): string {
  let data: unknown;
  try {
    data = JSON.parse(raw) as DeepLResponse;
  } catch {
    throw new TranslateError('bad-response', '响应不是合法 JSON');
  }
  const list = (data as DeepLResponse).translations;
  if (!Array.isArray(list) || list.length === 0) {
    throw new TranslateError('bad-response', '响应缺少 translations');
  }
  const out = list
    .map((item) => (typeof item?.text === 'string' ? item.text : ''))
    .join('');
  if (!out.trim()) throw new TranslateError('bad-response', '译文为空');
  return out;
}

export function createDeepLProvider(key: string, endpointOverride?: string): TranslateProvider {
  const endpoint = endpointOverride || defaultEndpointFor(key);

  return {
    id: 'deepl',
    label: 'DeepL',
    ready: () => key.trim().length > 0,

    async translate(job: TranslateJob, ctx: ProviderContext): Promise<string> {
      if (!key.trim()) throw new TranslateError('auth', '未配置 DeepL 密钥');

      const target = resolveLangCode(job.toLabel, 'deepl', job.traditionalChinese);
      const params = new URLSearchParams();
      params.set('text', job.text);
      params.set('target_lang', target);
      // 入向不指定源语言，交给 DeepL 自动识别（同 public-endpoint 的理由）
      if (job.direction !== 'in') {
        params.set('source_lang', toSourceLang(resolveLangCode(job.fromLabel, 'deepl', false)));
      }

      const res = await ctx.request(endpoint, {
        method: 'POST',
        signal: ctx.signal,
        headers: {
          Authorization: `DeepL-Auth-Key ${key.trim()}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!res.ok) {
        throw new TranslateError(errorCodeFromStatus(res.status), `HTTP ${res.status}`);
      }
      return parseDeepLResponse(await res.text());
    },
  };
}
