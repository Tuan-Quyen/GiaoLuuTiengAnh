// Import đề từ nguồn vào data/bank/*.json + data/media/.
//   npm run import                              # đọc TOEIC_VAULT hoặc đường dẫn mặc định
//   npm run import -- --path /đường/dẫn/TOEIC   # chỉ định thư mục vault
//   npm run import -- --only ETS_2026_Test_1    # import 1 đề
import '../env.ts';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { READING_PARTS, type Part } from '../../../shared/bank.ts';
import { BANK_DIR, MEDIA_DIR } from '../paths.ts';
import { createSource } from './sources/index.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const sourceName = arg('source') ?? 'vault-markdown';
const path = arg('path') ?? process.env.TOEIC_VAULT ?? '/Users/ctquyen/Documents/project/self-project/core/private-storage/TOEIC';
const only = arg('only');
const parts = (arg('parts')?.split(',').map(Number) as Part[] | undefined) ?? READING_PARTS;
const strict = args.includes('--strict');

const source = createSource(sourceName, path);
const ids = only ? [only] : await source.listTests();
await mkdir(BANK_DIR, { recursive: true });
if (!only) {
  // xoá file bên trong (giữ thư mục để server đang chạy vẫn theo dõi được)
  for (const f of await readdir(BANK_DIR)) if (f.endsWith('.json')) await rm(join(BANK_DIR, f));
  await rm(MEDIA_DIR, { recursive: true, force: true });
}

let totalWarnings = 0;
for (const id of ids) {
  const { bank, media, warnings } = await source.loadTest(id, parts);
  for (const m of media) {
    const to = join(MEDIA_DIR, m.to);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(m.from, to);
  }
  await writeFile(join(BANK_DIR, `${id}.json`), JSON.stringify(bank));
  const byPart = parts.map((p) => `P${p}=${bank.questions.filter((q) => q.part === p).length}`).join(' ');
  const groups = bank.groups.filter((g) => g.numbers.length > 1).length;
  console.log(`✓ ${id.padEnd(18)} ${byPart}  nhóm đoạn văn=${groups}  ảnh=${media.length}  cảnh báo=${warnings.length}`);
  for (const w of warnings) console.log(`   ⚠ ${w}`);
  totalWarnings += warnings.length;
}
console.log(`\nXong: ${ids.length} đề → ${BANK_DIR}. Tổng cảnh báo: ${totalWarnings}`);
if (strict && totalWarnings) process.exit(1);
