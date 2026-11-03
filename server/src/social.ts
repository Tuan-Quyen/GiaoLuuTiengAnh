// Ôn tập, thống kê, bảng xếp hạng tuần, bạn bè.
import type { Part } from '../../shared/bank.ts';
import { bank } from './bank/bank.ts';
import { addDays, dayKey, dayStartMs, db, weekStart } from './db.ts';
import { HttpError } from './exam.ts';

// ---------------- Ôn tập ----------------

/** Nhớ câu đã trả lời trong lượt ôn hiện tại để biết khi nào lộ bản dịch đoạn văn */
const studyAnswered = new Map<string, Set<string>>();
const studyRecent = new Map<string, string[]>();

export function nextStudyGroup(userId: string, part: unknown) {
  const p = Number(part) as Part;
  if (!bank.availableParts().includes(p)) throw new HttpError(400, 'Part không hợp lệ');
  const recent = studyRecent.get(userId) ?? [];
  const g = bank.randomGroup(p, new Set(recent));
  if (!g) throw new HttpError(404, 'Chưa có câu hỏi cho Part này — hãy chạy import');
  recent.push(g.id);
  studyRecent.set(userId, recent.slice(-200));
  studyAnswered.set(userId, new Set());
  return bank.publicGroup(g.id);
}

export function answerStudy(userId: string, questionId: unknown, choice: unknown) {
  const q = typeof questionId === 'string' ? bank.questions.get(questionId) : undefined;
  if (!q) throw new HttpError(404, 'Không có câu hỏi');
  if (typeof choice !== 'string' || !'ABCD'.includes(choice) || choice.length !== 1) throw new HttpError(400, 'Đáp án không hợp lệ');
  const answered = studyAnswered.get(userId) ?? new Set();
  const first = !answered.has(q.id);
  answered.add(q.id);
  studyAnswered.set(userId, answered);
  const correct = choice === q.answer;
  if (first)
    db.prepare('INSERT INTO answer_log (user_id, question_id, part, correct, mode, day, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      userId,
      q.id,
      q.part,
      correct ? 1 : 0,
      'study',
      dayKey(),
      Date.now(),
    );
  const groupDone = bank.groupQuestionIds(q.groupId).every((id) => answered.has(id));
  return {
    correct,
    reveal: bank.reveal(q.id),
    passageTranslation: groupDone ? bank.groups.get(q.groupId)?.passageTranslation ?? null : null,
  };
}

export function addStudySeconds(userId: string, seconds: number, at = Date.now()) {
  if (seconds <= 0) return;
  db.prepare(
    `INSERT INTO study_daily (user_id, day, seconds) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`,
  ).run(userId, dayKey(at), Math.round(seconds));
}

// ---------------- Thống kê ----------------

export function stats(userId: string) {
  const today = dayKey();
  const secs = db.prepare('SELECT day, seconds FROM study_daily WHERE user_id = ?').all(userId) as { day: string; seconds: number }[];
  const ans = db
    .prepare('SELECT day, COUNT(*) AS answered, SUM(correct) AS correct FROM answer_log WHERE user_id = ? GROUP BY day')
    .all(userId) as { day: string; answered: number; correct: number }[];
  const days = new Map<string, { seconds: number; answered: number; correct: number }>();
  const get = (d: string) => days.get(d) ?? (days.set(d, { seconds: 0, answered: 0, correct: 0 }), days.get(d)!);
  for (const r of secs) get(r.day).seconds += r.seconds;
  for (const r of ans) Object.assign(get(r.day), { answered: r.answered, correct: r.correct });

  // Ngày "có học": ≥ 5 phút ngồi học hoặc ≥ 1 câu
  const active = (d: string) => {
    const v = days.get(d);
    return Boolean(v && (v.seconds >= 300 || v.answered > 0));
  };
  let streak = 0;
  let d = active(today) ? today : addDays(today, -1);
  while (active(d)) {
    streak++;
    d = addDays(d, -1);
  }
  const total = [...days.values()].reduce(
    (s, v) => ({ seconds: s.seconds + v.seconds, answered: s.answered + v.answered, correct: s.correct + v.correct }),
    { seconds: 0, answered: 0, correct: 0 },
  );
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return { day, ...(days.get(day) ?? { seconds: 0, answered: 0, correct: 0 }) };
  });
  const byPart = db
    .prepare('SELECT part, mode, COUNT(*) AS answered, SUM(correct) AS correct FROM answer_log WHERE user_id = ? GROUP BY part, mode')
    .all(userId);
  return { today: days.get(today) ?? { seconds: 0, answered: 0, correct: 0 }, streak, total, last7, byPart };
}

