// Ngân hàng đề runtime: chỉ đọc data/bank/*.json, không biết gì về nguồn gốc đề.
import { mkdirSync, readdirSync, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import type { Group, Part, PublicGroup, Question, Reveal, TestBank } from '../../../shared/bank.ts';
import { BANK_DIR } from '../paths.ts';

export class QuestionBank {
  tests = new Map<string, TestBank>();
  questions = new Map<string, Question>();
  groups = new Map<string, Group>();
  groupsByPart = new Map<Part, Group[]>();

  load() {
    this.tests.clear();
    this.questions.clear();
    this.groups.clear();
    this.groupsByPart.clear();
    let files: string[] = [];
    try {
      files = readdirSync(BANK_DIR).filter((f) => f.endsWith('.json'));
    } catch {
      /* chưa import */
    }
    for (const f of files) {
      const t = JSON.parse(readFileSync(join(BANK_DIR, f), 'utf8')) as TestBank;
      this.tests.set(t.id, t);
      for (const q of t.questions) this.questions.set(q.id, q);
      for (const g of t.groups) {
        this.groups.set(g.id, g);
        const list = this.groupsByPart.get(g.part) ?? [];
        list.push(g);
        this.groupsByPart.set(g.part, list);
      }
    }
    return this;
  }

  availableParts(): Part[] {
    return [...this.groupsByPart.keys()].sort();
  }

  /** Nhóm câu ở dạng an toàn: KHÔNG có đáp án, giải thích, bản dịch */
  publicGroup(groupId: string, only?: Set<string>): PublicGroup {
    const g = this.groups.get(groupId)!;
    return {
      id: g.id,
      testId: g.testId,
      testTitle: this.tests.get(g.testId)?.title ?? g.testId,
      part: g.part,
      passages: g.passages,
      questions: g.numbers
        .map((n) => this.questions.get(`${g.testId}:${n}`)!)
        .filter((q) => !only || only.has(q.id))
        .map((q) => ({ id: q.id, number: q.number, part: q.part, stem: q.stem, options: q.options })),
    };
  }

  reveal(questionId: string): Reveal | undefined {
    const q = this.questions.get(questionId);
    if (!q) return;
    return { id: q.id, answer: q.answer, note: q.note, explanation: q.explanation, translation: q.translation };
  }

  groupQuestionIds(groupId: string) {
    const g = this.groups.get(groupId)!;
    return g.numbers.map((n) => `${g.testId}:${n}`);
  }

  randomGroup(part: Part, avoid: Set<string>): Group | undefined {
    const list = this.groupsByPart.get(part) ?? [];
    if (!list.length) return;
    const fresh = list.filter((g) => !avoid.has(g.id));
    const pool = fresh.length ? fresh : list;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Chọn ngẫu nhiên các nhóm câu sao cho tổng ≈ target, không cắt rời câu cùng đoạn văn.
   * Nhiều Part: lần lượt lấy xoay vòng để các Part được chia gần đều.
   */
  pickExam(parts: Part[], target = 15): Group[] {
    const pools = parts
      .map((p) => shuffle([...(this.groupsByPart.get(p) ?? [])]))
      .filter((p) => p.length);
    const picked: Group[] = [];
    const counts = pools.map(() => 0);
    let total = 0;
    const slack = 2;
    while (total < target) {
      const remaining = target - total;
      // Ưu tiên Part đang có ít câu nhất để chia đều số câu giữa các Part
      const order = pools.map((_, k) => k).sort((x, y) => counts[x] - counts[y] || Math.random() - 0.5);
      let chosen: { k: number; i: number } | undefined;
      for (const limit of [remaining, remaining + slack]) {
        for (const k of order) {
          const i = pools[k].findIndex((g) => g.numbers.length <= limit);
          if (i >= 0) {
            chosen = { k, i };
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) break;
      const [g] = pools[chosen.k].splice(chosen.i, 1);
      picked.push(g);
      counts[chosen.k] += g.numbers.length;
      total += g.numbers.length;
    }
    // Sắp theo Part rồi theo đề để làm bài tự nhiên như đề thật
    return picked.sort((a, b) => a.part - b.part);
  }
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Thời gian làm bài theo Part (giây/câu), gần với nhịp đề thật (75 phút / 100 câu) */
export const SECONDS_PER_QUESTION: Record<number, number> = { 5: 30, 6: 40, 7: 60 };
export const TIME_SCALE = Number(process.env.EXAM_TIME_SCALE ?? 1);

export function examDurationMs(questions: Question[]) {
  const s = questions.reduce((sum, q) => sum + (SECONDS_PER_QUESTION[q.part] ?? 45), 0);
  return Math.max(10_000, Math.round(s * 1000 * TIME_SCALE));
}

export const bank = new QuestionBank().load();

/** Chạy lại `npm run import` khi server đang chạy → tự nạp đề mới, không cần khởi động lại */
export function watchBank() {
  mkdirSync(BANK_DIR, { recursive: true });
  let t: NodeJS.Timeout | undefined;
  watch(BANK_DIR, () => {
    clearTimeout(t);
    t = setTimeout(() => {
      try {
        bank.load();
        console.log(`Đã nạp lại ngân hàng đề: ${bank.tests.size} bộ, ${bank.questions.size} câu`);
      } catch (e) {
        console.error('Nạp lại đề lỗi (sẽ thử lại khi file đổi tiếp):', e);
      }
    }, 1500);
  });
}
