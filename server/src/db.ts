import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './paths.ts';

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, user_id)
);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'pending' (user_id gửi cho friend_id) | 'accepted'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS study_daily (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS answer_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  mode TEXT NOT NULL, -- 'study' | 'exam'
  day TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_log_user_day ON answer_log(user_id, day);
CREATE TABLE IF NOT EXISTS shared_exams (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  title TEXT NOT NULL,
  parts TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shared_exam_regs (
  exam_id TEXT NOT NULL REFERENCES shared_exams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (exam_id, user_id)
);
CREATE TABLE IF NOT EXISTS exam_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_code TEXT,
  shared_id TEXT REFERENCES shared_exams(id) ON DELETE CASCADE,
  parts TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  submitted_at INTEGER,
  auto_submitted INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  total INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exam_attempts_user ON exam_attempts(user_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_shared ON exam_attempts(shared_id, user_id) WHERE shared_id IS NOT NULL;
`);

export const TZ = process.env.APP_TZ ?? 'Asia/Ho_Chi_Minh';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD theo múi giờ app */
export function dayKey(ms = Date.now()) {
  return dayFmt.format(new Date(ms));
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Thứ Hai của tuần chứa ngày `day` */
export function weekStart(day = dayKey()) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = CN
  return addDays(day, -((dow + 6) % 7));
}

/** Thời điểm 00:00 của ngày `day` theo múi giờ app (ms) */
export function dayStartMs(day: string) {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  const asLocal = (ms: number) => Date.parse(new Date(ms).toLocaleString('en-US', { timeZone: TZ }) + ' UTC');
  return utcMidnight - (asLocal(utcMidnight) - utcMidnight);
}
