import { describe, expect, it } from 'vitest';
import { TranslationCache } from './cache.js';
import { MockTranslator } from './mock.js';
import { InboundTranslator, OutboundTranslator, TranslationService } from './service.js';

function make(overrides: { fail?: boolean } = {}) {
  let calls = 0;
  const translator = new MockTranslator({
    failAlways: overrides.fail ?? false,
    onCall: () => {
      calls += 1;
    },
  });
  const service = new TranslationService({ translator, cache: new TranslationCache() });
  return { service, calls: () => calls };
}

describe('TranslationService · 三个决策点', () => {
  it('无文本 → skipped', async () => {
    const { service } = make();
    const r = await service.translate(null, 'en');
    expect(r.status).toBe('skipped');
    expect(r.translatedText).toBeNull();
    expect(r.reason).toBeTruthy();
  });

  it('纯数字 / 链接 → skipped（省一次调用）', async () => {
    const { service, calls } = make();
    expect((await service.translate('12345678', 'en')).status).toBe('skipped');
    expect((await service.translate('https://example.com/a', 'en')).status).toBe('skipped');
    expect(calls()).toBe(0);
  });

  it('未指定目标语言 → skipped，且提示来源应为客户档案', async () => {
    const { service } = make();
    const r = await service.translate('Hello', null);
    expect(r.status).toBe('skipped');
    expect(r.reason).toContain('客户档案');
  });

  it('源语言与目标语言相同 → skipped', async () => {
    const { service, calls } = make();
    const r = await service.translate('你好，多少钱', 'zh');
    expect(r.status).toBe('skipped');
    expect(r.detectedLanguage).toBe('zh');
    expect(calls()).toBe(0);
  });

  it('英→中 正常翻译并记录检测到的源语言', async () => {
    const { service } = make();
    const r = await service.translate('How much is this truck?', 'zh');
    expect(r.status).toBe('done');
    expect(r.translatedText).toBe('这辆卡车多少钱？');
    expect(r.detectedLanguage).toBe('en');
    expect(r.targetLanguage).toBe('zh');
    expect(r.cached).toBe(false);
  });

  it('中→英 正常翻译', async () => {
    const { service } = make();
    const r = await service.translate('你好', 'en');
    expect(r.translatedText).toBe('Hello');
  });
});

describe('TranslationService · 术语表与缓存', () => {
  it('术语在翻译后被还原为目标语言的标准说法', async () => {
    const { service } = make();
    const r = await service.translate('这车是国六的', 'en');
    expect(r.status).toBe('done');
    expect(r.translatedText).toContain('China VI emission standard');
    expect(r.translatedText).not.toContain('国六');
    expect(r.glossaryHits).toContain('国六');
  });

  it('相同文本第二次直接命中缓存，不再调用翻译器', async () => {
    const { service, calls } = make();
    const first = await service.translate('How much is this truck?', 'zh');
    const second = await service.translate('How much is this truck?', 'zh');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.translatedText).toBe(first.translatedText);
    expect(calls()).toBe(1);
    expect(service.cacheStats.hits).toBe(1);
  });

  it('不同目标语言不会命中彼此的缓存', async () => {
    const { service, calls } = make();
    await service.translate('你好', 'en');
    await service.translate('你好', 'ar');
    expect(calls()).toBe(2);
  });
});

describe('TranslationService · 失败不抛异常', () => {
  it('翻译器抛错时返回 failed，并带上原因', async () => {
    const { service } = make({ fail: true });
    const r = await service.translate('你好', 'en');
    expect(r.status).toBe('failed');
    expect(r.translatedText).toBeNull();
    expect(r.reason).toBeTruthy();
    expect(r.detectedLanguage).toBe('zh');
  });
});

describe('入站 / 出站两个钩子', () => {
  it('入站固定翻成工作台语言，且可由配置指定', async () => {
    const { service } = make();
    const zhIn = new InboundTranslator(service);
    expect(await zhIn.translate('How much is this truck?')).toMatchObject({
      status: 'done',
      targetLanguage: 'zh',
    });

    const enIn = new InboundTranslator(service, 'en');
    expect(await enIn.translate('你好')).toMatchObject({ status: 'done', targetLanguage: 'en' });
  });

  it('出站目标语言来自客户档案；缺失时 skipped 而不是瞎猜', async () => {
    const { service } = make();
    const out = new OutboundTranslator(service);
    const missing = await out.translate('你好', null);
    expect(missing.status).toBe('skipped');
    expect(missing.reason).toContain('客户语言未设置');

    const ok = await out.translate('你好', 'en');
    expect(ok).toMatchObject({ status: 'done', targetLanguage: 'en', translatedText: 'Hello' });
  });

  it('出站时客户语言若与原文同语言，则跳过（不产生无意义的调用）', async () => {
    const { service, calls } = make();
    const out = new OutboundTranslator(service);
    const r = await out.translate('你好', 'zh');
    expect(r.status).toBe('skipped');
    expect(calls()).toBe(0);
  });
});
