import type { LanguageCode } from './translator.js';

/**
 * 汽车术语表。
 *
 * 通用翻译引擎翻「国六」「双离合」「事故车」「1.5T」必错，靠祈祷没有用。
 * 做法是**在翻译前后各插一道**：把术语换成占位符 → 送翻译 → 再把占位符
 * 还原成目标语言的标准说法。比训练模型便宜得多，也比事后纠正可靠。
 *
 * ⚠️ 约定：`term` 用**其中一种语言**书写，`translations` 给出其它语言的等价说法。
 * 因此「中→英」和「英→中」需要各自建条目。
 */

export interface GlossaryEntry {
  term: string;
  translations: Record<LanguageCode, string>;
  /** 备注：为什么这个词需要特殊处理 */
  note?: string;
}

export const AUTOMOTIVE_TERMS: GlossaryEntry[] = [
  { term: '国六', translations: { en: 'China VI emission standard' }, note: '排放标准，通用引擎会直译成 Guo Liu' },
  { term: '双离合', translations: { en: 'dual-clutch transmission (DCT)' } },
  { term: '事故车', translations: { en: 'accident-damaged vehicle' } },
  { term: '1.5T', translations: { en: '1.5L turbocharged' }, note: '排量写法，通用引擎会翻成 1.5 tons' },
  { term: '豪沃', translations: { en: 'HOWO' }, note: '中国重汽品牌名，应为英文原名' },
  { term: '陕汽', translations: { en: 'SHACMAN' }, note: '陕汽出口用 SHACMAN' },
  { term: '重汽', translations: { en: 'Sinotruk' } },
  { term: '解放', translations: { en: 'FAW Jiefang' } },
  { term: '拖头', translations: { en: 'tractor head' } },
  { term: '自卸车', translations: { en: 'dump truck' } },
  { term: '牵引车', translations: { en: 'tractor truck' } },
  { term: '排放标准', translations: { en: 'emission standard' } },
  { term: '落地方价', translations: { en: 'landed cost' } },
  { term: 'HOWO', translations: { zh: '豪沃' } },
  { term: 'SHACMAN', translations: { zh: '陕汽' } },
  { term: 'dump truck', translations: { zh: '自卸车' } },
];

const OPEN = '\u27e6'; // ⟦
const CLOSE = '\u27e7'; // ⟧

export interface ProtectedText {
  /** 送入翻译引擎的文本（术语已换成占位符） */
  text: string;
  /** 把译文里的占位符还原成目标语言的术语 */
  restore(translated: string): string;
  /** 本次命中的术语（供埋点 / 调试 / 评分） */
  hits: string[];
}

export class Glossary {
  private readonly entries: GlossaryEntry[];

  constructor(entries: GlossaryEntry[] = AUTOMOTIVE_TERMS) {
    // 长词优先，避免「国六」被更短的条目先吃掉
    this.entries = [...entries].sort((a, b) => b.term.length - a.term.length);
  }

  /** 把文本中已知的术语替换为占位符 */
  protect(text: string, targetLang: LanguageCode): ProtectedText {
    const replacements: string[] = [];
    const hits: string[] = [];
    let out = text;

    for (const entry of this.entries) {
      const translated = entry.translations[targetLang];
      if (translated === undefined) continue;
      if (!out.includes(entry.term)) continue;

      const marker = `${OPEN}${replacements.length}${CLOSE}`;
      out = out.split(entry.term).join(marker);
      replacements.push(translated);
      hits.push(entry.term);
    }

    return {
      text: out,
      restore: (translated: string) =>
        translated.replace(
          new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'),
          (_m, idx: string) => replacements[Number(idx)] ?? '',
        ),
      hits,
    };
  }

  /** 目标语言下能处理的术语数量（供自检 / 调试） */
  sizeFor(targetLang: LanguageCode): number {
    return this.entries.filter((e) => e.translations[targetLang] !== undefined).length;
  }
}