// ---------------- Bảng xếp hạng tuần ----------------

export function weeklyLeaderboard(roomCode: string, userId: string, scope: string) {
  const start = weekStart();
  const members =
    scope === 'friends'
      ? [userId, ...friendIds(userId)]
      : (db.prepare('SELECT user_id FROM room_members WHERE room_code = ?').all(roomCode) as { user_id: string }[]).map((r) => r.user_id);
  if (!members.length) return { weekStart: start, study: [], exam: [] };
  const ph = members.map(() => '?').join(',');
  const study = db
    .prepare(
      `SELECT u.id AS userId, u.name, COALESCE(SUM(s.seconds), 0) AS seconds
       FROM users u LEFT JOIN study_daily s ON s.user_id = u.id AND s.day >= ?
       WHERE u.id IN (${ph}) GROUP BY u.id ORDER BY seconds DESC, u.name LIMIT 50`,
    )
    .all(start, ...members);
  // Điểm thi tuần = tổng số câu đúng trong các bài thi đã nộp tuần này
  const weekStartMs = dayStartMs(start);
  const exam = db
    .prepare(
      `SELECT u.id AS userId, u.name, COALESCE(SUM(a.score), 0) AS points, COUNT(a.id) AS exams,
              COALESCE(SUM(a.total), 0) AS questions
       FROM users u LEFT JOIN exam_attempts a ON a.user_id = u.id AND a.submitted_at IS NOT NULL AND a.started_at >= ?
       WHERE u.id IN (${ph}) GROUP BY u.id ORDER BY points DESC, questions ASC, u.name LIMIT 50`,
    )
    .all(weekStartMs, ...members);
  return { weekStart: start, study, exam };
}

// ---------------- Bạn bè ----------------

function friendIds(userId: string) {
  return (
    db
      .prepare(
        `SELECT friend_id AS id FROM friends WHERE user_id = ? AND status = 'accepted'
         UNION SELECT user_id AS id FROM friends WHERE friend_id = ? AND status = 'accepted'`,
      )
      .all(userId, userId) as { id: string }[]
  ).map((r) => r.id);
}

export function listFriends(userId: string, online: (userId: string) => { room: string; zone: string } | undefined) {
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.tag, u.avatar, f.status, CASE WHEN f.user_id = ? THEN 'out' ELSE 'in' END AS dir
       FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
       WHERE f.user_id = ? OR f.friend_id = ?`,
    )
    .all(userId, userId, userId, userId) as { id: string; name: string; tag: string; avatar: string; status: string; dir: string }[];
  return rows.map((r) => ({ ...r, online: r.status === 'accepted' ? online(r.id) ?? null : null }));
}

export function addFriend(userId: string, tagIn: unknown) {
  const tag = typeof tagIn === 'string' ? tagIn.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const target = db.prepare('SELECT id, name FROM users WHERE tag = ?').get(tag) as { id: string; name: string } | undefined;
  if (!target) throw new HttpError(404, 'Không tìm thấy mã bạn bè này');
  if (target.id === userId) throw new HttpError(400, 'Đây là mã của chính bạn');
  const reverse = db.prepare('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(target.id, userId) as
    | { status: string }
    | undefined;
  if (reverse) {
    // Người kia đã gửi lời mời trước → chấp nhận luôn
    db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(target.id, userId);
    return { status: 'accepted', name: target.name };
  }
  db.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(
    userId,
    target.id,
    Date.now(),
  );
  return { status: 'pending', name: target.name };
}

export function acceptFriend(userId: string, fromId: string) {
  const r = db.prepare("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'").run(fromId, userId);
  if (!r.changes) throw new HttpError(404, 'Không có lời mời');
  return { ok: true };
}

export function removeFriend(userId: string, otherId: string) {
  db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(userId, otherId, otherId, userId);
  return { ok: true };
}
