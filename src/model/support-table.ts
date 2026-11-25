import { CATALOG } from './catalog';
import { LEVEL_MARK, SUPPORT, SUPPORT_ASPECTS, supportSummary } from './support';

/** ตารางระดับการรองรับ (Markdown) ของอุปกรณ์ทุกชนิดในคลัง — ใช้ใน docs/MCU-ROADMAP.md (tests/support.test.ts ตรวจว่าตรงกัน) */
export function supportTableMarkdown(): string {
  const head = `| อุปกรณ์ | ${SUPPORT_ASPECTS.map(([, l]) => l).join(' | ')} | สรุป | ข้อจำกัด |`;
  const sep = `|---|${SUPPORT_ASPECTS.map(() => ':-:').join('|')}|---|---|`;
  const rows = CATALOG.map((c) => {
    const s = SUPPORT[c.kind];
    return `| ${c.name} (\`${c.kind}\`) | ${SUPPORT_ASPECTS.map(([k]) => LEVEL_MARK[s[k]]).join(' | ')} | ${supportSummary(s).text} | ${s.limits.replace(/\|/g, '/')} |`;
  });
  return [head, sep, ...rows].join('\n');
}
