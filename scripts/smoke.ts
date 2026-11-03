// Kiểm thử nhanh server: npm run smoke (server phải đang chạy, nên dùng EXAM_TIME_SCALE nhỏ)
import '../server/src/env.ts';
import { io, type Socket } from 'socket.io-client';

const BASE = process.env.BASE ?? `http://localhost:${process.env.PORT ?? 3001}`;
let failures = 0;
const check = (ok: unknown, msg: string) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};

async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
}

const connect = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const emitAck = <T>(s: Socket, ev: string, data: unknown) => new Promise<T>((r) => s.emit(ev, data, r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const a = await api(null, 'POST', '/auth/register', { name: 'An Smoke', avatar: 'Mage' });
const b = await api(null, 'POST', '/auth/register', { name: 'Bình Smoke', avatar: 'Rogue' });
check(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(a.recoveryCode), 'mã khôi phục dạng XXXX-XXXX-XXXX-XXXX');
const rec = await api(null, 'POST', '/auth/recover', { code: a.recoveryCode.toLowerCase() });
check(rec.user.id === a.user.id, 'khôi phục tài khoản bằng mã');

const room = await api(a.token, 'POST', '/rooms', { name: 'Smoke room' });
const sa = await connect(a.token);
const sb = await connect(b.token);
const ja = await emitAck<any>(sa, 'join', { room: room.code });
const jb = await emitAck<any>(sb, 'join', { room: room.code.toLowerCase() });
check(ja.ok && jb.ok && jb.players.length === 2, 'hai người cùng mã phòng thấy nhau');

const snaps: any[] = [];
sb.on('snap', (s) => snaps.push(...s));
sa.emit('move', { x: 1.5, z: 2.5, ry: 0.3, a: 1 });
await sleep(300);
check(snaps.some((e) => e[0] === ja.sid && e[1] === 1.5 && e[2] === 2.5), 'B nhận vị trí mới của A');

// Ghế thư viện
sa.emit('move', { x: -27, z: -12.4, ry: 0, a: 1 });
await sleep(150);
const seatEvents: any[] = [];
sb.on('seat', (e) => seatEvents.push(e));
const t1 = await emitAck<any>(sa, 'seat:take', { seatId: 'T1a' });
sb.emit('move', { x: -27, z: -12.4, ry: 0, a: 1 });
await sleep(150);
const t2 = await emitAck<any>(sb, 'seat:take', { seatId: 'T1a' });
check(t1.ok && !t2.ok, 'ghế đã có người thì người khác không ngồi được');
check(seatEvents.some((e) => e.seatId === 'T1a' && e.sid === ja.sid), 'B thấy ghế T1a có người');

// Chat
const chats: any[] = [];
sb.on('chat', (m) => chats.push(m));
sa.emit('chat', { channel: 'global', text: 'Hello everyone' });
await sleep(200);
check(chats.some((m) => m.text === 'Hello everyone'), 'chat kênh chung');

// Ôn tập Part 5
const g5 = await api(a.token, 'GET', '/study/next?part=5');
check(g5.questions.length === 1 && !('answer' in g5.questions[0]), 'ôn Part 5: 1 câu, không lộ đáp án');
const ans = await api(a.token, 'POST', '/study/answer', { questionId: g5.questions[0].id, choice: 'A' });
check(ans.reveal.answer && ans.reveal.explanation && ans.reveal.translation, 'sau khi trả lời có đáp án + giải thích + bản dịch');

// Thi cá nhân Part 7
const paper = await api(a.token, 'POST', '/exam/solo', { parts: [7], room: room.code });
const raw = JSON.stringify(paper);
const qs = paper.groups.flatMap((g: any) => g.questions);
check(qs.length >= 13 && qs.length <= 17, `thi Part 7 có ${qs.length} câu (~15)`);
check(!/"answer"|explanation|translation|passageTranslation|\*/.test(raw), 'đề thi không chứa đáp án/giải thích/dịch/dấu đánh dấu');
const contiguous = paper.groups.every((g: any) => {
  const ns = g.questions.map((q: any) => q.number);
  return ns.every((n: number, i: number) => i === 0 || n === ns[i - 1] + 1);
});
check(contiguous && paper.groups.every((g: any) => g.passages.length), 'câu cùng đoạn văn đi cùng nhau, có đoạn văn');
await api(a.token, 'PUT', `/exam/${paper.attemptId}/answer`, { questionId: qs[0].id, choice: 'B' });
const wait = paper.deadline - paper.serverNow + 4000;
console.log(`  … chờ ${Math.round(wait / 1000)}s để server tự nộp`);
await sleep(wait);
const result = await api(a.token, 'GET', `/exam/${paper.attemptId}`);
check(result.status === 'submitted' && result.autoSubmitted, 'hết giờ server tự nộp');
check(result.answers[qs[0].id] === 'B' && result.reveals[qs[0].id].explanation, 'xem lại: có đáp án đã chọn + giải thích');

// Phòng thi chung
const startAt = Date.now() + 2500;
const shared = await api(a.token, 'POST', `/rooms/${room.code}/shared`, { parts: [5, 6], startAt, title: 'Smoke shared' });
await api(b.token, 'POST', `/rooms/${room.code}/shared/${shared.id}/register`, { on: true });
let early = '';
try {
  await api(b.token, 'POST', `/rooms/${room.code}/shared/${shared.id}/start`);
} catch (e) {
  early = String(e);
}
check(/Chưa đến giờ/.test(early), 'chưa tới giờ thì chưa vào thi được');
await sleep(startAt - Date.now() + 1500); // chừa chỗ cho đồng hồ server lệch (VM của Docker/Rancher)
const pa = await api(a.token, 'POST', `/rooms/${room.code}/shared/${shared.id}/start`);
const pb = await api(b.token, 'POST', `/rooms/${room.code}/shared/${shared.id}/start`);
const ids = (p: any) => p.groups.flatMap((g: any) => g.questions.map((q: any) => q.id)).join();
check(ids(pa) === ids(pb), 'hai người cùng một đề');
await api(a.token, 'POST', `/exam/${pa.attemptId}/submit`, { answers: {} });
await sleep(300);
await api(b.token, 'POST', `/exam/${pb.attemptId}/submit`, { answers: {} });
const lb = await api(b.token, 'GET', `/rooms/${room.code}/shared/${shared.id}/leaderboard`);
check(lb.entries.length === 2 && lb.entries.every((e: any) => e.state === 'submitted'), 'bảng xếp hạng có 2 người đã nộp');

const stats = await api(a.token, 'GET', '/stats');
check(stats.today.answered > 0 && stats.streak >= 1, `thống kê: hôm nay ${stats.today.answered} câu, chuỗi ${stats.streak}`);
const weekly = await api(a.token, 'GET', `/rooms/${room.code}/leaderboard`);
check(weekly.exam.length === 2, 'bảng xếp hạng tuần của phòng');

const f = await api(a.token, 'POST', '/friends', { tag: b.user.tag });
await api(b.token, 'POST', `/friends/${a.user.id}/accept`);
const fl = await api(a.token, 'GET', '/friends');
check(f.status === 'pending' && fl[0]?.status === 'accepted' && fl[0].online, 'kết bạn bằng mã, thấy bạn đang online');

sa.close();
sb.close();
console.log(failures ? `\n${failures} kiểm tra thất bại` : '\nTất cả kiểm tra đều đạt');
process.exit(failures ? 1 : 0);
