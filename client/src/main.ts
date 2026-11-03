import './styles.css';
import { io } from 'socket.io-client';
import { ZONE_LABEL, type Seat, type Zone } from '../../shared/map.ts';
import { pomodoro, type JoinResult } from '../../shared/protocol.ts';
import { api, auth, type Me } from './api.ts';
import { fmtDuration, h, isTouch, toast, ui } from './dom.ts';
import { preloadAvatar } from './game/avatar.ts';
import { Game } from './game/game.ts';
import { Chat } from './ui/chat.ts';
import { ExamCenter } from './ui/exam.ts';
import { chooseRoom, ensureUser } from './ui/lobby.ts';
import { SocialPanel } from './ui/social.ts';
import { StudyPanel } from './ui/study.ts';
import { Voice } from './voice.ts';

async function boot() {
  let me = await ensureUser();
  preloadAvatar(me.avatar);
  const roomCode = await chooseRoom(me);
  const config = await api('GET', '/config');

  const socket = io({ auth: { token: auth.token }, transports: ['websocket', 'polling'] });
  const join = await new Promise<JoinResult>((resolve) => {
    socket.once('connect', () => socket.emit('join', { room: roomCode }, resolve));
    socket.once('connect_error', (e) => resolve({ ok: false, error: e.message }));
  });
  if (!join.ok) {
    toast(join.error ?? 'Không vào được phòng', 5000);
    const u = new URL(location.href);
    u.searchParams.delete('room');
    history.replaceState(null, '', u);
    setTimeout(() => location.reload(), 1500);
    return;
  }
  const room = join.room!;
  const timeOffset = join.serverNow! - Date.now();
  const self = join.players!.find((p) => p.sid === join.sid)!;
  socket.on('kicked', (msg: string) => {
    toast(msg, 8000);
    socket.disconnect();
  });
  // Mất kết nối rồi nối lại → vào lại phòng cho chắc chắn (trạng thái đồng bộ lại từ đầu)
  socket.io.on('reconnect', () => location.reload());

  // ---------- HUD ----------
  const onlineEl = h('b', '1');
  const zoneEl = h('span.zone-tag', ZONE_LABEL[self.zone]);
  const pomoEl = h('span.pomo');
  const inviteUrl = () => {
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('room', room.code);
    return u.toString();
  };
  const top = h(
    'div.hud-top',
    h(
      'div.pill',
      h('span.hide-mobile', room.name),
      h('span.mono.muted', room.code),
      h('button', {
        onclick: () => {
          const url = inviteUrl();
          ('share' in navigator && isTouch() ? navigator.share({ title: room.name, url }) : navigator.clipboard.writeText(url).then(() => toast('Đã chép link mời'))).catch(() => prompt('Link mời:', url));
        },
      }, 'Mời'),
    ),
    h('div.pill', '👥 ', onlineEl, h('span.hide-mobile', ' online'), ' · ', zoneEl),
    h('div.pill', pomoEl),
    h('div.spacer'),
    h(
      'div.hud-menu',
      h('button', { onclick: () => social.open('stats'), title: 'Thống kê' }, '📊', h('span.label', ' Thống kê')),
      h('button', { onclick: () => social.open('rank'), title: 'Xếp hạng tuần' }, '🏆', h('span.label', ' Xếp hạng')),
      h('button', { onclick: () => social.open('friends'), title: 'Bạn bè' }, '👥', h('span.label', ' Bạn bè')),
      h('button', { onclick: () => social.open('profile'), title: 'Hồ sơ' }, '👤'),
    ),
  );
  ui().appendChild(top);

  // Pomodoro chung 25/5, tính theo epoch của phòng → mọi người thấy cùng một đồng hồ
  let lastPhase = '';
  const tickPomo = () => {
    const p = pomodoro(Date.now() + timeOffset, room.epoch);
    pomoEl.className = `pomo ${p.phase}`;
    pomoEl.replaceChildren(p.phase === 'focus' ? '🍅 Tập trung ' : '☕ Nghỉ ', h('b', fmtDuration(p.remaining)));
    if (lastPhase && lastPhase !== p.phase) {
      toast(p.phase === 'focus' ? '🍅 Bắt đầu 25 phút tập trung' : '☕ Nghỉ 5 phút — ra khu thư giãn trò chuyện nhé', 5000);
      beep();
    }
    lastPhase = p.phase;
  };
  tickPomo();
  setInterval(tickPomo, 1000);

  // ---------- Hành động ----------
  const promptEl = h('div.prompt.hidden');
  const actionsEl = h('div.actions');
  ui().append(promptEl, actionsEl);

  let zone: Zone = self.zone;
  let nearSeat: Seat | null = null;
  let seated: string | null = null;

  const study = new StudyPanel({ onStandUp: () => game?.leaveSeat(), onNod: () => game?.emote('nod') });
  const exam = new ExamCenter(room.code, () => me.id);
  const social = new SocialPanel(room.code, () => me, (u) => {
    me = u;
    socket.emit('profile');
  });
  socket.on('shared:changed', ({ examId }: { examId: string }) => exam.sharedChanged(examId));

  // game được tạo phía dưới (sau khi HUD sẵn sàng) → các callback phải chịu được lúc game chưa có
  let game: Game | undefined;
  const chat = new Chat(socket, me.id, join.chat!);
  const voice = new Voice(socket, {
    self: () => (game ? { sid: join.sid!, x: game.me.x, z: game.me.z, zone: game.me.zone } : null),
    others: () => [...(game?.remotes.values() ?? [])].map((r) => ({ sid: r.info.sid, x: r.avatar.root.position.x, z: r.avatar.root.position.z, zone: r.info.zone })),
    onSpeaking: (sid, on) => game?.setSpeaking(sid, on),
  }, config.iceServers);
  const unlock = () => voice.unlock();
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  const interact = async () => {
    if (!game) return;
    if (seated) return game.leaveSeat();
    if (nearSeat) {
      const r = await game.takeSeat(nearSeat.id);
      if (!r.ok) toast(r.error ?? 'Không ngồi được');
      return;
    }
    if (zone === 'exam') exam.open();
  };

  const micBtn = h('button', {
    onclick: async () => {
      const on = !voice.micOn;
      const ok = await voice.setMic(on);
      if (!ok) return toast('Không bật được micro — kiểm tra quyền truy cập micro của trình duyệt');
      renderActions();
      toast(on ? '🎤 Mic đang bật — người đứng gần bạn sẽ nghe thấy' : 'Đã tắt mic');
    },
  });

  const renderActions = () => {
    const btns: HTMLElement[] = [];
    let promptText = '';
    if (seated) {
      btns.push(h('button', { onclick: () => (study.open ? study.hide() : study.show()) }, study.open ? 'Ẩn bảng ôn' : '📖 Ôn tập'));
      btns.push(h('button', { onclick: () => game?.leaveSeat() }, 'Đứng dậy', h('span.kbd', 'E')));
    } else if (nearSeat) {
      btns.push(h('button.primary', { onclick: interact }, 'Ngồi vào bàn', h('span.kbd', 'E')));
      promptText = 'Bàn trống — ngồi xuống để ôn tập';
    } else if (zone === 'exam') {
      btns.push(h('button.primary', { onclick: () => exam.open() }, '📝 Vào phòng thi', h('span.kbd', 'E')));
    } else if (zone === 'library') {
      promptText = 'Đến gần ghế có vòng xanh để ngồi học';
    }
    if (zone === 'lounge') {
      micBtn.className = voice.micOn ? 'mic-on' : '';
      micBtn.replaceChildren(voice.micOn ? '🎤' : '🔇', h('span.label', voice.micOn ? ' Mic bật' : ' Mic tắt'));
      btns.push(micBtn);
      btns.push(h('button', { onclick: () => game?.emote('wave') }, '👋'));
    }
    btns.push(h('button', { onclick: () => game?.emote('nod'), title: 'Gật đầu (N)' }, '🙂', h('span.label', ' Gật đầu'), h('span.kbd', 'N')));
    actionsEl.replaceChildren(...btns);
    promptEl.textContent = promptText;
    promptEl.className = `prompt pill${promptText ? '' : ' hidden'}`;
  };

  game = new Game(document.getElementById('scene') as HTMLCanvasElement, socket, { ...self }, join.players!, join.seats!, {
    zone: (z) => {
      zone = z;
      zoneEl.textContent = ZONE_LABEL[z];
      chat.setZone(z);
      if (z !== 'lounge' && voice.micOn) {
        voice.setMic(false);
        toast('Đã tắt mic khi rời khu thư giãn');
      }
      if (z === 'lounge') toast('Khu thư giãn: lại gần người khác và bật mic để luyện nói 🎙');
      renderActions();
    },
    seat: (id) => {
      seated = id;
      if (id) study.show();
      else study.hide();
      renderActions();
    },
    players: (n) => (onlineEl.textContent = String(n)),
    nearSeat: (s) => {
      nearSeat = s;
      renderActions();
    },
  });
  chat.setZone(zone);
  renderActions();
  const g = game;
  if (import.meta.env.DEV) Object.assign(window, { __game: g, __voice: voice, __exam: exam });

  addEventListener('keydown', (e) => {
    if (exam.isOpen || document.querySelector('.overlay')) return;
    g.handleKey(e, { interact, nod: () => g.emote('nod'), chat: () => chat.focus() });
    if (e.code === 'Escape' && seated) g.leaveSeat();
  });
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* không có âm thanh */
  }
}

boot().catch((e) => {
  console.error(e);
  toast(`Lỗi: ${(e as Error).message}`, 8000);
});
