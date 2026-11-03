// Giả lập nhiều người chơi để thử tải: npm run bots -- <MÃ_PHÒNG> [số bot=28] [giây=60]
// Mỗi bot đi ngẫu nhiên trong khu thư giãn, gửi vị trí 10 lần/giây như client thật.
import '../server/src/env.ts';
import { io } from 'socket.io-client';
import { AVATARS } from '../shared/protocol.ts';
import { resolveCollision } from '../shared/map.ts';

const BASE = process.env.BASE ?? `http://localhost:${process.env.PORT ?? 3001}`;
const [room, nArg, secArg] = process.argv.slice(2);
if (!room) {
  console.error('Cách dùng: npm run bots -- <MÃ_PHÒNG> [số bot] [giây]');
  process.exit(1);
}
const N = Number(nArg ?? 28);
const SECONDS = Number(secArg ?? 60);

let received = 0;
let bytes = 0;
const bots = await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Bot ${i + 1}`, avatar: AVATARS[i % AVATARS.length] }),
    });
    const { token } = await res.json();
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    await new Promise<void>((r) => s.on('connect', () => r()));
    const join: any = await new Promise((r) => s.emit('join', { room }, r));
    if (!join.ok) throw new Error(join.error);
    s.on('snap', (snap: unknown[]) => {
      received++;
      bytes += JSON.stringify(snap).length;
    });
    return { s, x: (Math.random() - 0.5) * 18, z: (Math.random() - 0.5) * 24, dir: Math.random() * Math.PI * 2 };
  }),
);
console.log(`${N} bot đã vào phòng ${room}`);

const started = Date.now();
const iv = setInterval(() => {
  for (const b of bots) {
    if (Math.random() < 0.05) b.dir += (Math.random() - 0.5) * 2;
    const nx = b.x + Math.sin(b.dir) * 0.3;
    const nz = b.z + Math.cos(b.dir) * 0.3;
    [b.x, b.z] = resolveCollision(Math.max(-10, Math.min(10, nx)), nz);
    if (Math.abs(b.x) >= 9.9) b.dir += Math.PI;
    b.s.emit('move', { x: b.x, z: b.z, ry: b.dir, a: 1 });
  }
}, 100);

const report = setInterval(() => {
  const secs = (Date.now() - started) / 1000;
  console.log(`${secs.toFixed(0)}s · mỗi bot nhận ~${(received / N / secs).toFixed(1)} snap/s · ~${(bytes / N / secs / 1024).toFixed(1)} KB/s`);
}, 5000);

setTimeout(() => {
  clearInterval(iv);
  clearInterval(report);
  for (const b of bots) b.s.close();
  process.exit(0);
}, SECONDS * 1000);
