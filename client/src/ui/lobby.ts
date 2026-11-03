// Màn hình vào: tạo hồ sơ (tên + nhân vật) hoặc khôi phục bằng mã → chọn/tạo phòng.
import { AVATARS } from '../../../shared/protocol.ts';
import { api, auth, type Me } from '../api.ts';
import { h, mount, toast, ui } from '../dom.ts';
import { avatarPicker } from './avatarPicker.ts';

export async function ensureUser(): Promise<Me> {
  if (auth.token) {
    try {
      return await api<Me>('GET', '/me');
    } catch {
      auth.token = null;
    }
  }
  return new Promise((resolve) => {
    const root = h('div.lobby');
    ui().appendChild(root);
    let mode: 'new' | 'recover' = 'new';
    const render = () => {
      const tabs = h(
        'div.tabs',
        h(`button${mode === 'new' ? '.on' : ''}`, { onclick: () => ((mode = 'new'), render()) }, 'Tạo hồ sơ'),
        h(`button${mode === 'recover' ? '.on' : ''}`, { onclick: () => ((mode = 'recover'), render()) }, 'Đã có mã khôi phục'),
      );
      mount(root, h('div.card', h('h1', '📚 Phòng học TOEIC 3D'), h('p.muted.small', 'Học cùng nhau trong thư viện, luyện nói ở khu thư giãn, thi thử ở phòng thi.'), tabs, mode === 'new' ? newForm() : recoverForm()));
    };

    const newForm = () => {
      const name = h('input', { placeholder: 'Tên hiển thị (2–24 ký tự)', maxLength: 24, autofocus: true });
      const picker = avatarPicker(AVATARS[Math.floor(Math.random() * AVATARS.length)], () => name.value);
      return h('form.col', {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const r = await api('POST', '/auth/register', { name: name.value, avatar: picker.get() });
            auth.token = r.token;
            showRecovery(r.recoveryCode, () => (root.remove(), resolve(r.user)));
          } catch (err) {
            toast((err as Error).message);
          }
        },
      }, name, h('label.small.muted', 'Chọn nhân vật'), picker.el, h('button.primary', { type: 'submit' }, 'Tạo hồ sơ'),
      h('div.muted.small', 'Không cần email hay mật khẩu. Bạn sẽ nhận một mã khôi phục để đăng nhập lại trên thiết bị khác.'));
    };

    const recoverForm = () => {
      const code = h('input.mono', { placeholder: 'XXXX-XXXX-XXXX-XXXX', autocomplete: 'off', autocapitalize: 'characters' });
      return h('form.col', {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const r = await api('POST', '/auth/recover', { code: code.value });
            auth.token = r.token;
            root.remove();
            resolve(r.user);
          } catch (err) {
            toast((err as Error).message);
          }
        },
      }, code, h('button.primary', { type: 'submit' }, 'Đăng nhập'));
    };

    const showRecovery = (code: string, done: () => void) => {
      mount(root, h('div.card.col',
        h('h1', '🔑 Mã khôi phục của bạn'),
        h('p.muted.small', 'Đây là cách DUY NHẤT để đăng nhập lại khi đổi máy hoặc xoá dữ liệu trình duyệt. Hãy chép và cất ở nơi an toàn.'),
        h('div.code-box.mono', code),
        h('div.row', h('button', { onclick: () => navigator.clipboard?.writeText(code).then(() => toast('Đã chép mã')) }, 'Chép mã'), h('div.spacer'), h('button.primary', { onclick: done }, 'Tôi đã lưu mã ›')),
      ));
    };
    render();
  });
}

export async function chooseRoom(me: Me): Promise<string> {
  const fromUrl = new URLSearchParams(location.search).get('room');
  if (fromUrl) return fromUrl.toUpperCase();
  const rooms: { code: string; name: string; online: number }[] = await api('GET', '/rooms').catch(() => []);
  return new Promise((resolve) => {
    const root = h('div.lobby');
    ui().appendChild(root);
    const go = (code: string) => {
      const u = new URL(location.href);
      u.searchParams.set('room', code);
      history.replaceState(null, '', u);
      root.remove();
      resolve(code);
    };
    const code = h('input.mono', { placeholder: 'Mã phòng 6 ký tự', maxLength: 6, autocapitalize: 'characters' });
    const roomName = h('input', { placeholder: 'Tên phòng (tuỳ chọn)', maxLength: 40 });
    mount(root, h('div.card.col',
      h('h1', `Xin chào, ${me.name} 👋`),
      h('p.muted.small', 'Phòng là nhóm kín: chỉ ai có mã hoặc link mời mới vào được.'),
      h('form.row', { onsubmit: (e: Event) => { e.preventDefault(); if (code.value.trim().length >= 4) go(code.value.trim().toUpperCase()); } }, code, h('button.primary', { type: 'submit' }, 'Vào phòng')),
      rooms.length ? h('div.col.room-list', { style: { gap: '6px' } }, h('div.small.muted', 'Phòng gần đây'), rooms.map((r) => h('button', { onclick: () => go(r.code) }, h('span', r.name, ' ', h('span.muted.mono.small', r.code)), h('span.muted.small', r.online ? `${r.online} online` : '')))) : null,
      h('hr', { style: { border: 'none', borderTop: '1px solid var(--line)', width: '100%' } }),
      h('form.row', {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const r = await api('POST', '/rooms', { name: roomName.value });
            go(r.code);
          } catch (err) {
            toast((err as Error).message);
          }
        },
      }, roomName, h('button', { type: 'submit' }, 'Tạo phòng mới')),
    ));
  });
}
