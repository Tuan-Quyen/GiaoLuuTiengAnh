import type { Part, TestBank } from '../../../../shared/bank.ts';

/** Một file media cần copy vào data/media khi import */
export interface MediaCopy {
  from: string;
  /** Đường dẫn tương đối trong data/media */
  to: string;
}

export interface LoadedTest {
  bank: TestBank;
  media: MediaCopy[];
  warnings: string[];
}

/**
 * Lớp nguồn đề. Muốn đổi bộ đề (định dạng khác, API khác...) chỉ cần viết một
 * QuestionSource mới và đăng ký trong sources/index.ts — phần còn lại của app chỉ
 * đọc data/bank/*.json.
 */
export interface QuestionSource {
  readonly name: string;
  listTests(): Promise<string[]>;
  loadTest(testId: string, parts: Part[]): Promise<LoadedTest>;
}
