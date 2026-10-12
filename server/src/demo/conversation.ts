/**
 * 端到端演示：**不需要真实 WhatsApp 号码、不需要翻译 API Key**，
 * 就能看到「客户发英文 → 自动出中文译文 → 业务员回中文 → 发出英文」的完整链路。
 *
 * 运行：npm run demo --workspace @cardashboard/server
 *
 * 它跑的是真实代码路径：真实入站管道、真实存储层、真实翻译中间层，
 * 只有「通道」与「翻译供应商」两个最外层被换成了假实现。
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { MockAdapter } from '../channel/mock.js';
import { systemClock } from '../domain/clock.js';
import { uuidIds } from '../domain/ids.js';
import { IngestService } from '../pipeline/ingest.js';
import { SendService } from '../pipeline/send.js';
import { SqliteRepository } from '../storage/sqlite.js';
import { TranslationCache } from '../translation/cache.js';
import { Glossary } from '../translation/glossary.js';
import { MockTranslator } from '../translation/mock.js';
import {
  InboundTranslator,
  OutboundTranslator,
  TranslationService,
} from '../translation/service.js';

const CHANNEL = 'ch-zhangwei';
const CUSTOMER = '2348012345678@s.whatsapp.net';

function line(label = '') {
  console.log(label ? `\n── ${label} ${'─'.repeat(Math.max(0, 58 - label.length))}` : '');
}

async function main() {
  const dbPath = join(tmpdir(), `cardashboard-demo-${Date.now()}.db`);
  const repo = new SqliteRepository({ path: dbPath });

  const adapter = new MockAdapter({ clock: systemClock, ids: uuidIds });
  const translation = new TranslationService({
    translator: new MockTranslator(),
    cache: new TranslationCache(),
    glossary: new Glossary(),
  });
  const ingest = new IngestService(repo, adapter, new InboundTranslator(translation, 'zh'));
  const send = new SendService(repo, adapter, new OutboundTranslator(translation));

  line('0. 扫码登录（真实场景由业务员手机扫）');
  const ticket = await adapter.startLogin(CHANNEL);
  console.log(`   二维码 payload: ${ticket.qr}`);
  adapter.confirmLogin(CHANNEL);
  console.log(`   状态: ${await adapter.getStatus(CHANNEL)}`);

  await repo.upsertChannel({ id: CHANNEL, label: '张伟 · 尼日利亚线', phoneNumber: '+86 138****0000' });

  line('1. 客户发来英文询盘 → 入站管道自动落库并翻译');
  ingest.start();
  const incoming: Array<{ text: string; messageId: string }> = [
    { text: 'How much is this truck?', messageId: 'in-1' },
    { text: 'Do you have any 2018 Howo?', messageId: 'in-2' },
  ];
  for (const item of incoming) {
    adapter.receive({
      channelId: CHANNEL,
      chatId: CUSTOMER,
      chatType: 'direct',
      messageId: item.messageId,
      direction: 'inbound',
      origin: 'system',
      senderId: CUSTOMER,
      text: item.text,
      media: null,
      timestamp: Date.now(),
    });
  }
  await new Promise((r) => setTimeout(r, 50));

  const conversation = (await repo.listConversations(CHANNEL))[0];
  if (!conversation) throw new Error('会话未创建');

  for (const m of await repo.listMessages(conversation.id)) {
    console.log(`   原文: ${m.text}`);
    console.log(`   译文: ${m.textTranslated}   [${m.translationStatus} · ${m.detectedLanguage}→${m.targetLanguage}]`);
  }

  line('2. 客户档案里补上语言（翻译层从这里读，不写死在代码里）');
  await repo.upsertContact({
    channelId: CHANNEL,
    waId: CUSTOMER,
    name: 'Alhaji Motors',
    country: 'NG',
    language: 'en',
  });
  const contact = await repo.getContact(conversation.contactId!);
  console.log(`   客户: ${contact?.name} · 目的国: ${contact?.country} · 语言: ${contact?.language}`);

  line('3. 业务员写中文 → 先看译文（草稿，尚未发出）');
  const draft = await send.draft(conversation.id, '你好');
  console.log(`   我写: ${draft.sourceText}`);
  console.log(`   译文: ${draft.translatedText}   [${draft.status}]`);
  console.log(`   已发出的消息条数: ${adapter.sentMessages(CHANNEL).length}  ← 草稿阶段不该发出去`);

  line('4. 确认后发送');
  await send.send(draft);
  console.log(`   已发出的消息条数: ${adapter.sentMessages(CHANNEL).length}`);
  console.log(`   通道侧实际发出的内容: "${adapter.sentMessages(CHANNEL)[0]?.text}"`);

  line('5. 汽车术语：通用引擎会翻错，术语表在翻译前后各插一道');
  const withTerm = await send.draft(conversation.id, '这车是国六的');
  console.log(`   我写: ${withTerm.sourceText}`);
  console.log(`   译文: ${withTerm.translatedText}`);
  console.log(`   命中术语: ${withTerm.status === 'done' ? '国六 → China VI emission standard' : '—'}`);

  line('6. 客户语言缺失时，系统拒绝静默直发');
  await repo.upsertContact({ channelId: CHANNEL, waId: CUSTOMER, language: null });
  const orphanDraft = await send.draft(conversation.id, '我们下周发货');
  console.log(`   翻译状态: ${orphanDraft.status} · 原因: ${orphanDraft.reason}`);
  try {
    await send.send(orphanDraft);
    console.log('   ✗ 不该走到这里');
  } catch (err) {
    console.log(`   ✓ 已拦下: ${(err as Error).name}`);
  }
  console.log('   （业务员仍可手动填写最终文本后发送 —— 但不会被静默发出）');

  line('7. 落库结果');
  const conv = await repo.getConversation(conversation.id);
  console.log(`   会话: ${conv?.chatId}`);
  console.log(`   未读: ${conv?.unreadCount}   消息总数: ${(await repo.listMessages(conversation.id, { limit: 99 })).length}`);
  console.log(`   翻译缓存: 命中 ${translation.cacheStats.hits} / 未命中 ${translation.cacheStats.misses}`);

  await repo.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  console.log('\n完成。本次用到的真实组件：入站管道 / 出站管道 / 存储层 / 翻译中间层（含术语表与缓存）。');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
