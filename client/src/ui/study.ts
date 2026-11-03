// Ôn tập khi ngồi bàn thư viện: chọn Part → làm từng câu → xem đáp án, giải thích, bản dịch.
import type { Choice, Part, PublicGroup, Reveal } from '../../../shared/bank.ts';
import { api } from '../api.ts';
import { fmtHours, h, toast, ui } from '../dom.ts';
import { groupMeta, passagesEl, passageTranslationEl, questionEl } from './questions.ts';

interface Opts {
  onStandUp(): void;
  onNod(): void;
}

export class StudyPanel {
  private el?: HTMLElement;
  private part: Part = 5;
  private body = h('div.panel-body');
  private statsEl = h('span.muted.small');
  private correct = 0;
  private answered = 0;

  constructor(private opts: Opts) {}

  get open() {
    return Boolean(this.el);
  }

  show() {
    if (this.el) return;
    const partBtns = ([5, 6, 7] as Part[]).map((p) =>
      h(`button.chip${p === this.part ? '.on' : ''}`, { onclick: () => this.choose(p, partBtns) }, `Part ${p}`),
    );
    this.el = h(
      'div.drawer',
      h(
        'div.panel-head',
        h('h2', '📖 Ôn tập'),
        h('div.row', partBtns),
        h('div.spacer'),
        h('button.chip', { onclick: () => this.opts.onNod(), title: 'Gật đầu chào (N)' }, '🙂 Gật đầu'),
        h('button.chip', { onclick: () => this.opts.onStandUp() }, 'Đứng dậy'),
      ),
      this.body,
      h('div.panel-foot', this.statsEl, h('div.spacer'), h('button.primary', { onclick: () => this.next() }, 'Câu tiếp ›')),
    );
    ui().appendChild(this.el);
    this.refreshStats();
    this.next();
  }

  hide() {
    this.el?.remove();
    this.el = undefined;
  }

  private choose(p: Part, btns: HTMLElement[]) {
    this.part = p;
    btns.forEach((b, i) => b.classList.toggle('on', [5, 6, 7][i] === p));
    this.next();
  }

  private async refreshStats() {
    try {
      const s = await api('GET', '/stats');
      this.statsEl.textContent = `Hôm nay: ${fmtHours(s.today.seconds)} · ${s.today.answered} câu · chuỗi ${s.streak} ngày${
        this.answered ? ` · lượt này ${this.correct}/${this.answered}` : ''
      }`;
    } catch {
      /* bỏ qua */
    }
  }

  async next() {
    this.body.replaceChildren(h('div.muted', 'Đang lấy câu hỏi…'));
    let g: PublicGroup;
    try {
      g = await api<PublicGroup>('GET', `/study/next?part=${this.part}`);
    } catch (e) {
      this.body.replaceChildren(h('div.muted', (e as Error).message));
      return;
    }
    const tail = h('div');
    let left = g.questions.length;
    const views = g.questions.map((q) => {
      let done = false;
      const v = questionEl(q, async (c: Choice) => {
        if (done) return;
        done = true;
        try {
          const r = await api<{ correct: boolean; reveal: Reveal; passageTranslation: string | null }>('POST', '/study/answer', {
            questionId: q.id,
            choice: c,
          });
          v.showResult(r.reveal, c);
          this.answered++;
          if (r.correct) this.correct++;
          if (--left === 0) {
            tail.replaceChildren(
              passageTranslationEl(r.passageTranslation) ?? h('span'),
              h('div.row', { style: { marginTop: '12px' } }, h('div.spacer'), h('button.primary', { onclick: () => this.next() }, 'Câu tiếp ›')),
            );
          }
          this.refreshStats();
        } catch (e) {
          done = false;
          toast((e as Error).message);
        }
      });
      return v;
    });
    this.body.replaceChildren(
      h('div.group', groupMeta(g), g.passages.length ? passagesEl(g.passages) : null, views.map((v) => v.el), tail),
    );
    this.body.scrollTop = 0;
  }
}
