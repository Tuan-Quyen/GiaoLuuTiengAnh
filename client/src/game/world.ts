// Dựng cảnh tĩnh từ shared/map. Mọi khối hộp cùng vật liệu được gộp thành một InstancedMesh
// → vài chục draw call cho cả map, đủ nhẹ cho điện thoại.
import * as THREE from 'three';
import {
  BOUNDS,
  COUNTER,
  DOOR_HALF,
  EXAM_BOARD,
  EXAM_DESKS,
  LIBRARY_TABLES,
  PLANTS,
  SEATS,
  SOFAS,
  WALL_X,
} from '../../../shared/map.ts';

type BoxSpec = { x: number; y: number; z: number; w: number; h: number; d: number; ry?: number };

class BoxBatcher {
  private specs = new Map<THREE.Material, BoxSpec[]>();
  add(mat: THREE.Material, s: BoxSpec) {
    const list = this.specs.get(mat) ?? [];
    list.push(s);
    this.specs.set(mat, list);
  }
  build(scene: THREE.Scene, shadows: boolean) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [mat, list] of this.specs) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((s, i) => {
        q.setFromAxisAngle(up, s.ry ?? 0);
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.w, s.h, s.d));
        mesh.setMatrixAt(i, m);
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      scene.add(mesh);
    }
  }
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

export interface SeatMarker {
  id: string;
  mesh: THREE.Mesh;
}

