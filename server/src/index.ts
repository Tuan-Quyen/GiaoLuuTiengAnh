import './env.ts';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import { Server } from 'socket.io';
import {
  cleanAvatar,
  cleanName,
  getUser,
  logout,
  newRoomCode,
  normalizeRoomCode,
  recover,
  register,
  requireUser,
  rotateRecovery,
} from './auth.ts';
import { bank, watchBank } from './bank/bank.ts';
import { db } from './db.ts';
import * as exam from './exam.ts';
import { HttpError } from './exam.ts';
import { CLIENT_DIST, MEDIA_DIR } from './paths.ts';
import { onlineCount, setupRealtime, whereIs, activeRoomCodes } from './realtime.ts';
import * as social from './social.ts';

const app = express();
app.disable('x-powered-by');
// gzip cả model .glb (~2.3MB → ~1MB), quan trọng khi vào bằng điện thoại
app.use(compression({ filter: (req, res) => /\.glb$/.test(req.path) || compression.filter(req, res) }));
app.use(express.json({ limit: '64kb' }));

type Handler = (req: Request, res: Response) => unknown;
/** Bọc handler: trả JSON, chuyển HttpError thành mã lỗi */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message });
    else next(e);
  }
};

/** Kiểm tra người dùng là thành viên phòng (nhóm kín: chỉ ai có mã phòng mới vào được) */
function roomOf(req: Request) {
  const code = normalizeRoomCode(req.params.code);
  const room = db.prepare('SELECT code, name FROM rooms WHERE code = ?').get(code) as { code: string; name: string } | undefined;
  if (!room) throw new HttpError(404, 'Mã phòng không tồn tại');
  db.prepare('INSERT OR IGNORE INTO room_members (room_code, user_id, joined_at) VALUES (?, ?, ?)').run(code, req.user!.id, Date.now());
  return room;
}

const api = express.Router();

api.get('/config', h(() => ({
  iceServers: process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : [{ urls: 'stun:stun.l.google.com:19302' }],
  parts: bank.availableParts(),
  tests: [...bank.tests.values()].map((t) => ({ id: t.id, title: t.title, questions: t.questions.length })),
})));

// --- Tài khoản ---
api.post('/auth/register', h((req) => {
  const name = cleanName(req.body?.name);
  if (!name) throw new HttpError(400, 'Tên hiển thị cần 2–24 ký tự');
  return register(name, cleanAvatar(req.body?.avatar));
}));
api.post('/auth/recover', h((req) => {
  const r = recover(String(req.body?.code ?? ''));
  if (!r) throw new HttpError(404, 'Mã khôi phục không đúng');
  return r;
}));
api.use(requireUser);
api.post('/auth/logout', h((req) => (logout(req.token!), { ok: true })));
api.get('/me', h((req) => req.user));
api.patch('/me', h((req) => {
  const name = req.body?.name !== undefined ? cleanName(req.body.name) : req.user!.name;
  if (!name) throw new HttpError(400, 'Tên hiển thị cần 2–24 ký tự');
  const avatar = req.body?.avatar !== undefined ? cleanAvatar(req.body.avatar) : req.user!.avatar;
  db.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?').run(name, avatar, req.user!.id);
  return getUser(req.user!.id);
}));
api.post('/me/recovery', h((req) => ({ recoveryCode: rotateRecovery(req.user!.id) })));

// --- Phòng ---
api.post('/rooms', h((req) => {
  const name = (typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 40) : '') || `Phòng của ${req.user!.name}`;
  const code = newRoomCode();
  db.prepare('INSERT INTO rooms (code, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(code, name, req.user!.id, Date.now());
  db.prepare('INSERT INTO room_members (room_code, user_id, joined_at) VALUES (?, ?, ?)').run(code, req.user!.id, Date.now());
  return { code, name };
}));
api.get('/rooms', h((req) => {
  const memberRooms = db
    .prepare(
      `SELECT r.code, r.name FROM room_members m JOIN rooms r ON r.code = m.room_code
       WHERE m.user_id = ? ORDER BY m.joined_at DESC LIMIT 20`,
    )
    .all(req.user!.id) as { code: string; name: string }[];

  const activeCodes = activeRoomCodes();
  const activeRooms = activeCodes.length
    ? (db.prepare(`SELECT code, name FROM rooms WHERE code IN (${activeCodes.map(() => '?').join(',')})`).all(...activeCodes) as { code: string; name: string }[])
    : [];

  const seen = new Set<string>();
  const list: { code: string; name: string; online: number }[] = [];
  for (const r of [...activeRooms, ...memberRooms]) {
    if (!seen.has(r.code)) {
      seen.add(r.code);
      list.push({ ...r, online: onlineCount(r.code) });
    }
  }
  return list;
}));
api.get('/rooms/:code', h((req) => roomOf(req)));

