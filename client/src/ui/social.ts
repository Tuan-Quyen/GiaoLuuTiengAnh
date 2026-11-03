// Thống kê, bảng xếp hạng tuần, bạn bè, hồ sơ.
import { ZONE_LABEL, type Zone } from '../../../shared/map.ts';
import { api, auth, type Me } from '../api.ts';
import { fmtHours, h, openModal, toast } from '../dom.ts';
import { avatarPicker } from './avatarPicker.ts';

type Tab = 'stats' | 'rank' | 'friends' | 'profile';

export class SocialPanel {
  private close?: () => void;
  private root = h('div', { style: { display: 'contents' } });

  constructor(private room: string, private me: () => Me, private onProfileChanged: (me: Me) => void) {}

  open(tab: Tab) {
    if (!this.close) this.close = openModal(this.root, { onClose: () => (this.close = undefined) });
    this.render(tab);
  }

  private async render(tab: Tab) {
    const labels: [Tab, string][] = [
      ['stats', '📊 Thống kê'],
      ['rank', '🏆 Xếp hạng'],
      ['friends', '👥 Bạn bè'],
      ['profile', '👤 Hồ sơ'],
    ];
    const body = h('div.panel-body', h('div.muted', 'Đang tải…'));
    this.root.replaceChildren(
      h('div.panel-head', h('div.tabs', { style: { margin: '0', flex: '1' } }, labels.map(([k, l]) => h(`button${k === tab ? '.on' : ''}`, { onclick: () => this.render(k) }, l))), h('button.ghost', { onclick: () => this.close?.() }, '✕')),
      body,
    );
    try {
      const view = await { stats: () => this.stats(), rank: () => this.rank('room'), friends: () => this.friends(), profile: () => this.profile() }[tab]();
      body.replaceChildren(view);
    } catch (e) {
      body.replaceChildren(h('div.muted', (e as Error).message));
    }
  }

  private async stats() {
    const s = await api('GET', '/stats');
    const max = Math.max(1, ...s.last7.map((d: { seconds: number }) => d.seconds));
    const byPart = new Map<number, { answered: number; correct: number }>();
    for (const r of s.byPart as { part: number; answered: number; correct: number }[]) {
      const v = byPart.get(r.part) ?? { answered: 0, correct: 0 };
      v.answered += r.answered;
      v.correct += r.correct;
      byPart.set(r.part, v);
    }
    const stat = (v: string, l: string) => h('div.stat', h('b', v), h('span', l));
    return h(
      'div.col',
      h('h3', 'Hôm nay'),
      h('div.stat-grid', stat(fmtHours(s.today.seconds), 'giờ học'), stat(String(s.today.answered), 'câu đã làm'), stat(`${s.streak} 🔥`, 'ngày liên tiếp')),
      h('h3', 'Tổng cộng'),
      h('div.stat-grid', stat(fmtHours(s.total.seconds), 'giờ học'), stat(String(s.total.answered), 'câu đã làm'), stat(s.total.answered ? `${Math.round((s.total.correct / s.total.answered) * 100)}%` : '–', 'tỉ lệ đúng')),
      h('h3', '7 ngày gần nhất (giờ ngồi học)'),
      h(
        'div.week',
        s.last7.map((d: { day: string; seconds: number; answered: number }) =>
          h('div', { title: `${fmtHours(d.seconds)} · ${d.answered} câu` }, h('i', { style: { height: `${(d.seconds / max) * 70}px` } }), d.day.slice(8) + '/' + d.day.slice(5, 7)),
        ),
      ),
      h('h3', 'Theo Part (ôn tập + thi)'),
      byPart.size
        ? h('div.col', { style: { gap: '8px' } }, [...byPart].sort((a, b) => a[0] - b[0]).map(([p, v]) => h('div', h('div.row.small', `Part ${p}`, h('div.spacer'), `${v.correct}/${v.answered}`), h('div.bar', h('i', { style: { width: `${(v.correct / v.answered) * 100}%` } })))))
        : h('div.muted', 'Chưa làm câu nào.'),
      h('div.muted.small', 'Giờ học được tính khi bạn ngồi ở bàn thư viện. Ngày có học: ≥ 5 phút hoặc ≥ 1 câu.'),
    );
  }

