import type { QuestionSource } from './types.ts';
import { VaultMarkdownSource } from './vaultMarkdown.ts';

/** Đăng ký nguồn đề. Thêm nguồn mới: viết class implements QuestionSource rồi thêm vào đây. */
export function createSource(name: string, path: string): QuestionSource {
  switch (name) {
    case 'vault-markdown':
      return new VaultMarkdownSource(path);
    default:
      throw new Error(`Nguồn đề không hỗ trợ: ${name}`);
  }
}
