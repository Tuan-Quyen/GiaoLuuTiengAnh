// Phòng thi: thi cá nhân, phòng thi chung (đăng ký trước, cùng giờ, bảng xếp hạng), xem lại, lịch sử.
import type { Choice, Part, PublicGroup, Reveal } from '../../../shared/bank.ts';
import { api } from '../api.ts';
import { fmtDuration, h, openModal, toast } from '../dom.ts';
import { groupMeta, passagesEl, passageTranslationEl, questionEl } from './questions.ts';

interface Paper {
  status?: 'in_progress';
  attemptId: string;
  sharedId: string | null;
  parts: Part[];
  startedAt: number;
  deadline: number;
  serverNow: number;
  total: number;
  answers: Record<string, Choice>;
  groups: PublicGroup[];
}

interface Result {
  status: 'submitted';
  attemptId: string;
  sharedId: string | null;
  parts: Part[];
  startedAt: number;
  submittedAt: number;
  autoSubmitted: boolean;
  score: number;
  total: number;
  answers: Record<string, Choice>;
  groups: (PublicGroup & { passageTranslation?: string })[];
  reveals: Record<string, Reveal>;
}

interface SharedSummary {
  id: string;
  title: string;
  parts: Part[];
  total: number;
  startAt: number;
  durationMs: number;
  status: 'upcoming' | 'live' | 'done';
  registered: boolean;
  registrations: number;
  createdBy: string;
  myAttemptId: string | null;
  mySubmitted: boolean;
}

const PART_TIME: Record<number, number> = { 5: 30, 6: 40, 7: 60 };
const fmtTime = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} · ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

export class ExamCenter {
  private close?: () => void;
  private root = h('div', { style: { display: 'contents' } });
  private tab: 'solo' | 'shared' | 'history' = 'solo';
  private timer?: number;
  private offset = 0; // serverNow - Date.now()
  private sharedListeners = new Set<(examId: string) => void>();
  /** đang làm bài → không cho đóng nhầm */
  private busy = false;

  constructor(private room: string, private myId: () => string) {}

  get isOpen() {
    return Boolean(this.close);
  }

  /** Server báo phòng thi chung thay đổi (có người đăng ký, nộp bài, tới giờ…) */
  sharedChanged(examId: string) {
    for (const fn of this.sharedListeners) fn(examId);
  }

  open(tab?: 'solo' | 'shared' | 'history') {
    if (tab) this.tab = tab;
    if (!this.close) {
      this.close = openModal(this.root, {
        full: true,
        dismissable: true,
        onClose: () => {
          this.close = undefined;
          this.stopTimer();
          this.sharedListeners.clear();
        },
      });
    }
    this.renderHome();
  }

  private shut() {
    if (this.busy && !confirm('Bạn đang làm bài. Đóng cửa sổ? (Bài vẫn tính giờ, có thể mở lại để làm tiếp)')) return;
    this.close?.();
  }

  private head(title: string, ...extra: (HTMLElement | null)[]) {
    return h('div.panel-head', h('h2', title), ...extra, h('div.spacer'), h('button.ghost', { onclick: () => this.shut(), title: 'Đóng' }, '✕'));
  }

  // ---------------- Trang chính ----------------

  private async renderHome() {
    this.busy = false;
    this.stopTimer();
    this.sharedListeners.clear();
    // Còn bài đang làm dở? (tải lại trang giữa chừng)
    try {
      const hist = await api('GET', '/exam/history');
      const active = hist.active.find((a: { shared_id: string | null }) => !a.shared_id) ?? hist.active[0];
      if (active) {
        const p = await api('GET', `/exam/${active.id}`);
        if (p.status === 'in_progress') return this.renderPaper(p);
      }
    } catch {
      /* bỏ qua */
    }
    const tabs = h(
      'div.tabs',
      ([
        ['solo', 'Thi cá nhân'],
        ['shared', 'Phòng thi chung'],
        ['history', 'Lịch sử'],
      ] as const).map(([k, label]) =>
        h(`button${this.tab === k ? '.on' : ''}`, { onclick: () => ((this.tab = k), this.renderHome()) }, label),
      ),
    );
    const body = h('div.panel-body', tabs);
    this.root.replaceChildren(this.head('📝 Phòng thi'), body);
    if (this.tab === 'solo') body.append(this.soloForm());
    else if (this.tab === 'shared') body.append(await this.sharedView());
    else body.append(await this.historyView());
  }