  private async rank(scope: 'room' | 'friends') {
    const lb = await api('GET', `/rooms/${this.room}/leaderboard?scope=${scope}`);
    const meId = this.me().id;
    const wrap = h('div.col');
    const scopeTabs = h(
      'div.row',
      h(`button.chip${scope === 'room' ? '.on' : ''}`, { onclick: async () => wrap.replaceWith(await this.rank('room')) }, 'Cả phòng'),
      h(`button.chip${scope === 'friends' ? '.on' : ''}`, { onclick: async () => wrap.replaceWith(await this.rank('friends')) }, 'Bạn bè'),
      h('div.spacer'),
      h('span.muted.small', `Tuần từ ${lb.weekStart.slice(8)}/${lb.weekStart.slice(5, 7)}`),
    );
    const table = (rows: { userId: string; name: string }[], head: string, cell: (r: any) => string) =>
      h('table.lb', h('tr', h('th', '#'), h('th', 'Tên'), h('th', head)), rows.map((r, i) => h(`tr${r.userId === meId ? '.me' : ''}`, h('td', String(i + 1)), h('td', r.name), h('td', cell(r)))));
    wrap.append(
      scopeTabs,
      h('div.row.wrap', { style: { alignItems: 'flex-start', gap: '16px' } },
        h('div.grow', { style: { minWidth: '240px' } }, h('h3', '⏱ Giờ học'), table(lb.study, 'Thời gian', (r) => fmtHours(r.seconds))),
        h('div.grow', { style: { minWidth: '240px' } }, h('h3', '📝 Điểm thi'), table(lb.exam, 'Câu đúng', (r) => `${r.points} (${r.exams} bài)`)),
      ),
    );
    return wrap;
  }

  private async friends() {
    const list = await api('GET', '/friends');
    const me = this.me();
    const tag = h('input', { placeholder: 'Mã bạn bè, ví dụ AB3CD', maxLength: 8, style: { textTransform: 'uppercase' } });
    const refresh = () => this.render('friends');
    const zoneName = (z: string) => ZONE_LABEL[z as Zone] ?? z;
    return h(
      'div.col',
      h('div', 'Mã bạn bè của bạn: ', h('b.mono', me.tag), ' ', h('button.chip', { onclick: () => navigator.clipboard?.writeText(me.tag).then(() => toast('Đã chép mã')) }, 'Chép')),
      h('form.row', {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const r = await api('POST', '/friends', { tag: tag.value });
            toast(r.status === 'accepted' ? `Đã kết bạn với ${r.name}` : `Đã gửi lời mời tới ${r.name}`);
            refresh();
          } catch (err) {
            toast((err as Error).message);
          }
        },
      }, tag, h('button.primary', { type: 'submit' }, 'Kết bạn')),
      list.length
        ? h('div', list.map((f: { id: string; name: string; tag: string; status: string; dir: string; online: { room: string; zone: string } | null }) =>
            h('div.list-item',
              h(`span.status-dot${f.online ? '.on' : ''}`),
              h('div.grow', h('div', f.name, ' ', h('span.muted.small.mono', `#${f.tag}`)), h('div.muted.small',
                f.status === 'pending' ? (f.dir === 'in' ? 'Muốn kết bạn với bạn' : 'Đã gửi lời mời') : f.online ? `Online · ${f.online.room === this.room ? `phòng này · ${zoneName(f.online.zone)}` : 'phòng khác'}` : 'Offline')),
              f.status === 'pending' && f.dir === 'in' ? h('button.primary.chip', { onclick: () => api('POST', `/friends/${f.id}/accept`).then(refresh) }, 'Đồng ý') : null,
              h('button.chip.danger', { onclick: () => confirm(`Xoá ${f.name}?`) && api('DELETE', `/friends/${f.id}`).then(refresh) }, f.status === 'pending' ? 'Huỷ' : 'Xoá'),
            )))
        : h('div.muted', 'Chưa có bạn bè. Gửi mã của bạn cho bạn học nhé!'),
    );
  }

  private profile() {
    const me = this.me();
    const name = h('input', { value: me.name, maxLength: 24 });
    const picker = avatarPicker(me.avatar, () => name.value);
    const codeBox = h('div');
    return Promise.resolve(
      h(
        'div.col',
        h('label.small.muted', 'Tên hiển thị'),
        name,
        h('label.small.muted', 'Nhân vật'),
        picker.el,
        h('div', h('button.primary', {
          onclick: async () => {
            try {
              const u = await api<Me>('PATCH', '/me', { name: name.value, avatar: picker.get() });
              this.onProfileChanged(u);
              toast('Đã lưu hồ sơ');
            } catch (e) {
              toast((e as Error).message);
            }
          },
        }, 'Lưu')),
        h('hr', { style: { border: 'none', borderTop: '1px solid var(--line)', width: '100%' } }),
        h('div.muted.small', 'Mã khôi phục dùng để đăng nhập trên thiết bị khác. Tạo mã mới sẽ vô hiệu mã cũ.'),
        h('div.row', h('button', {
          onclick: async () => {
            if (!confirm('Tạo mã khôi phục mới? Mã cũ sẽ không dùng được nữa.')) return;
            const r = await api('POST', '/me/recovery');
            codeBox.replaceChildren(h('div.code-box.mono', r.recoveryCode), h('div.muted.small', 'Hãy lưu mã này ở nơi an toàn.'));
          },
        }, 'Tạo mã khôi phục mới'), h('div.spacer'), h('button.danger', {
          onclick: async () => {
            if (!confirm('Đăng xuất? Bạn cần mã khôi phục để đăng nhập lại.')) return;
            await api('POST', '/auth/logout').catch(() => {});
            auth.token = null;
            location.reload();
          },
        }, 'Đăng xuất')),
        codeBox,
      ),
    );
  }
}
