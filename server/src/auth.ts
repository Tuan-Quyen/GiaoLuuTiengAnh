// Tài khoản không mật khẩu: tên hiển thị + mã khôi phục (giống ngoike).
// Mã khôi phục 80 bit ngẫu nhiên nên lưu SHA-256 là đủ (không cần hash chậm).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AVATARS, type Avatar } from '../../shared/protocol.ts';
import { db } from './db.ts';

export interface User {
  id: string;
  name: string;
  tag: string;
  avatar: Avatar;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I, O, 0, 1 cho dễ đọc
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function randomCode(len: number) {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export const newRecoveryCode = () => randomCode(16).replace(/(.{4})(?=.)/g, '$1-');
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 24);
  return n.length >= 2 ? n : null;
}

export const cleanAvatar = (a: unknown): Avatar => (AVATARS.includes(a as Avatar) ? (a as Avatar) : 'Knight');

function issueToken(userId: string) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now());
  return token;
}

export function register(name: string, avatar: Avatar) {
  const id = randomUUID();
  const recoveryCode = newRecoveryCode();
  let tag = randomCode(5);
  while (db.prepare('SELECT 1 FROM users WHERE tag = ?').get(tag)) tag = randomCode(5);
  db.prepare('INSERT INTO users (id, name, tag, avatar, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    name,
    tag,
    avatar,
    sha(normalizeCode(recoveryCode)),
    Date.now(),
  );
  return { token: issueToken(id), recoveryCode, user: getUser(id)! };
}

export function recover(code: string) {
  const row = db.prepare('SELECT id FROM users WHERE recovery_hash = ?').get(sha(normalizeCode(code))) as { id: string } | undefined;
  if (!row) return null;
  return { token: issueToken(row.id), user: getUser(row.id)! };
}

export function rotateRecovery(userId: string) {
  const recoveryCode = newRecoveryCode();
  db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(sha(normalizeCode(recoveryCode)), userId);
  return recoveryCode;
}

export function getUser(id: string): User | undefined {
  return db.prepare('SELECT id, name, tag, avatar FROM users WHERE id = ?').get(id) as User | undefined;
}

export function userFromToken(token: string | undefined): User | undefined {
  if (!token) return;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(sha(token)) as { user_id: string } | undefined;
  return row ? getUser(row.user_id) : undefined;
}

export function logout(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    token?: string;
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = user;
  req.token = token;
  next();
}

export const newRoomCode = () => {
  let code = randomCode(6);
  while (db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)) code = randomCode(6);
  return code;
};
export const normalizeRoomCode = (c: unknown) => (typeof c === 'string' ? c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '');