export function buildWorld(scene: THREE.Scene, shadows: boolean) {
  const B = new BoxBatcher();
  const M = {
    wall: mat(0xe9e2d4),
    trim: mat(0x8b6a4a),
    wood: mat(0xa8774a),
    woodDark: mat(0x6e4b31),
    chair: mat(0x5b6f8a),
    shelf: mat(0x7a5434),
    sofa: mat(0xc76b4f),
    sofaCushion: mat(0xe08a6d),
    counter: mat(0x3d4a5c),
    counterTop: mat(0xd9c7a7),
    desk: mat(0xc9ced6),
    deskLeg: mat(0x6b7280),
    board: mat(0x2e4a3a),
    pot: mat(0x9c5b3b),
    leaf: mat(0x4f9d5d),
    lamp: mat(0xfff1c9, { emissive: 0xffd27a, emissiveIntensity: 0.6 }),
  };
  const bookColors = [0xb94a48, 0x3e7cb1, 0xe0b04a, 0x4f8a5b, 0x8a5aa6, 0xd9774a].map((c) => mat(c));

  // --- Sàn theo khu ---
  const floor = (x0: number, x1: number, color: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, BOUNDS.maxZ - BOUNDS.minZ), mat(color, { roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0, 0);
    m.receiveShadow = shadows;
    scene.add(m);
  };
  floor(BOUNDS.minX, -WALL_X, 0x9b7653); // thư viện: sàn gỗ
  floor(-WALL_X, WALL_X, 0xcfb79a); // thư giãn: sàn sáng
  floor(WALL_X, BOUNDS.maxX, 0xb9c0c9); // phòng thi: gạch xám
  const rug = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40), mat(0x6c8fb3, { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, -4);
  rug.receiveShadow = shadows;
  scene.add(rug);

  // --- Tường ---
  const WALL_H = 2.6;
  const wall = (x: number, z: number, w: number, d: number) => B.add(M.wall, { x, y: WALL_H / 2, z, w, h: WALL_H, d });
  wall(0, BOUNDS.minZ - 0.25, 64.5, 0.5);
  wall(BOUNDS.minX - 0.25, 0, 0.5, 36.5);
  wall(BOUNDS.maxX + 0.25, 0, 0.5, 36.5);
  // tường trước thấp để camera nhìn qua được
  B.add(M.wall, { x: 0, y: 0.3, z: BOUNDS.maxZ + 0.25, w: 64.5, h: 0.6, d: 0.5 });
  for (const x of [-WALL_X, WALL_X]) {
    const len = BOUNDS.maxZ - DOOR_HALF;
    wall(x, (BOUNDS.minZ - DOOR_HALF) / 2, 0.4, len);
    B.add(M.wall, { x, y: 0.5, z: (BOUNDS.maxZ + DOOR_HALF) / 2, w: 0.4, h: 1, d: len }); // nửa trước thấp
    B.add(M.trim, { x, y: WALL_H + 0.05, z: (BOUNDS.minZ - DOOR_HALF) / 2, w: 0.5, h: 0.1, d: len });
  }

  // --- Thư viện ---
  for (const t of LIBRARY_TABLES) {
    B.add(M.wood, { x: t.x, y: 0.74, z: t.z, w: t.w, h: 0.06, d: t.d });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(M.woodDark, { x: t.x + sx * (t.w / 2 - 0.1), y: 0.37, z: t.z + sz * (t.d / 2 - 0.1), w: 0.07, h: 0.74, d: 0.07 });
    // đèn bàn
    B.add(M.woodDark, { x: t.x + t.w / 2 - 0.25, y: 0.95, z: t.z, w: 0.04, h: 0.4, d: 0.04 });
    B.add(M.lamp, { x: t.x + t.w / 2 - 0.25, y: 1.17, z: t.z, w: 0.22, h: 0.1, d: 0.22 });
    // sách trên bàn
    B.add(bookColors[(t.x * 7 + t.z * 3) & 3] ?? bookColors[0], { x: t.x - 0.5, y: 0.8, z: t.z, w: 0.3, h: 0.06, d: 0.22, ry: 0.3 });
  }
  for (const s of SEATS) {
    const back = s.ry === 0 ? -1 : 1; // lưng ghế nằm phía xa bàn
    B.add(M.chair, { x: s.x, y: 0.45, z: s.z, w: 0.5, h: 0.06, d: 0.5 });
    B.add(M.chair, { x: s.x, y: 0.75, z: s.z + back * 0.24, w: 0.5, h: 0.55, d: 0.05 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(M.woodDark, { x: s.x + sx * 0.2, y: 0.22, z: s.z + sz * 0.2, w: 0.04, h: 0.44, d: 0.04 });
  }
  const shelf = (x: number, z: number, w: number, d: number, alongX: boolean) => {
    B.add(M.shelf, { x, y: 1.1, z, w, h: 2.2, d });
    const len = alongX ? w : d;
    // sách nhô ra mặt trước kệ (phía trong phòng: +z với kệ tường sau, +x với kệ tường trái)
    const front = alongX ? d / 2 - 0.12 : w / 2 - 0.12;
    for (let level = 0; level < 4; level++) {
      let p = -len / 2 + 0.1;
      let k = Math.floor(Math.abs(x * 3 + z * 5 + level * 7));
      while (p < len / 2 - 0.15) {
        const bw = 0.08 + ((k * 37) % 7) * 0.012;
        const bh = 0.32 + ((k * 13) % 5) * 0.03;
        const y = 0.25 + level * 0.52 + bh / 2;
        const book = bookColors[k % bookColors.length];
        if (alongX) B.add(book, { x: x + p + bw / 2, y, z: z + front, w: bw, h: bh, d: 0.25 });
        else B.add(book, { x: x + front, y, z: z + p + bw / 2, w: 0.25, h: bh, d: bw });
        p += bw + 0.01;
        k++;
      }
    }
  };
  shelf(-31.4, -6, 0.8, 18, false);
  for (const x of [-27, -21.5, -16]) shelf(x, -17.4, 4, 0.8, true);

  // --- Khu thư giãn ---
  for (const s of SOFAS) {
    const side = Math.abs(s.ry) > 0.1;
    const [w, d] = side ? [0.9, 2.4] : [2.4, 0.9];
    B.add(M.sofa, { x: s.x, y: 0.25, z: s.z, w, h: 0.5, d });
    B.add(M.sofaCushion, { x: s.x, y: 0.55, z: s.z, w: w - 0.1, h: 0.12, d: d - 0.1 });
    const bx = side ? s.x + (s.x > 0 ? 0.35 : -0.35) : s.x;
    const bz = side ? s.z : s.z - 0.35;
    B.add(M.sofa, { x: bx, y: 0.8, z: bz, w: side ? 0.2 : w, h: 0.6, d: side ? d : 0.2 });
  }
  B.add(M.wood, { x: 0, y: 0.4, z: -4, w: 1.6, h: 0.08, d: 0.9 }); // bàn trà
  B.add(M.woodDark, { x: 0, y: 0.2, z: -4, w: 1.2, h: 0.4, d: 0.5 });
  B.add(M.counter, { x: COUNTER.x, y: 0.5, z: COUNTER.z, w: COUNTER.w, h: 1, d: COUNTER.d });
  B.add(M.counterTop, { x: COUNTER.x, y: 1.03, z: COUNTER.z, w: COUNTER.w + 0.1, h: 0.06, d: COUNTER.d + 0.1 });
  for (let i = -3; i <= 3; i += 2) B.add(M.lamp, { x: i, y: 1.12, z: COUNTER.z, w: 0.14, h: 0.14, d: 0.14 }); // cốc

  // --- Phòng thi ---
  for (const d of EXAM_DESKS) {
    B.add(M.desk, { x: d.x, y: 0.72, z: d.z, w: 1.4, h: 0.05, d: 0.8 });
    for (const sx of [-1, 1]) B.add(M.deskLeg, { x: d.x + sx * 0.62, y: 0.36, z: d.z, w: 0.05, h: 0.72, d: 0.7 });
    B.add(M.chair, { x: d.x - 0.9, y: 0.45, z: d.z, w: 0.45, h: 0.05, d: 0.45 });
    B.add(M.chair, { x: d.x - 1.1, y: 0.72, z: d.z, w: 0.05, h: 0.5, d: 0.45 });
  }
  B.add(M.board, { x: EXAM_BOARD.x, y: 1.5, z: EXAM_BOARD.z, w: 0.15, h: 1.8, d: 5 });
  B.add(M.trim, { x: EXAM_BOARD.x, y: 0.5, z: EXAM_BOARD.z, w: 0.6, h: 1, d: 5 });

  // --- Cây ---
  for (const p of PLANTS) {
    B.add(M.pot, { x: p.x, y: 0.25, z: p.z, w: 0.55, h: 0.5, d: 0.55 });
    B.add(M.leaf, { x: p.x, y: 0.95, z: p.z, w: 0.75, h: 0.9, d: 0.75, ry: 0.6 });
    B.add(M.leaf, { x: p.x, y: 1.35, z: p.z, w: 0.5, h: 0.6, d: 0.5, ry: 0.2 });
  }

  B.build(scene, shadows);

  // --- Biển tên khu & bảng thi ---
  scene.add(textPlane('THƯ VIỆN', -WALL_X - 0.25, 2.2, 0, Math.PI / 2 * -1, 0xf4b860));
  scene.add(textPlane('KHU THƯ GIÃN', -WALL_X + 0.25, 2.2, 0, Math.PI / 2, 0xf4b860));
  scene.add(textPlane('KHU THƯ GIÃN', WALL_X - 0.25, 2.2, 0, -Math.PI / 2, 0xf4b860));
  scene.add(textPlane('PHÒNG THI', WALL_X + 0.25, 2.2, 0, Math.PI / 2, 0xf4b860));
  scene.add(textPlane('PHÒNG THI\nTOEIC Reading', EXAM_BOARD.x - 0.09, 1.6, EXAM_BOARD.z, -Math.PI / 2, 0xffffff, 4.4, 1.5));
  scene.add(textPlane('Quầy cà phê', COUNTER.x, 1.6, COUNTER.z - 0.62, Math.PI, 0xffffff, 2.6, 0.5));

  // --- Đèn báo ghế: xanh = trống, cam = có người ---
  const seatGeo = new THREE.RingGeometry(0.22, 0.32, 24);
  seatGeo.rotateX(-Math.PI / 2);
  const free = new THREE.MeshBasicMaterial({ color: 0x5fd08a, transparent: true, opacity: 0.85 });
  const taken = new THREE.MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.0 });
  const markers = new Map<string, THREE.Mesh>();
  for (const s of SEATS) {
    const m = new THREE.Mesh(seatGeo, free);
    const out = s.ry === 0 ? -0.75 : 0.75;
    m.position.set(s.x, 0.02, s.z + out);
    scene.add(m);
    markers.set(s.id, m);
  }
  const setSeatTaken = (id: string, isTaken: boolean) => {
    const m = markers.get(id);
    if (m) m.material = isTaken ? taken : free;
  };

  return { setSeatTaken };
}

function textPlane(text: string, x: number, y: number, z: number, ry: number, color: number, w = 3.2, hgt = 0.7) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * hgt) / w);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(30,36,51,0.92)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  const lines = text.split('\n');
  const size = Math.min(canvas.height / (lines.length + 0.6), 64);
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, (canvas.height / (lines.length + 1)) * (i + 1)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
