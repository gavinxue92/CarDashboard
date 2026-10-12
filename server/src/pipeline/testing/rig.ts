import { MockAdapter } from '../../channel/mock.js';
import { fixedClock } from '../../domain/clock.js';
import { sequentialIds } from '../../domain/ids.js';
import type { NormalizedMessage } from '../../domain/types.js';
import { MemoryRepository } from '../../storage/memory.js';
import { TranslationCache } from '../../translation/cache.js';
import { MockTranslator } from '../../translation/mock.js';
import {
  InboundTranslator,
  OutboundTranslator,
  TranslationService,
} from '../../translation/service.js';
import { IngestService } from '../ingest.js';
import { SendService } from '../send.js';

export const CH = 'ch-1';
export const CUSTOMER = '2348012345678@s.whatsapp.net';

/** 组装一套「内存通道 + 内存存储 + 假翻译」的管道，全部确定性可复现 */
export function rig() {
  const clock = fixedClock(1_700_000_000_000);
  const ids = sequentialIds('p');
  const repo = new MemoryRepository(clock, ids);
  const adapter = new MockAdapter({ clock, ids });
  const service = new TranslationService({
    translator: new MockTranslator(),
    cache: new TranslationCache(),
  });
  return {
    clock,
    repo,
    adapter,
    service,
    ingest: new IngestService(repo, adapter, new InboundTranslator(service), clock),
    send: new SendService(repo, adapter, new OutboundTranslator(service), clock),
  };
}

export function inbound(over: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    channelId: CH,
    chatId: CUSTOMER,
    chatType: 'direct',
    messageId: 'm-1',
    direction: 'inbound',
    origin: 'system',
    senderId: CUSTOMER,
    text: 'How much is this truck?',
    media: null,
    timestamp: 1_700_000_000_000,
    ...over,
  };
}

/** 建好一个「已登录 + 有客户 + 有会话」的场景 */
export async function scene(opts: { contactLanguage?: string | null } = {}) {
  const r = rig();
  await r.adapter.startLogin(CH);
  r.adapter.confirmLogin(CH);
  const contact = await r.repo.upsertContact({
    channelId: CH,
    waId: CUSTOMER,
    language: opts.contactLanguage === undefined ? 'en' : opts.contactLanguage,
  });
  const conversation = await r.repo.ensureConversation({
    channelId: CH,
    chatId: CUSTOMER,
    chatType: 'direct',
    contactId: contact.id,
  });
  return { ...r, contact, conversation };
}
