// Nạp .env ở gốc repo (nếu có). Phải import đầu tiên, trước mọi module đọc process.env.
// Biến đã đặt sẵn trong shell được ưu tiên; giá trị rỗng trong .env = dùng mặc định trong code.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const file = resolve(import.meta.dirname, '../../.env');
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (value !== '' && process.env[key] === undefined) process.env[key] = value;
  }
}