// --- Ôn tập (thư viện) ---
api.get('/study/next', h((req) => social.nextStudyGroup(req.user!.id, req.query.part)));
api.post('/study/answer', h((req) => social.answerStudy(req.user!.id, req.body?.questionId, req.body?.choice)));

// --- Thi cá nhân ---
api.post('/exam/solo', h((req) => exam.startSolo(req.user!.id, normalizeRoomCode(req.body?.room) || null, req.body?.parts)));
api.get('/exam/history', h((req) => exam.history(req.user!.id)));
api.get('/exam/:id', h((req) => exam.review(String(req.params.id), req.user!.id)));
api.put('/exam/:id/answer', h((req) => exam.saveAnswer(String(req.params.id), req.user!.id, String(req.body?.questionId), req.body?.choice)));
api.post('/exam/:id/submit', h((req) => exam.submit(String(req.params.id), req.user!.id, req.body?.answers ?? undefined, Boolean(req.body?.auto))));

// --- Phòng thi chung ---
api.get('/rooms/:code/shared', h((req) => exam.listShared(roomOf(req).code, req.user!.id)));
api.post('/rooms/:code/shared', h((req) => exam.createShared(roomOf(req).code, req.user!.id, req.body ?? {})));
api.post('/rooms/:code/shared/:id/register', h((req) => exam.register(String(req.params.id), roomOf(req).code, req.user!.id, req.body?.on !== false)));
api.post('/rooms/:code/shared/:id/start', h((req) => exam.startShared(String(req.params.id), roomOf(req).code, req.user!.id)));
api.get('/rooms/:code/shared/:id/leaderboard', h((req) => exam.sharedLeaderboard(String(req.params.id), roomOf(req).code, req.user!.id)));

// --- Thống kê, xếp hạng, bạn bè ---
api.get('/stats', h((req) => social.stats(req.user!.id)));
api.get('/rooms/:code/leaderboard', h((req) => social.weeklyLeaderboard(roomOf(req).code, req.user!.id, String(req.query.scope ?? 'room'))));
api.get('/friends', h((req) => social.listFriends(req.user!.id, whereIs)));
api.post('/friends', h((req) => social.addFriend(req.user!.id, req.body?.tag)));
api.post('/friends/:id/accept', h((req) => social.acceptFriend(req.user!.id, String(req.params.id))));
api.delete('/friends/:id', h((req) => social.removeFriend(req.user!.id, String(req.params.id))));

app.use('/api', api);
app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', immutable: true }));

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|media|socket\.io).*/, (_req, res) => res.sendFile(join(CLIENT_DIST, 'index.html')));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' });
});

// TLS_CERT + TLS_KEY → HTTPS (bắt buộc để trình duyệt cho dùng micro khi mở bằng IP LAN)
const { TLS_CERT, TLS_KEY } = process.env;
const tls = Boolean(TLS_CERT && TLS_KEY);
const server = tls ? createHttpsServer({ cert: readFileSync(TLS_CERT!), key: readFileSync(TLS_KEY!) }, app) : createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 10_000, pingTimeout: 8_000 });
setupRealtime(io);
exam.restoreTimers();
watchBank();

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`TOEIC 3D server: ${tls ? 'https' : 'http'}://${HOST}:${PORT}  (đề: ${bank.tests.size} bộ, ${bank.questions.size} câu)`);
  if (!bank.tests.size) console.log('⚠ Chưa có dữ liệu đề — chạy: npm run import');
});
