// Hiển thị đoạn văn + câu hỏi, dùng chung cho Ôn tập và Thi.
import type { Choice, Passage, PublicGroup, PublicQuestion, Reveal } from '../../../shared/bank.ts';
import { h, lightbox } from '../dom.ts';
import { md } from './md.ts';

export function passagesEl(passages: Passage[]) {
  return h(
    'div.passage',
    passages.map((p) =>
      p.kind === 'image'
        ? h('img', { src: p.src, alt: p.caption ?? 'Đoạn văn', loading: 'lazy', onclick: () => lightbox(p.src!) })
        : h('div', p.caption ? h('div.cap', p.caption) : null, h('pre', p.text ?? '')),
    ),
  );
}

export function groupMeta(g: PublicGroup) {
  const nums = g.questions.map((q) => q.number);
  const range = nums.length > 1 ? `Câu ${nums[0]}–${nums.at(-1)}` : `Câu ${nums[0]}`;
  return h('div.group-meta', `Part ${g.part} · ${g.testTitle} · ${range}`);
}

export interface QuestionView {
  el: HTMLElement;
  select(c: Choice | null): void;
  showResult(reveal: Reveal, chosen: Choice | undefined): void;
}

/** onChoose: người dùng bấm phương án. Trả về view để tô màu kết quả sau. */
export function questionEl(q: PublicQuestion, onChoose?: (c: Choice) => void): QuestionView {
  const buttons = new Map<Choice, HTMLButtonElement>();
  const extra = h('div');
  const el = h(
    'div.q',
    { id: `q-${q.id}` },
    h('div.stem', h('span.num', `${q.number}.`), q.stem ? q.stem : h('span.muted', 'Chọn đáp án điền vào chỗ trống')),
    h(
      'div.opts',
      q.options.map((o) => {
        const b = h('button.opt', { onclick: () => onChoose?.(o.key) }, h('span.k', o.key), h('span', o.text));
        buttons.set(o.key, b);
        return b;
      }),
    ),
    extra,
  );
  return {
    el,
    select(c) {
      for (const [k, b] of buttons) b.classList.toggle('sel', k === c);
    },
    showResult(reveal, chosen) {
      for (const [k, b] of buttons) {
        b.disabled = true;
        b.classList.remove('sel');
        if (k === reveal.answer) b.classList.add('right');
        else if (k === chosen) b.classList.add('wrong');
      }
      const ok = chosen === reveal.answer;
      const parts: (HTMLElement | null)[] = [
        h(
          `div.verdict.${ok ? 'ok' : 'bad'}`,
          chosen ? (ok ? '✓ Chính xác' : `✗ Chưa đúng — đáp án ${reveal.answer}`) : `Bỏ trống — đáp án ${reveal.answer}`,
        ),
        reveal.note ? h('div.note', reveal.note) : null,
        reveal.explanation ? h('details', h('summary', 'Giải thích'), md(reveal.explanation)) : null,
        reveal.translation ? h('details', h('summary', 'Bản dịch'), md(reveal.translation)) : null,
      ];
      extra.replaceChildren(...parts.filter((x): x is HTMLElement => Boolean(x)));
    },
  };
}

export function passageTranslationEl(text: string | null | undefined) {
  return text ? h('details', h('summary', 'Bản dịch đoạn văn'), md(text)) : null;
}