  private partPicker(initial: Part[]) {
    const chosen = new Set<Part>(initial);
    const info = h('div.muted.small');
    const update = () => {
      const parts = [...chosen];
      const avg = parts.length ? parts.reduce((s, p) => s + PART_TIME[p], 0) / parts.length : 0;
      info.textContent = parts.length ? `~15 câu · khoảng ${Math.round((15 * avg) / 60)} phút` : 'Chọn ít nhất một Part';
    };
    const btns = ([5, 6, 7] as Part[]).map((p) => {
      const b = h(`button.chip${chosen.has(p) ? '.on' : ''}`, {
        onclick: () => {
          if (chosen.has(p)) chosen.delete(p);
          else chosen.add(p);
          b.classList.toggle('on', chosen.has(p));
          update();
        },
      }, `Part ${p}`);
      return b;
    });
    update();
    return { el: h('div.col', h('div.row.wrap', btns), info), get: () => [...chosen].sort() };
  }

  private soloForm() {
    const picker = this.partPicker([7]);
    const start = h('button.primary', {
      onclick: async () => {
        if (!picker.get().length) return toast('Chọn ít nhất một Part');
        start.disabled = true;
        try {
          this.renderPaper(await api('POST', '/exam/solo', { parts: picker.get(), room: this.room }));
        } catch (e) {
          toast((e as Error).message);
          start.disabled = false;
        }
      },
    }, 'Bắt đầu thi');
    return h(
      'div.col',
      h('h3', 'Thi cá nhân — bất kỳ lúc nào'),
      h('div.muted.small', 'Đề ngẫu nhiên ~15 câu từ các Part bạn chọn. Câu cùng đoạn văn luôn đi cùng nhau. Hết giờ hệ thống tự nộp.'),
      picker.el,
      h('div', start),
    );
  }

  // ---------------- Làm bài ----------------

