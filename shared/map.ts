// Bố cục map dùng chung: client dựng cảnh + va chạm, server xác định khu và kiểm tra ghế.
// Đơn vị: mét. Mặt phẳng XZ, nhân vật quay mặt theo vector (sin ry, cos ry).

export type Zone = 'library' | 'lounge' | 'exam';

export const ZONE_LABEL: Record<Zone, string> = {
  library: 'Thư viện',
  lounge: 'Khu thư giãn',
  exam: 'Phòng thi',
};

export const BOUNDS = { minX: -32, maxX: 32, minZ: -18, maxZ: 18 };
export const WALL_X = 11; // tường ngăn ở x = ±11
export const DOOR_HALF = 3; // cửa rộng 6m ở giữa tường ngăn
export const SPAWN = { x: 0, z: 4 };

export function zoneAt(x: number): Zone {
  if (x < -WALL_X) return 'library';
  if (x > WALL_X) return 'exam';
  return 'lounge';
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: 'wall' | 'table' | 'shelf' | 'sofa' | 'counter' | 'desk' | 'board' | 'plant';
}

export interface Seat {
  id: string;
  x: number;
  z: number;
  ry: number;
  tableId: string;
}

export interface Table {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

const box = (cx: number, cz: number, w: number, d: number, kind: Box['kind']): Box => ({
  minX: cx - w / 2,
  maxX: cx + w / 2,
  minZ: cz - d / 2,
  maxZ: cz + d / 2,
  kind,
});

// --- Thư viện: 3 cột × 4 hàng bàn đôi = 24 ghế ---
export const LIBRARY_TABLES: Table[] = [];
export const SEATS: Seat[] = [];
{
  const cols = [-27, -21.5, -16];
  const rows = [-11, -4.5, 2, 8.5];
  let n = 0;
  for (const z of rows)
    for (const x of cols) {
      const id = `T${++n}`;
      LIBRARY_TABLES.push({ id, x, z, w: 2.2, d: 1.3 });
      SEATS.push({ id: `${id}a`, x, z: z - 1.05, ry: 0, tableId: id });
      SEATS.push({ id: `${id}b`, x, z: z + 1.05, ry: Math.PI, tableId: id });
    }
}
export const SEAT_BY_ID = new Map(SEATS.map((s) => [s.id, s]));
export const SEAT_REACH = 2.2;

// --- Phòng thi: bàn thi trang trí + bảng thi ---
export const EXAM_DESKS: { x: number; z: number }[] = [];
for (const x of [16, 20, 24])
  for (const z of [-10, -6, -2, 2, 6]) EXAM_DESKS.push({ x, z });
export const EXAM_BOARD = { x: 30.6, z: 0 };

// --- Khu thư giãn ---
export const SOFAS = [
  { x: -4, z: -7, ry: 0 },
  { x: 4, z: -7, ry: 0 },
  { x: -7, z: -3.5, ry: Math.PI / 2 },
  { x: 7, z: -3.5, ry: -Math.PI / 2 },
];
export const COUNTER = { x: 0, z: 14.5, w: 8, d: 1.2 };
export const PLANTS = [
  { x: -9.5, z: -16 },
  { x: 9.5, z: -16 },
  { x: -9.5, z: 16 },
  { x: 9.5, z: 16 },
  { x: -12.5, z: -16.5 },
  { x: 12.5, z: 16.5 },
];

export const COLLIDERS: Box[] = [
  // tường bao
  box(0, BOUNDS.minZ - 0.25, 64.5, 0.5, 'wall'),
  box(0, BOUNDS.maxZ + 0.25, 64.5, 0.5, 'wall'),
  box(BOUNDS.minX - 0.25, 0, 0.5, 36.5, 'wall'),
  box(BOUNDS.maxX + 0.25, 0, 0.5, 36.5, 'wall'),
  // tường ngăn có cửa
  ...[-WALL_X, WALL_X].flatMap((x) => [
    box(x, (BOUNDS.minZ - DOOR_HALF) / 2, 0.4, BOUNDS.maxZ - DOOR_HALF, 'wall'),
    box(x, (BOUNDS.maxZ + DOOR_HALF) / 2, 0.4, BOUNDS.maxZ - DOOR_HALF, 'wall'),
  ]),
  ...LIBRARY_TABLES.map((t) => box(t.x, t.z, t.w, t.d, 'table')),
  // kệ sách dọc tường trái + tường sau
  box(-31.4, -6, 0.8, 18, 'shelf'),
  ...[-27, -21.5, -16].map((x) => box(x, -17.4, 4, 0.8, 'shelf')),
  ...SOFAS.map((s) => (Math.abs(s.ry) > 0.1 ? box(s.x, s.z, 0.9, 2.4, 'sofa') : box(s.x, s.z, 2.4, 0.9, 'sofa'))),
  box(COUNTER.x, COUNTER.z, COUNTER.w, COUNTER.d, 'counter'),
  ...PLANTS.map((p) => box(p.x, p.z, 0.7, 0.7, 'plant')),
  ...EXAM_DESKS.map((d) => box(d.x, d.z, 1.4, 0.8, 'desk')),
  box(EXAM_BOARD.x, EXAM_BOARD.z, 0.6, 5, 'board'),
];

export const PLAYER_RADIUS = 0.35;

/** Đẩy vị trí ra khỏi các hộp va chạm (hình tròn vs AABB). */
export function resolveCollision(x: number, z: number, r = PLAYER_RADIUS): [number, number] {
  for (let iter = 0; iter < 2; iter++) {
    for (const b of COLLIDERS) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // tâm nằm trong hộp: đẩy ra cạnh gần nhất
        const pushes = [b.minX - r - x, b.maxX + r - x, b.minZ - r - z, b.maxZ + r - z];
        const i = pushes.reduce((bi, v, k) => (Math.abs(v) < Math.abs(pushes[bi]) ? k : bi), 0);
        if (i < 2) x += pushes[i];
        else z += pushes[i];
      }
    }
  }
  return [
    Math.max(BOUNDS.minX + r, Math.min(BOUNDS.maxX - r, x)),
    Math.max(BOUNDS.minZ + r, Math.min(BOUNDS.maxZ - r, z)),
  ];
}
