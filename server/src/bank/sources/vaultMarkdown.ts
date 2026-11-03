// Nguồn đề: vault Markdown sinh bởi skill toeic-notes-from-link.
// Cấu trúc mỗi đề:  {id}/{id}.md  +  images/  +  explain/explaination.md  +  vi/translate.md
//
// Hai biến thể đã gặp trong file đề chính:
//  - ETS:    phương án "- A. text", đoạn văn Part 6/7 là ảnh  ![..](images/part7_q147-148.png)
//  - Hacker: phương án "- (A) text", đoạn văn Part 6/7 là code block ``` ... ```
// Đáp án đúng được in đậm (**...**) và có dòng "**Đáp án đúng: X**".
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Choice, Group, Part, Passage, Question } from '../../../../shared/bank.ts';
import type { LoadedTest, MediaCopy, QuestionSource } from './types.ts';

const PART_HEADING = /^## Part (\d)\b/;
const SINGLE_Q = /^### Câu (\d+)\s*$/;
const GROUP_Q = /^### Câu (\d+)\s*-\s*(\d+)/;
const GROUP_ITEM = /^\*\*Câu (\d+)\.\*\*\s*(.*)$/;
const OPTION = /^-\s+(\*\*)?\s*(?:\(([A-D])\)|([A-D])\.)\s*(.*?)\s*(\*\*)?\s*$/;
const ANSWER = /\*\*Đáp án đúng:\s*\(?([A-D])\)?\s*\*\*\s*(?:[—–-]\s*)?(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const LINKS_LINE = /^📖/;
/** Dấu hiệu đánh dấu đáp án lọt vào nội dung gửi cho client */
const BROKEN = /Dữ liệu gốc bị lỗi|thiếu nội dung/i;
const LEAK = /\*|✓|✔|Đáp án|\(correct\)|\(đúng\)/i;

export class VaultMarkdownSource implements QuestionSource {
  readonly name = 'vault-markdown';
  constructor(private root: string) {}

  async listTests(): Promise<string[]> {
    const out: string[] = [];
    for (const d of await readdir(this.root)) {
      const md = join(this.root, d, `${d}.md`);
      if (await exists(md)) out.push(d);
    }
    return out.sort(naturalCompare);
  }

  async loadTest(testId: string, parts: Part[]): Promise<LoadedTest> {
    const dir = join(this.root, testId);
    const main = await readFile(join(dir, `${testId}.md`), 'utf8');
    const explain = sectionsByNumber(await readOptional(join(dir, 'explain', 'explaination.md')));
    const translate = sectionsByNumber(await readOptional(join(dir, 'vi', 'translate.md')));
    const warnings: string[] = [];
    const media: MediaCopy[] = [];
    const groups: Group[] = [];
    const questions: Question[] = [];

    // Tiêu đề trong file không đồng nhất ("ETS 2026 - Test 3", "ETS_2026 Test 6"…) → lấy theo tên thư mục
    const title = testId.replace(/_/g, ' ');

    for (const { part, lines } of splitParts(main)) {
      if (!parts.includes(part)) continue;
      const blocks = splitBy(lines, (l) => SINGLE_Q.test(l) || GROUP_Q.test(l));
      for (const block of blocks) {
        const head = block[0];
        const gm = head.match(GROUP_Q);
        const sm = head.match(SINGLE_Q);
        if (!gm && !sm) continue; // phần mô tả trước câu đầu tiên
        const groupId = gm ? `${testId}:${gm[1]}-${gm[2]}` : `${testId}:${sm![1]}`;
        const group: Group = { id: groupId, testId, part, numbers: [], passages: [] };

        let items: { number: number; stem: string; body: string[] }[];
        if (sm) {
          items = [parseSingle(Number(sm[1]), block.slice(1))];
        } else {
          const idx = block.findIndex((l) => GROUP_ITEM.test(l));
          if (idx < 0) {
            warnings.push(`${groupId}: không tìm thấy câu hỏi trong nhóm`);
            continue;
          }
          const header = parseGroupHeader(block.slice(1, idx), testId, dir, media);
          if (!header.passages.length) {
            warnings.push(`${groupId}: nguồn không có đoạn văn gốc — bỏ qua cả nhóm`);
            continue;
          }
          group.passages = header.passages;
          group.passageTranslation = header.translation || undefined;
          items = splitBy(block.slice(idx), (l) => GROUP_ITEM.test(l)).map((b) => {
            const m = b[0].match(GROUP_ITEM)!;
            // stem đôi khi bọc nghiêng: *(What can visitors do…?)*
            return { number: Number(m[1]), stem: m[2].trim().replace(/^\*\((.*)\)\*$/, '$1'), body: b.slice(1) };
          });
          const [from, to] = [Number(gm![1]), Number(gm![2])];
          const nums = items.map((i) => i.number);
          if (nums.length !== to - from + 1 || nums[0] !== from || nums.at(-1) !== to)
            warnings.push(`${groupId}: số câu ${nums.join(',')} không khớp heading ${from}-${to}`);
        }

        for (const it of items) {
          const q = parseQuestionBody(it.body);
          const id = `${testId}:${it.number}`;
          if (q.options.length !== 4) warnings.push(`${id}: có ${q.options.length} phương án`);
          if (q.options.some((o) => BROKEN.test(o.text))) {
            warnings.push(`${id}: phương án trong nguồn bị lỗi/thiếu — bỏ câu này`);
            continue;
          }
          const leak = [it.stem || q.stem, ...q.options.map((o) => o.text)].find((t) => t && LEAK.test(t));
          if (leak) warnings.push(`${id}: nghi lộ đáp án trong đề: "${leak.slice(0, 60)}"`);
          const answer = q.answer ?? q.bolded;
          if (!answer) {
            warnings.push(`${id}: thiếu đáp án`);
            continue;
          }
          if (q.answer && q.bolded && q.answer !== q.bolded)
            warnings.push(`${id}: đáp án (${q.answer}) khác phương án in đậm (${q.bolded})`);
          group.numbers.push(it.number);
          questions.push({
            id,
            testId,
            groupId,
            part,
            number: it.number,
            stem: (it.stem || q.stem || '').trim() || undefined,
            options: q.options,
            answer,
            note: q.note || undefined,
            explanation: explain.get(it.number),
            translation: translate.get(it.number),
          });
          if (!explain.has(it.number)) warnings.push(`${id}: thiếu giải thích`);
          if (!translate.has(it.number)) warnings.push(`${id}: thiếu bản dịch`);
        }
        if (group.numbers.length) groups.push(group);
      }
    }

    return {
      bank: { id: testId, title, source: this.name, importedAt: new Date().toISOString(), groups, questions },
      media,
      warnings,
    };
  }
}

function parseSingle(number: number, body: string[]) {
  return { number, stem: '', body };
}

/**
 * Phần đầu nhóm Part 6/7.
 *  - Trước dòng "**Dịch nghĩa…**" đầu tiên: ảnh, code block và cả chữ thường đều là đoạn văn gốc
 *    (một số đề Hacker dán memo/email dạng chữ thường, không bọc code block).
 *  - Sau đó: ảnh/code block vẫn là đoạn văn gốc, phần chữ còn lại là bản dịch.
 */
function parseGroupHeader(lines: string[], testId: string, dir: string, media: MediaCopy[]) {
  const passages: Passage[] = [];
  const translation: string[] = [];
  const plain: string[] = [];
  let caption: string | undefined;
  let inTranslation = false;
  const pushText = (text: string) => {
    const t = text.replace(/\*\*/g, '').trim();
    if (t) passages.push({ kind: 'text', text: t, caption });
    caption = undefined;
  };
  const flushPlain = () => {
    const text = plain.join('\n').trim();
    // Dòng giới thiệu đứng một mình ("Questions 162-164 refer to the following bill.") → làm caption
    if (/^Questions \d+/.test(text) && !text.includes('\n')) caption = text;
    else pushText(text);
    plain.length = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const img = line.match(IMAGE);
    if (img) {
      flushPlain();
      const rel = img[2];
      const file = rel.split('/').pop()!;
      media.push({ from: join(dir, rel), to: `${testId}/${file}` });
      passages.push({ kind: 'image', src: `/media/${testId}/${encodeURIComponent(file)}`, caption: img[1] || undefined });
      continue;
    }
    if (line.trim().startsWith('```')) {
      flushPlain();
      const buf: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) buf.push(lines[i]);
      pushText(buf.join('\n'));
      continue;
    }
    // Nhãn đoạn văn gốc, ví dụ "**Đoạn văn gốc (email):**" / "**Bài đọc (English):**"
    if (/^\*\*(Đoạn văn gốc|Bài đọc)[^*]*\*\*\s*$/.test(line)) {
      flushPlain();
      caption = line.replace(/\*/g, '').replace(/:\s*$/, '').trim();
      continue;
    }
    if (/^#\s/.test(line) || /^---+\s*$/.test(line)) continue; // heading lạc, đường kẻ
    if (!inTranslation && /^\*\*Dịch nghĩa/.test(line)) {
      flushPlain();
      inTranslation = true;
    }
    if (inTranslation) translation.push(line);
    else if (!/^\*[^*].*\*$/.test(line.trim())) plain.push(line); // bỏ ghi chú nghiêng *…* của người soạn
  }
  flushPlain();
  return { passages, translation: translation.join('\n').trim() };
}

function parseQuestionBody(body: string[]) {
  const options: { key: Choice; text: string }[] = [];
  const stem: string[] = [];
  const note: string[] = [];
  let answer: Choice | undefined;
  let bolded: Choice | undefined;
  let phase: 'stem' | 'options' | 'note' = 'stem';
  for (const raw of body) {
    const line = raw.trimEnd();
    if (LINKS_LINE.test(line.trim()) || /^---+\s*$/.test(line)) {
      phase = 'note';
      continue;
    }
    const opt = phase !== 'note' ? line.match(OPTION) : null;
    if (opt) {
      const key = (opt[2] || opt[3]) as Choice;
      const isBold = Boolean(opt[1] && opt[5]);
      if (isBold) bolded = key;
      // bỏ mọi dấu * (nguồn đôi khi đánh dấu đáp án đúng bằng *** hoặc * cuối dòng)
      options.push({ key, text: opt[4].replace(/\*+/g, '').trim() });
      phase = 'options';
      continue;
    }
    const ans = line.match(ANSWER);
    if (ans) {
      answer = ans[1] as Choice;
      if (ans[2].trim()) note.push(ans[2].trim());
      phase = 'note';
      continue;
    }
    if (phase === 'stem') stem.push(line);
    else if (phase === 'note' && answer) note.push(line);
  }
  return {
    stem: stem.join('\n').trim(),
    options,
    answer,
    bolded,
    note: note.join('\n').trim(),
  };
}

function splitParts(md: string) {
  const lines = md.split(/\r?\n/);
  const out: { part: Part; lines: string[] }[] = [];
  let cur: { part: Part; lines: string[] } | null = null;
  for (const l of lines) {
    const m = l.match(PART_HEADING);
    if (m) {
      cur = { part: Number(m[1]) as Part, lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(l);
  }
  return out;
}

function splitBy(lines: string[], isStart: (l: string) => boolean): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (isStart(l) && cur.length) {
      out.push(cur);
      cur = [];
    }
    cur.push(l);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** explain/translate: mỗi câu là "### Câu N" */
function sectionsByNumber(md: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!md) return map;
  for (const block of splitBy(md.split(/\r?\n/), (l) => SINGLE_Q.test(l))) {
    const m = block[0].match(SINGLE_Q);
    if (!m) continue;
    const text = block
      .slice(1)
      .filter((l) => !/^---+\s*$/.test(l) && !/^\*\(Đoạn văn nằm trong hình ảnh/.test(l.trim()))
      .join('\n')
      .trim();
    if (text) map.set(Number(m[1]), text);
  }
  return map;
}

async function readOptional(p: string) {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return '';
  }
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true });
}
