// Kiểu dữ liệu ngân hàng đề, dùng chung server + client.
// Part 1–4 (Listening) chưa import nhưng kiểu đã chừa sẵn (audio trên Group).

export type Part = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Choice = 'A' | 'B' | 'C' | 'D';
export const READING_PARTS: Part[] = [5, 6, 7];

export interface Passage {
  kind: 'image' | 'text';
  /** URL ảnh (kind=image), ví dụ /media/ETS_2026_Test_1/part7_q147-148.png */
  src?: string;
  /** Văn bản gốc tiếng Anh (kind=text) */
  text?: string;
  caption?: string;
}

export interface Group {
  id: string;
  testId: string;
  part: Part;
  /** Số câu thuộc nhóm, theo thứ tự trong đề */
  numbers: number[];
  passages: Passage[];
  /** Bản dịch đoạn văn (markdown) — có thể chứa đáp án, chỉ gửi sau khi trả lời */
  passageTranslation?: string;
  /** Dành cho Listening sau này */
  audio?: string;
}

export interface Question {
  id: string;
  testId: string;
  groupId: string;
  part: Part;
  number: number;
  stem?: string;
  options: { key: Choice; text: string }[];
  answer: Choice;
  /** Ghi chú ngắn trong file đề chính */
  note?: string;
  /** Giải thích chi tiết (markdown) */
  explanation?: string;
  /** Bản dịch câu hỏi + phương án (markdown) */
  translation?: string;
}

export interface TestBank {
  id: string;
  title: string;
  source: string;
  importedAt: string;
  groups: Group[];
  questions: Question[];
}

/** Phần câu hỏi an toàn gửi cho client trước khi nộp (không có đáp án/giải thích/dịch) */
export interface PublicQuestion {
  id: string;
  number: number;
  part: Part;
  stem?: string;
  options: { key: Choice; text: string }[];
}

export interface PublicGroup {
  id: string;
  testId: string;
  testTitle: string;
  part: Part;
  passages: Passage[];
  questions: PublicQuestion[];
}

/** Phần lộ ra sau khi trả lời / nộp bài */
export interface Reveal {
  id: string;
  answer: Choice;
  note?: string;
  explanation?: string;
  translation?: string;
}
