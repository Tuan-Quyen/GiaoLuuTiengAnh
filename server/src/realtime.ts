// Trạng thái real-time của từng phòng (trong bộ nhớ) + Socket.IO.
// Vị trí: client gửi tối đa 10 lần/giây, server gom và phát "snap" 10 lần/giây
// chỉ cho người đã đổi vị trí → băng thông tuyến tính theo số người di chuyển.
import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { BOUNDS, SEAT_BY_ID, SEAT_REACH, SPAWN, zoneAt, type Zone } from '../../shared/map.ts';
import {
  NET_HZ,
  type Anim,
  type ChatChannel,
  type ChatMessage,
  type Emote,
  type JoinResult,
  type PlayerInfo,
  type SnapEntry,
} from '../../shared/protocol.ts';
import { userFromToken, normalizeRoomCode, type User } from './auth.ts';
import { db } from './db.ts';
import { examEvents } from './exam.ts';
import { addStudySeconds } from './social.ts';

interface Player extends PlayerInfo {
  socket: Socket;
  dirty: boolean;
  lastChat: number;
  seatSince: number | null;
}

interface RoomState {
  code: string;
  name: string;
  epoch: number;
  players: Map<string, Player>;
  seats: Map<string, string>; // seatId -> sid
  chat: ChatMessage[];
}

const rooms = new Map<string, RoomState>();
const CHAT_KEEP = 80;
const MAX_ROOM = 40;
const EMOTES = new Set<Emote>(['nod', 'wave', 'cheer']);

function loadRoom(code: string): RoomState | undefined {
  const existing = rooms.get(code);
  if (existing) return existing;
  const row = db.prepare('SELECT code, name, created_at FROM rooms WHERE code = ?').get(code) as
    | { code: string; name: string; created_at: number }
    | undefined;
  if (!row) return;
  const st: RoomState = { code, name: row.name, epoch: row.created_at, players: new Map(), seats: new Map(), chat: [] };
  rooms.set(code, st);
  return st;
}

const info = (p: Player): PlayerInfo => ({
  sid: p.sid,
  userId: p.userId,
  name: p.name,
  avatar: p.avatar,
  x: p.x,
  z: p.z,
  ry: p.ry,
  a: p.a,
  zone: p.zone,
  seat: p.seat,
  mic: p.mic,
});

const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

/** Ai đang online ở đâu (cho danh sách bạn bè) */
export function whereIs(userId: string): { room: string; zone: string } | undefined {
  for (const r of rooms.values())
    for (const p of r.players.values()) if (p.userId === userId) return { room: r.code, zone: p.zone };
}

export function onlineCount(code: string) {
  const r = rooms.get(code);
  return r ? new Set([...r.players.values()].map((p) => p.userId)).size : 0;
}

