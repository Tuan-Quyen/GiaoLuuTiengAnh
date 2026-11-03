// Thi: đề được chọn & chấm ở server. Client chỉ nhận PublicGroup (không đáp án) tới khi nộp.
// Hết giờ: client tự nộp; server cũng có timer tự nộp phòng khi client mất kết nối.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Choice, Part, PublicGroup } from '../../shared/bank.ts';
import { bank, examDurationMs } from './bank/bank.ts';
import { dayKey, db } from './db.ts';

export const examEvents = new EventEmitter();
const GRACE_MS = 3000;
const CHOICES = new Set(['A', 'B', 'C', 'D']);

interface AttemptRow {
  id: string;
  user_id: string;
  room_code: string | null;
  shared_id: string | null;
  parts: string;
  question_ids: string;
  answers: string;
  started_at: number;
  deadline: number;
  submitted_at: number | null;
  auto_submitted: number;
  score: number | null;
  total: number;
}

interface SharedRow {
  id: string;
  room_code: string;
  title: string;
  parts: string;
  question_ids: string;
  start_at: number;
  duration_ms: number;
  created_by: string;
  created_at: number;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function cleanParts(parts: unknown): Part[] {
  const avail = new Set(bank.availableParts());
  const list = Array.isArray(parts) ? [...new Set(parts.map(Number))].filter((p) => avail.has(p as Part)) : [];
  if (!list.length) throw new HttpError(400, 'Chọn ít nhất một Part');
  return (list as Part[]).sort();
}

function pickQuestionIds(parts: Part[]) {
  const groups = bank.pickExam(parts);
  return groups.flatMap((g) => bank.groupQuestionIds(g.id));
}

const getAttempt = (id: string) => db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(id) as AttemptRow | undefined;
const getShared = (id: string) => db.prepare('SELECT * FROM shared_exams WHERE id = ?').get(id) as SharedRow | undefined;

/** Ghép các câu của bài thi lại theo nhóm đoạn văn, giữ thứ tự */
export function paperGroups(questionIds: string[]): PublicGroup[] {
  const ids = new Set(questionIds);
  const out: PublicGroup[] = [];
  const seen = new Set<string>();
  for (const qid of questionIds) {
    const q = bank.questions.get(qid);
    if (!q || seen.has(q.groupId)) continue;
    seen.add(q.groupId);
    out.push(bank.publicGroup(q.groupId, ids));
  }
  return out;
}

function createAttempt(opts: {
  userId: string;
  roomCode: string | null;
  sharedId: string | null;
  parts: Part[];
  questionIds: string[];
  startedAt: number;
  deadline: number;
}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO exam_attempts (id, user_id, room_code, shared_id, parts, question_ids, started_at, deadline, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.userId,
    opts.roomCode,
    opts.sharedId,
    JSON.stringify(opts.parts),
    JSON.stringify(opts.questionIds),
    opts.startedAt,
    opts.deadline,
    opts.questionIds.length,
  );
  scheduleAutoSubmit(id, opts.deadline);
  return getAttempt(id)!;
}

function attemptPayload(a: AttemptRow) {
  const qids = JSON.parse(a.question_ids) as string[];
  return {
    attemptId: a.id,
    sharedId: a.shared_id,
    parts: JSON.parse(a.parts) as Part[],
    startedAt: a.started_at,
    deadline: a.deadline,
    serverNow: Date.now(),
    total: a.total,
    answers: JSON.parse(a.answers) as Record<string, Choice>,
    groups: paperGroups(qids),
  };
}

export function startSolo(userId: string, roomCode: string | null, partsIn: unknown) {
  const parts = cleanParts(partsIn);
  const questionIds = pickQuestionIds(parts);
  const now = Date.now();
  const duration = examDurationMs(questionIds.map((id) => bank.questions.get(id)!));
  return attemptPayload(createAttempt({ userId, roomCode, sharedId: null, parts, questionIds, startedAt: now, deadline: now + duration }));
}

function ownedAttempt(id: string, userId: string) {
  const a = getAttempt(id);
  if (!a || a.user_id !== userId) throw new HttpError(404, 'Không tìm thấy bài thi');
  return a;
}

export function saveAnswer(id: string, userId: string, questionId: string, choice: unknown) {
  const a = ownedAttempt(id, userId);
  if (a.submitted_at) throw new HttpError(409, 'Bài đã nộp');
  if (Date.now() > a.deadline + GRACE_MS) throw new HttpError(409, 'Đã hết giờ');
  const qids = JSON.parse(a.question_ids) as string[];
  if (!qids.includes(questionId)) throw new HttpError(400, 'Câu hỏi không thuộc bài thi');
  const answers = JSON.parse(a.answers) as Record<string, string>;
  if (choice === null) delete answers[questionId];
  else if (typeof choice === 'string' && CHOICES.has(choice)) answers[questionId] = choice;
  else throw new HttpError(400, 'Đáp án không hợp lệ');
  db.prepare('UPDATE exam_attempts SET answers = ? WHERE id = ?').run(JSON.stringify(answers), id);
  return { ok: true };
}

/** Chấm bài. answers (nếu có) được gộp vào bản đã lưu, chỉ khi còn trong thời gian cho phép. */
export function submit(id: string, userId: string | null, answersIn?: Record<string, unknown>, auto = false) {
  const a = userId ? ownedAttempt(id, userId) : getAttempt(id);
  if (!a) throw new HttpError(404, 'Không tìm thấy bài thi');
  if (a.submitted_at) return review(a.id, a.user_id);
  const now = Date.now();
  const qids = JSON.parse(a.question_ids) as string[];
  const answers = JSON.parse(a.answers) as Record<string, string>;
  if (answersIn && now <= a.deadline + GRACE_MS) {
    for (const [qid, c] of Object.entries(answersIn))
      if (qids.includes(qid) && typeof c === 'string' && CHOICES.has(c)) answers[qid] = c;
  }
  const day = dayKey(now);
  let score = 0;
  const log = db.prepare('INSERT INTO answer_log (user_id, question_id, part, correct, mode, day, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const qid of qids) {
    const q = bank.questions.get(qid);
    if (!q) continue;
    const ok = answers[qid] === q.answer;
    if (ok) score++;
    log.run(a.user_id, qid, q.part, ok ? 1 : 0, 'exam', day, now);
  }
  const submittedAt = Math.min(now, a.deadline);
  db.prepare('UPDATE exam_attempts SET answers = ?, submitted_at = ?, score = ?, auto_submitted = ? WHERE id = ?').run(
    JSON.stringify(answers),
    submittedAt,
    score,
    auto ? 1 : 0,
    id,
  );
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (a.shared_id) examEvents.emit('shared-changed', a.room_code, a.shared_id);
  return review(id, a.user_id);
}

/** Bài đang làm → đề + đáp án đã chọn. Bài đã nộp → kết quả đầy đủ kèm giải thích. */
export function review(id: string, userId: string) {
  const a = ownedAttempt(id, userId);
  if (!a.submitted_at) return { status: 'in_progress' as const, ...attemptPayload(a) };
  const qids = JSON.parse(a.question_ids) as string[];
  const answers = JSON.parse(a.answers) as Record<string, Choice>;
  const groups = paperGroups(qids).map((g) => ({
    ...g,
    passageTranslation: bank.groups.get(g.id)?.passageTranslation,
  }));
  return {
    status: 'submitted' as const,
    attemptId: a.id,
    sharedId: a.shared_id,
    parts: JSON.parse(a.parts) as Part[],
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    deadline: a.deadline,
    autoSubmitted: Boolean(a.auto_submitted),
    score: a.score ?? 0,
    total: a.total,
    answers,
    groups,
    reveals: Object.fromEntries(qids.map((qid) => [qid, bank.reveal(qid)])),
  };
}

export function history(userId: string) {
  const attempts = db
    .prepare(
      `SELECT a.id, a.parts, a.score, a.total, a.started_at, a.submitted_at, a.auto_submitted, a.shared_id, s.title
       FROM exam_attempts a LEFT JOIN shared_exams s ON s.id = a.shared_id
       WHERE a.user_id = ? AND a.submitted_at IS NOT NULL ORDER BY a.started_at DESC LIMIT 50`,
    )
    .all(userId);
  const byPart = db
    .prepare(
      `SELECT part, COUNT(*) AS answered, SUM(correct) AS correct FROM answer_log
       WHERE user_id = ? AND mode = 'exam' GROUP BY part ORDER BY part`,
    )
    .all(userId);
  const active = db
    .prepare('SELECT id, shared_id, deadline FROM exam_attempts WHERE user_id = ? AND submitted_at IS NULL AND deadline > ?')
    .all(userId, Date.now());
  return { attempts, byPart, active };
}

// ---------------- Phòng thi chung ----------------

export function createShared(roomCode: string, userId: string, body: { title?: unknown; parts?: unknown; startAt?: unknown }) {
  const parts = cleanParts(body.parts);
  const startAt = Number(body.startAt);
  const now = Date.now();
  if (!Number.isFinite(startAt) || startAt < now - 60_000) throw new HttpError(400, 'Giờ bắt đầu phải ở tương lai');
  if (startAt > now + 30 * 86_400_000) throw new HttpError(400, 'Chỉ hẹn tối đa 30 ngày');
  const title = (typeof body.title === 'string' ? body.title.trim().slice(0, 60) : '') || `Thi chung Part ${parts.join('+')}`;
  const questionIds = pickQuestionIds(parts);
  const duration = examDurationMs(questionIds.map((id) => bank.questions.get(id)!));
  const id = randomUUID();
  db.prepare(
    `INSERT INTO shared_exams (id, room_code, title, parts, question_ids, start_at, duration_ms, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, roomCode, title, JSON.stringify(parts), JSON.stringify(questionIds), Math.max(startAt, now), duration, userId, now);
  db.prepare('INSERT INTO shared_exam_regs (exam_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now);
  scheduleShared(getShared(id)!);
  examEvents.emit('shared-changed', roomCode, id);
  return sharedSummary(getShared(id)!, userId);
}

function sharedStatus(s: SharedRow, now = Date.now()) {
  if (now < s.start_at) return 'upcoming' as const;
  if (now < s.start_at + s.duration_ms) return 'live' as const;
  return 'done' as const;
}

function sharedSummary(s: SharedRow, userId: string) {
  const regs = db.prepare('SELECT COUNT(*) AS n FROM shared_exam_regs WHERE exam_id = ?').get(s.id) as { n: number };
  const me = db.prepare('SELECT 1 FROM shared_exam_regs WHERE exam_id = ? AND user_id = ?').get(s.id, userId);
  const mine = db.prepare('SELECT id, submitted_at FROM exam_attempts WHERE shared_id = ? AND user_id = ?').get(s.id, userId) as
    | { id: string; submitted_at: number | null }
    | undefined;
  const creator = db.prepare('SELECT name FROM users WHERE id = ?').get(s.created_by) as { name: string } | undefined;
  return {
    id: s.id,
    title: s.title,
    parts: JSON.parse(s.parts) as Part[],
    total: (JSON.parse(s.question_ids) as string[]).length,
    startAt: s.start_at,
    durationMs: s.duration_ms,
    status: sharedStatus(s),
    registered: Boolean(me),
    registrations: regs.n,
    createdBy: creator?.name ?? '?',
    myAttemptId: mine?.id ?? null,
    mySubmitted: Boolean(mine?.submitted_at),
  };
}

export function listShared(roomCode: string, userId: string) {
  const rows = db
    .prepare('SELECT * FROM shared_exams WHERE room_code = ? AND start_at > ? ORDER BY start_at DESC LIMIT 30')
    .all(roomCode, Date.now() - 7 * 86_400_000) as unknown as SharedRow[];
  return rows.map((r) => sharedSummary(r, userId));
}

function sharedInRoom(id: string, roomCode: string) {
  const s = getShared(id);
  if (!s || s.room_code !== roomCode) throw new HttpError(404, 'Không tìm thấy phòng thi chung');
  return s;
}

export function register(id: string, roomCode: string, userId: string, on: boolean) {
  const s = sharedInRoom(id, roomCode);
  if (sharedStatus(s) !== 'upcoming') throw new HttpError(409, 'Chỉ đăng ký/huỷ trước giờ thi');
  if (on) db.prepare('INSERT OR IGNORE INTO shared_exam_regs (exam_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, Date.now());
  else db.prepare('DELETE FROM shared_exam_regs WHERE exam_id = ? AND user_id = ?').run(id, userId);
  examEvents.emit('shared-changed', roomCode, id);
  return sharedSummary(s, userId);
}

export function startShared(id: string, roomCode: string, userId: string) {
  const s = sharedInRoom(id, roomCode);
  const existing = db.prepare('SELECT id FROM exam_attempts WHERE shared_id = ? AND user_id = ?').get(id, userId) as { id: string } | undefined;
  if (existing) return review(existing.id, userId);
  const status = sharedStatus(s);
  if (status === 'upcoming') throw new HttpError(409, 'Chưa đến giờ thi');
  if (status === 'done') throw new HttpError(409, 'Phòng thi đã kết thúc');
  if (!db.prepare('SELECT 1 FROM shared_exam_regs WHERE exam_id = ? AND user_id = ?').get(id, userId))
    throw new HttpError(403, 'Bạn chưa đăng ký phòng thi này');
  const a = createAttempt({
    userId,
    roomCode,
    sharedId: id,
    parts: JSON.parse(s.parts),
    questionIds: JSON.parse(s.question_ids),
    startedAt: s.start_at,
    deadline: s.start_at + s.duration_ms,
  });
  examEvents.emit('shared-changed', roomCode, id);
  return { status: 'in_progress' as const, ...attemptPayload(a) };
}

/** Bảng xếp hạng: điểm cao trước, cùng điểm thì ai nộp nhanh hơn đứng trên */
export function sharedLeaderboard(id: string, roomCode: string, userId: string) {
  const s = sharedInRoom(id, roomCode);
  const rows = db
    .prepare(
      `SELECT u.id AS userId, u.name, a.id AS attemptId, a.score, a.total, a.submitted_at, a.auto_submitted
       FROM shared_exam_regs r JOIN users u ON u.id = r.user_id
       LEFT JOIN exam_attempts a ON a.shared_id = r.exam_id AND a.user_id = r.user_id
       WHERE r.exam_id = ?`,
    )
    .all(id) as { userId: string; name: string; attemptId: string | null; score: number | null; total: number | null; submitted_at: number | null; auto_submitted: number }[];
  const status = sharedStatus(s);
  const entries = rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    state: r.submitted_at ? 'submitted' : r.attemptId ? 'doing' : status === 'done' ? 'absent' : 'waiting',
    score: r.submitted_at ? r.score : null,
    durationMs: r.submitted_at ? r.submitted_at - s.start_at : null,
    autoSubmitted: Boolean(r.auto_submitted),
  }));
  const rank = { submitted: 0, doing: 1, waiting: 2, absent: 3 } as const;
  entries.sort(
    (a, b) =>
      rank[a.state as keyof typeof rank] - rank[b.state as keyof typeof rank] ||
      (b.score ?? -1) - (a.score ?? -1) ||
      (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
  return { exam: sharedSummary(s, userId), entries };
}

// ---------------- Hẹn giờ ----------------

const timers = new Map<string, NodeJS.Timeout>();
const MAX_TIMEOUT = 2 ** 31 - 1;

function scheduleAutoSubmit(id: string, deadline: number) {
  clearTimeout(timers.get(id));
  const delay = deadline + GRACE_MS - Date.now();
  if (delay > MAX_TIMEOUT) return; // không xảy ra với thời lượng bài thi
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const a = getAttempt(id);
      if (a && !a.submitted_at) submit(id, null, undefined, true);
    }, Math.max(0, delay)),
  );
}

const sharedTimers = new Map<string, NodeJS.Timeout[]>();
function scheduleShared(s: SharedRow) {
  for (const t of sharedTimers.get(s.id) ?? []) clearTimeout(t);
  const ts: NodeJS.Timeout[] = [];
  const now = Date.now();
  for (const at of [s.start_at, s.start_at + s.duration_ms + GRACE_MS + 500]) {
    if (at > now && at - now < MAX_TIMEOUT) ts.push(setTimeout(() => examEvents.emit('shared-changed', s.room_code, s.id), at - now));
  }
  sharedTimers.set(s.id, ts);
}

/** Khởi động server: nộp các bài đã quá hạn, hẹn giờ lại các bài/phòng thi còn chạy */
export function restoreTimers() {
  const open = db.prepare('SELECT id, deadline FROM exam_attempts WHERE submitted_at IS NULL').all() as { id: string; deadline: number }[];
  for (const a of open) scheduleAutoSubmit(a.id, a.deadline);
  const shared = db.prepare('SELECT * FROM shared_exams WHERE start_at + duration_ms > ?').all(Date.now() - GRACE_MS) as unknown as SharedRow[];
  for (const s of shared) scheduleShared(s);
}