  private renderPaper(p: Paper) {
    this.busy = true;
    this.offset = p.serverNow - Date.now();
    const answers: Record<string, Choice> = { ...p.answers };
    const qcount = p.groups.reduce((s, g) => s + g.questions.length, 0);
    const countdown = h('span.countdown', '--:--');
    const progress = h('span.muted.small');
    const nav = h('div.qnav');
    const navBtns = new Map<string, HTMLButtonElement>();
    let submitting = false;

    const updateProgress = () => {
      progress.textContent = `Đã làm ${Object.keys(answers).length}/${qcount}`;
      for (const [id, b] of navBtns) b.classList.toggle('done', Boolean(answers[id]));
    };

    const submit = async (auto: boolean) => {
      if (submitting) return;
      if (!auto) {
        const left = qcount - Object.keys(answers).length;
        if (left > 0 && !confirm(`Còn ${left} câu chưa làm. Nộp bài?`)) return;
      }
      submitting = true;
      this.stopTimer();
      if (auto) toast('⏰ Hết giờ — đã tự nộp bài');
      try {
        const r = await api<Result>('POST', `/exam/${p.attemptId}/submit`, { answers, auto });
        this.renderResult(r);
      } catch (e) {
        submitting = false;
        toast((e as Error).message);
      }
    };

    const groupsEl = p.groups.map((g) => {
      const views = g.questions.map((q) => {
        const v = questionEl(q, (c) => {
          answers[q.id] = c;
          v.select(c);
          updateProgress();
          api('PUT', `/exam/${p.attemptId}/answer`, { questionId: q.id, choice: c }).catch((e) => toast(e.message));
        });
        if (answers[q.id]) v.select(answers[q.id]);
        const b = h('button', { onclick: () => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, String(q.number));
        navBtns.set(q.id, b);
        nav.append(b);
        return v.el;
      });
      return h('div.group', groupMeta(g), g.passages.length ? passagesEl(g.passages) : null, views);
    });

    this.root.replaceChildren(
      this.head(p.sharedId ? '🏁 Phòng thi chung' : '📝 Đang thi', countdown, progress),
      h('div.panel-body', h('div', { style: { marginBottom: '12px' } }, nav), groupsEl),
      h('div.panel-foot', h('span.muted.small', 'Đáp án được lưu tự động.'), h('div.spacer'), h('button.primary', { onclick: () => submit(false) }, 'Nộp bài')),
    );
    updateProgress();

    const tick = () => {
      const left = p.deadline - (Date.now() + this.offset);
      countdown.textContent = fmtDuration(left);
      countdown.classList.toggle('low', left < 60_000);
      if (left <= 0) submit(true);
    };
    tick();
    this.timer = window.setInterval(tick, 250);
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // ---------------- Kết quả & xem lại ----------------

  private renderResult(r: Result) {
    this.busy = false;
    const byPart = new Map<number, { right: number; total: number }>();
    for (const g of r.groups)
      for (const q of g.questions) {
        const s = byPart.get(q.part) ?? { right: 0, total: 0 };
        s.total++;
        if (r.answers[q.id] === r.reveals[q.id]?.answer) s.right++;
        byPart.set(q.part, s);
      }
    const used = (r.submittedAt - r.startedAt) / 1000;
    const nav = h('div.qnav');
    const groups = r.groups.map((g) =>
      h(
        'div.group',
        groupMeta(g),
        g.passages.length ? passagesEl(g.passages) : null,
        g.questions.map((q) => {
          const v = questionEl(q);
          const rev = r.reveals[q.id];
          v.showResult(rev, r.answers[q.id]);
          const ok = r.answers[q.id] === rev.answer;
          nav.append(h(`button.${ok ? 'right' : 'wrong'}`, { onclick: () => document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, String(q.number)));
          return v.el;
        }),
        passageTranslationEl(g.passageTranslation),
      ),
    );
    const board = h('div');
    if (r.sharedId) this.mountLeaderboard(board, r.sharedId);
    this.root.replaceChildren(
      this.head('Kết quả'),
      h(
        'div.panel-body',
        h(
          'div.row.wrap',
          { style: { gap: '20px', marginBottom: '12px' } },
          h('div', h('div.score-big', `${r.score}/${r.total}`), h('div.muted.small', `${Math.round((r.score / r.total) * 100)}% · ${fmtDuration(used * 1000)}${r.autoSubmitted ? ' · tự nộp khi hết giờ' : ''}`)),
          h(
            'div.col.grow',
            { style: { gap: '6px', minWidth: '200px' } },
            [...byPart].map(([part, s]) =>
              h('div', h('div.row.small', `Part ${part}`, h('div.spacer'), `${s.right}/${s.total}`), h('div.bar', h('i', { style: { width: `${(s.right / s.total) * 100}%` } }))),
            ),
          ),
        ),
        board,
        h('h3', { style: { marginTop: '12px' } }, 'Xem lại từng câu'),
        h('div', { style: { marginBottom: '12px' } }, nav),
        groups,
      ),
      h('div.panel-foot', h('div.spacer'), h('button', { onclick: () => this.renderHome() }, '‹ Về phòng thi')),
    );
  }

  private async openAttempt(id: string) {
    const r = await api('GET', `/exam/${id}`);
    if (r.status === 'submitted') this.renderResult(r);
    else this.renderPaper(r);
  }

  // ---------------- Phòng thi chung ----------------

  private async sharedView() {
    const wrap = h('div.col');
    const list = h('div.col');
    const render = async () => {
      let items: SharedSummary[] = [];
      try {
        items = await api('GET', `/rooms/${this.room}/shared`);
      } catch (e) {
        list.replaceChildren(h('div.muted', (e as Error).message));
        return;
      }
      list.replaceChildren(...(items.length ? items.map((s) => this.sharedCard(s, render)) : [h('div.muted', 'Chưa có lịch thi chung nào. Tạo một lịch bên dưới!')]));
    };
    this.sharedListeners.add(() => render());
    // cập nhật trạng thái (sắp diễn ra → đang thi) theo đồng hồ
    const iv = window.setInterval(() => (document.body.contains(list) ? render() : clearInterval(iv)), 15_000);

    const picker = this.partPicker([5, 6, 7]);
    const title = h('input', { placeholder: 'Tên buổi thi (tuỳ chọn)', maxLength: 60 });
    const when = h('input', { type: 'datetime-local' });
    const d = new Date(Date.now() + 5 * 60_000);
    d.setSeconds(0, 0);
    when.value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    const create = h('button.primary', {
      onclick: async () => {
        const startAt = new Date(when.value).getTime();
        if (!picker.get().length) return toast('Chọn ít nhất một Part');
        try {
          await api('POST', `/rooms/${this.room}/shared`, { title: title.value, parts: picker.get(), startAt });
          toast('Đã tạo lịch thi — bạn được đăng ký tự động');
          title.value = '';
          render();
        } catch (e) {
          toast((e as Error).message);
        }
      },
    }, 'Tạo lịch thi');
    wrap.append(
      h('div.muted.small', 'Đăng ký trước; đến giờ mọi người cùng làm một đề. Xếp hạng theo điểm, bằng điểm thì ai nộp nhanh hơn đứng trên.'),
      list,
      h('div.group', h('h3', 'Tạo lịch thi chung'), h('div.col', title, h('label.small.muted', 'Giờ bắt đầu'), when, picker.el, h('div', create))),
    );
    await render();
    return wrap;
  }

  private sharedCard(s: SharedSummary, refresh: () => void) {
    const statusText = { upcoming: `Bắt đầu ${fmtTime(s.startAt)}`, live: '🔴 Đang thi', done: 'Đã kết thúc' }[s.status];
    const actions: HTMLElement[] = [];
    const act = (label: string, fn: () => Promise<unknown>, cls = '') =>
      h(`button${cls}` as 'button', { onclick: () => fn().catch((e) => toast(e.message)) }, label);
    if (s.status === 'upcoming') {
      actions.push(
        s.registered
          ? act('Huỷ đăng ký', () => api('POST', `/rooms/${this.room}/shared/${s.id}/register`, { on: false }).then(refresh))
          : act('Đăng ký', () => api('POST', `/rooms/${this.room}/shared/${s.id}/register`, { on: true }).then(refresh), '.primary'),
      );
    }
    if (s.status === 'live' && s.registered && !s.mySubmitted)
      actions.push(act(s.myAttemptId ? 'Làm tiếp' : 'Vào thi', async () => this.renderPaper(await api('POST', `/rooms/${this.room}/shared/${s.id}/start`)), '.primary'));
    if (s.myAttemptId && s.mySubmitted) actions.push(act('Xem bài', () => this.openAttempt(s.myAttemptId!)));
    actions.push(act('Bảng xếp hạng', async () => this.renderSharedBoard(s.id)));
    return h(
      'div.group',
      h('div.row.wrap', h('b', s.title), h('span.muted.small', `Part ${s.parts.join(', ')} · ${s.total} câu · ${Math.round(s.durationMs / 60000)} phút`), h('div.spacer'), h('span.small', statusText)),
      h('div.row.wrap', { style: { marginTop: '8px' } }, h('span.muted.small', `${s.registrations} người đăng ký · tạo bởi ${s.createdBy}${s.registered ? ' · bạn đã đăng ký' : ''}`), h('div.spacer'), actions),
    );
  }

  private renderSharedBoard(id: string) {
    this.busy = false;
    this.stopTimer();
    const board = h('div');
    this.root.replaceChildren(this.head('🏆 Bảng xếp hạng'), h('div.panel-body', board), h('div.panel-foot', h('div.spacer'), h('button', { onclick: () => ((this.tab = 'shared'), this.renderHome()) }, '‹ Lịch thi chung')));
    this.mountLeaderboard(board, id);
  }

  /** Bảng xếp hạng tự cập nhật khi có người nộp bài */
  private mountLeaderboard(el: HTMLElement, id: string) {
    const render = async () => {
      try {
        const lb = await api('GET', `/rooms/${this.room}/shared/${id}/leaderboard`);
        const st: Record<string, string> = { submitted: 'Đã nộp', doing: 'Đang làm…', waiting: 'Chờ giờ thi', absent: 'Vắng' };
        let rank = 0;
        el.replaceChildren(
          h('h3', `🏆 ${lb.exam.title}`),
          h('div.muted.small', { style: { marginBottom: '6px' } }, `${fmtTime(lb.exam.startAt)} · ${lb.exam.total} câu · ${{ upcoming: 'sắp diễn ra', live: 'đang thi', done: 'đã kết thúc' }[lb.exam.status as string]}`),
          h(
            'table.lb',
            h('tr', h('th', '#'), h('th', 'Tên'), h('th', 'Điểm'), h('th', 'Thời gian'), h('th', 'Trạng thái')),
            lb.entries.map((e: { userId: string; name: string; state: string; score: number | null; durationMs: number | null; autoSubmitted: boolean }) =>
              h(
                `tr${e.userId === this.myId() ? '.me' : ''}`,
                h('td', e.state === 'submitted' ? String(++rank) : '–'),
                h('td', e.name),
                h('td', e.score === null ? '–' : `${e.score}/${lb.exam.total}`),
                h('td', e.durationMs === null ? '–' : fmtDuration(e.durationMs)),
                h('td.small.muted', st[e.state] + (e.autoSubmitted ? ' (hết giờ)' : '')),
              ),
            ),
          ),
        );
      } catch (e) {
        el.replaceChildren(h('div.muted', (e as Error).message));
      }
    };
    this.sharedListeners.add((examId) => examId === id && render());
    render();
  }

  // ---------------- Lịch sử ----------------

  private async historyView() {
    const hist = await api('GET', '/exam/history');
    const parts = hist.byPart as { part: number; answered: number; correct: number }[];
    const weakest = [...parts].filter((p) => p.answered >= 5).sort((a, b) => a.correct / a.answered - b.correct / b.answered)[0];
    return h(
      'div.col',
      h('h3', 'Tỉ lệ đúng theo Part (các bài thi)'),
      parts.length
        ? h(
            'div.col',
            { style: { gap: '8px' } },
            parts.map((p) =>
              h('div', h('div.row.small', `Part ${p.part}`, h('div.spacer'), `${p.correct}/${p.answered} · ${Math.round((p.correct / p.answered) * 100)}%`), h('div.bar', h('i', { style: { width: `${(p.correct / p.answered) * 100}%` } }))),
            ),
            weakest ? h('div.note', `Part hay sai nhất: Part ${weakest.part} — nên ôn thêm ở thư viện.`) : null,
          )
        : h('div.muted', 'Chưa có bài thi nào.'),
      h('h3', { style: { marginTop: '10px' } }, 'Các bài đã làm'),
      h(
        'table.lb',
        h('tr', h('th', 'Ngày'), h('th', 'Loại'), h('th', 'Part'), h('th', 'Điểm'), h('th', '')),
        (hist.attempts as { id: string; parts: string; score: number; total: number; started_at: number; submitted_at: number; title: string | null; shared_id: string | null }[]).map((a) =>
          h(
            'tr',
            h('td.small', fmtTime(a.started_at)),
            h('td.small', a.shared_id ? `Chung: ${a.title}` : 'Cá nhân'),
            h('td.small', JSON.parse(a.parts).join(', ')),
            h('td', `${a.score}/${a.total}`),
            h('td', h('button.chip', { onclick: () => this.openAttempt(a.id) }, 'Xem lại')),
          ),
        ),
      ),
    );
  }
}