export function setupRealtime(io: Server) {
  io.use((socket, next) => {
    const user = userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as User;
    let room: RoomState | undefined;
    let me: Player | undefined;

    const leaveSeat = () => {
      if (!room || !me?.seat) return;
      flushStudy(me);
      room.seats.delete(me.seat);
      io.to(room.code).emit('seat', { seatId: me.seat, sid: null });
      me.seat = null;
      me.seatSince = null;
    };

    socket.on('join', (payload: { room?: string }, ack: (r: JoinResult) => void) => {
      if (typeof ack !== 'function' || room) return;
      const code = normalizeRoomCode(payload?.room);
      const r = loadRoom(code);
      if (!r) return ack({ ok: false, error: 'Mã phòng không tồn tại' });
      if (r.players.size >= MAX_ROOM) return ack({ ok: false, error: 'Phòng đã đầy' });

      // Cùng tài khoản mở tab khác → đá tab cũ để không có 2 nhân vật
      for (const p of r.players.values()) if (p.userId === user.id) p.socket.emit('kicked', 'Bạn đã vào phòng ở tab/thiết bị khác'), p.socket.disconnect(true);

      db.prepare('INSERT OR IGNORE INTO room_members (room_code, user_id, joined_at) VALUES (?, ?, ?)').run(code, user.id, Date.now());
      const fresh = db.prepare('SELECT name, avatar FROM users WHERE id = ?').get(user.id) as { name: string; avatar: PlayerInfo['avatar'] };
      room = r;
      me = {
        sid: socket.id,
        userId: user.id,
        name: fresh.name,
        avatar: fresh.avatar,
        x: SPAWN.x + (Math.random() - 0.5) * 4,
        z: SPAWN.z + (Math.random() - 0.5) * 3,
        ry: Math.PI,
        a: 0,
        zone: 'lounge',
        seat: null,
        mic: false,
        socket,
        dirty: false,
        lastChat: 0,
        seatSince: null,
      };
      r.players.set(socket.id, me);
      socket.join(code);
      socket.to(code).emit('player:join', info(me));
      ack({
        ok: true,
        sid: socket.id,
        room: { code: r.code, name: r.name, epoch: r.epoch },
        serverNow: Date.now(),
        players: [...r.players.values()].map(info),
        seats: Object.fromEntries(r.seats),
        chat: r.chat.filter((m) => m.channel === 'global' || m.zone === me!.zone),
      });
    });

    socket.on('move', (m: { x?: number; z?: number; ry?: number; a?: number }) => {
      if (!me || !room) return;
      const x = num(m?.x, BOUNDS.minX, BOUNDS.maxX);
      const z = num(m?.z, BOUNDS.minZ, BOUNDS.maxZ);
      const ry = num(m?.ry, -100, 100);
      if (x === null || z === null || ry === null) return;
      if (me.seat) return; // đang ngồi thì đứng yên
      me.x = x;
      me.z = z;
      me.ry = ry;
      me.a = ([0, 1, 2].includes(m.a as number) ? m.a : 0) as Anim;
      me.dirty = true;
      const zone = zoneAt(x);
      if (zone !== me.zone) {
        me.zone = zone;
        io.to(room.code).emit('player:zone', { sid: me.sid, zone });
      }
    });

    socket.on('seat:take', (p: { seatId?: string }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!me || !room) return;
      const seat = SEAT_BY_ID.get(String(p?.seatId));
      if (!seat) return reply({ ok: false, error: 'Ghế không tồn tại' });
      if (room.seats.has(seat.id)) return reply({ ok: false, error: 'Ghế đã có người ngồi' });
      if (Math.hypot(me.x - seat.x, me.z - seat.z) > SEAT_REACH + 0.5) return reply({ ok: false, error: 'Lại gần ghế hơn' });
      leaveSeat();
      room.seats.set(seat.id, me.sid);
      Object.assign(me, { seat: seat.id, seatSince: Date.now(), x: seat.x, z: seat.z, ry: seat.ry, a: 3 as Anim, dirty: true });
      io.to(room.code).emit('seat', { seatId: seat.id, sid: me.sid });
      reply({ ok: true });
    });

    socket.on('seat:leave', () => {
      if (!me) return;
      leaveSeat();
      me.a = 0;
      me.dirty = true;
    });

    socket.on('emote', (type: Emote) => {
      if (!me || !room || !EMOTES.has(type)) return;
      io.to(room.code).emit('emote', { sid: me.sid, type });
    });

    socket.on('chat', (p: { channel?: ChatChannel; text?: string }) => {
      if (!me || !room) return;
      const now = Date.now();
      if (now - me.lastChat < 400) return;
      const text = String(p?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!text) return;
      me.lastChat = now;
      const channel: ChatChannel = p?.channel === 'zone' ? 'zone' : 'global';
      const msg: ChatMessage = { id: randomUUID(), channel, zone: channel === 'zone' ? me.zone : undefined, userId: me.userId, name: me.name, text, at: now };
      room.chat.push(msg);
      if (room.chat.length > CHAT_KEEP) room.chat.shift();
      if (channel === 'global') io.to(room.code).emit('chat', msg);
      else for (const pl of room.players.values()) if (pl.zone === me.zone) pl.socket.emit('chat', msg);
    });

    socket.on('mic', (on: boolean) => {
      if (!me || !room) return;
      me.mic = Boolean(on);
      io.to(room.code).emit('mic', { sid: me.sid, on: me.mic });
    });

    // Tín hiệu WebRTC: chỉ chuyển tiếp trong cùng phòng
    socket.on('rtc', (p: { to?: string; data?: unknown }) => {
      if (!me || !room || typeof p?.to !== 'string' || !room.players.has(p.to)) return;
      room.players.get(p.to)!.socket.emit('rtc', { from: me.sid, data: p.data });
    });

    socket.on('profile', () => {
      // tên/nhân vật vừa đổi qua REST → báo cho cả phòng
      if (!me || !room) return;
      const fresh = db.prepare('SELECT name, avatar FROM users WHERE id = ?').get(me.userId) as { name: string; avatar: PlayerInfo['avatar'] };
      Object.assign(me, fresh);
      io.to(room.code).emit('player:update', info(me));
    });

    socket.on('disconnect', () => {
      if (!room || !me) return;
      leaveSeat();
      room.players.delete(socket.id);
      io.to(room.code).emit('player:leave', { sid: socket.id });
      if (!room.players.size) setTimeout(() => room && !room.players.size && rooms.delete(room.code), 60_000);
    });
  });

  // Gom vị trí và phát định kỳ
  setInterval(() => {
    for (const r of rooms.values()) {
      const snap: SnapEntry[] = [];
      for (const p of r.players.values()) {
        if (!p.dirty) continue;
        p.dirty = false;
        snap.push([p.sid, round2(p.x), round2(p.z), round2(p.ry), p.a]);
      }
      if (snap.length) io.to(r.code).volatile.emit('snap', snap);
    }
  }, 1000 / NET_HZ);

  // Cộng dồn giờ học mỗi 30 giây cho người đang ngồi bàn thư viện
  setInterval(() => {
    for (const r of rooms.values()) for (const p of r.players.values()) if (p.seat) flushStudy(p);
  }, 30_000);

  examEvents.on('shared-changed', (roomCode: string | null, examId: string) => {
    if (roomCode) io.to(roomCode).emit('shared:changed', { examId });
  });
}

function flushStudy(p: Player) {
  if (!p.seatSince) return;
  const now = Date.now();
  addStudySeconds(p.userId, (now - p.seatSince) / 1000, now);
  p.seatSince = now;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type { Zone };
