import * as THREE from 'three';
import type { Socket } from 'socket.io-client';
import { SEATS, SEAT_BY_ID, SEAT_REACH, resolveCollision, zoneAt, type Seat, type Zone } from '../../../shared/map.ts';
import { NET_HZ, type Anim, type Emote, type PlayerInfo, type SnapEntry } from '../../../shared/protocol.ts';
import { isTouch } from '../dom.ts';
import { Avatar } from './avatar.ts';
import { Input, isTyping } from './input.ts';
import { buildWorld } from './world.ts';

interface Remote {
  info: PlayerInfo;
  avatar: Avatar;
  tx: number;
  tz: number;
  try_: number;
}

export interface GameEvents {
  zone(z: Zone): void;
  seat(seatId: string | null): void;
  players(count: number): void;
  nearSeat(seat: Seat | null): void;
}

const WALK = 3;
const RUN = 5.5;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  input: Input;
  me: PlayerInfo;
  private self: Avatar;
  remotes = new Map<string, Remote>();
  seats = new Map<string, string>(); // seatId -> sid
  private world: ReturnType<typeof buildWorld>;
  private clock = new THREE.Clock();
  private lastSent = 0;
  private sentState = '';
  private nearSeat: Seat | null = null;
  private camTarget = new THREE.Vector3();
  private shadows: boolean;

  constructor(canvas: HTMLCanvasElement, private socket: Socket, me: PlayerInfo, players: PlayerInfo[], seats: Record<string, string>, private ev: GameEvents) {
    const mobile = isTouch();
    this.shadows = !mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x1d2433);
    this.scene.fog = new THREE.Fog(0x1d2433, 35, 70);

    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404a5c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(10, 22, 12);
    if (this.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 20, bottom: -20, near: 1, far: 60 });
      sun.shadow.bias = -0.0005;
    }
    this.scene.add(sun);

    this.world = buildWorld(this.scene, this.shadows);
    this.input = new Input(canvas);

    this.me = me;
    this.self = new Avatar(me.avatar, me.name, this.shadows, true);
    this.self.root.position.set(me.x, 0, me.z);
    this.self.root.rotation.y = me.ry;
    this.scene.add(this.self.root);
    this.input.camYaw = me.ry + Math.PI;
    if (innerHeight > innerWidth) this.input.camDist = 12; // màn hình dọc: lùi camera để thấy rộng hơn

    for (const p of players) if (p.sid !== me.sid) this.addRemote(p);
    for (const [seatId, sid] of Object.entries(seats)) this.setSeat(seatId, sid);
    this.bindNet();

    addEventListener('resize', () => this.resize());
    this.resize();
    this.ev.players(this.onlineCount());
    this.ev.zone(me.zone);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private bindNet() {
    const s = this.socket;
    s.on('player:join', (p: PlayerInfo) => {
      this.addRemote(p);
      this.ev.players(this.onlineCount());
    });
    s.on('player:leave', ({ sid }: { sid: string }) => {
      this.remotes.get(sid)?.avatar.dispose();
      this.remotes.delete(sid);
      this.ev.players(this.onlineCount());
    });
    s.on('player:update', (p: PlayerInfo) => {
      const r = this.remotes.get(p.sid);
      if (r) {
        r.avatar.dispose();
        this.remotes.delete(p.sid);
        this.addRemote(p);
      } else if (p.sid === this.me.sid) {
        this.self.setName(p.name);
      }
    });
    s.on('player:zone', ({ sid, zone }: { sid: string; zone: Zone }) => {
      const r = this.remotes.get(sid);
      if (r) r.info.zone = zone;
    });
    s.on('snap', (snap: SnapEntry[]) => {
      for (const [sid, x, z, ry, a] of snap) {
        const r = this.remotes.get(sid);
        if (!r) continue;
        r.tx = x;
        r.tz = z;
        r.try_ = ry;
        r.info.x = x;
        r.info.z = z;
        r.info.a = a;
        r.info.zone = zoneAt(x);
        r.avatar.setAnim(a);
      }
    });
    s.on('seat', ({ seatId, sid }: { seatId: string; sid: string | null }) => this.setSeat(seatId, sid));
    s.on('emote', ({ sid, type }: { sid: string; type: Emote }) => {
      if (sid === this.me.sid) this.self.emote(type);
      else this.remotes.get(sid)?.avatar.emote(type);
    });
    s.on('mic', ({ sid, on }: { sid: string; on: boolean }) => {
      if (sid === this.me.sid) this.self.setMic(on);
      const r = this.remotes.get(sid);
      if (r) {
        r.info.mic = on;
        r.avatar.setMic(on);
      }
    });
  }

  private addRemote(p: PlayerInfo) {
    if (p.sid === this.me.sid || this.remotes.has(p.sid)) return;
    const avatar = new Avatar(p.avatar, p.name, this.shadows);
    avatar.root.position.set(p.x, 0, p.z);
    avatar.root.rotation.y = p.ry;
    avatar.setAnim(p.a);
    avatar.setMic(p.mic);
    this.scene.add(avatar.root);
    this.remotes.set(p.sid, { info: { ...p }, avatar, tx: p.x, tz: p.z, try_: p.ry });
  }

  private setSeat(seatId: string, sid: string | null) {
    if (sid) this.seats.set(seatId, sid);
    else this.seats.delete(seatId);
    this.world.setSeatTaken(seatId, Boolean(sid));
    const r = sid ? this.remotes.get(sid) : undefined;
    const seat = SEAT_BY_ID.get(seatId);
    if (r && seat) {
      r.tx = seat.x;
      r.tz = seat.z;
      r.try_ = seat.ry;
      r.info.seat = seatId;
    }
    if (sid === this.me.sid || (!sid && this.me.seat === seatId)) {
      this.me.seat = sid ? seatId : null;
      if (sid && seat) {
        this.me.x = seat.x;
        this.me.z = seat.z;
        this.me.ry = seat.ry;
        this.me.a = 3;
        this.input.camYaw = seat.ry + Math.PI;
      } else {
        // đứng dậy ra phía ngoài ghế
        const s = SEAT_BY_ID.get(seatId)!;
        const out = s.ry === 0 ? -0.7 : 0.7;
        [this.me.x, this.me.z] = resolveCollision(s.x, s.z + out);
        this.me.a = 0;
      }
      this.self.setAnim(this.me.a);
      this.ev.seat(this.me.seat);
    }
  }

  onlineCount() {
    return new Set([this.me.userId, ...[...this.remotes.values()].map((r) => r.info.userId)]).size;
  }

  takeSeat(seatId: string) {
    return new Promise<{ ok: boolean; error?: string }>((res) => this.socket.emit('seat:take', { seatId }, res));
  }
  leaveSeat() {
    this.socket.emit('seat:leave');
  }
  emote(type: Emote) {
    this.socket.emit('emote', type);
  }
  get nearestFreeSeat() {
    return this.nearSeat;
  }

  setSpeaking(sid: string, on: boolean) {
    if (sid === this.me.sid) this.self.setSpeaking(on);
    else this.remotes.get(sid)?.avatar.setSpeaking(on);
  }

  private resize() {
    const w = innerWidth;
    const hgt = innerHeight;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.updateSelf(dt);
    this.updateRemotes(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateSelf(dt: number) {
    const me = this.me;
    let anim: Anim = me.seat ? 3 : 0;
    if (!me.seat) {
      const { x, y, run } = this.input.axis();
      if (x || y) {
        // hướng theo camera: camYaw là góc camera nhìn về phía nhân vật
        const yaw = this.input.camYaw;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        // phải màn hình = forward × up = (-fz, fx)
        const dx = fx * y - fz * x;
        const dz = fz * y + fx * x;
        const len = Math.hypot(dx, dz) || 1;
        const speed = run ? RUN : WALK;
        const nx = me.x + (dx / len) * speed * dt * Math.min(1, Math.hypot(x, y));
        const nz = me.z + (dz / len) * speed * dt * Math.min(1, Math.hypot(x, y));
        [me.x, me.z] = resolveCollision(nx, nz);
        const targetRy = Math.atan2(dx, dz);
        me.ry = lerpAngle(me.ry, targetRy, Math.min(1, dt * 12));
        anim = run ? 2 : 1;
      }
    }
    me.a = anim;
    this.self.setAnim(anim);
    this.self.root.position.set(me.x, 0, me.z);
    this.self.root.rotation.y = me.ry;
    this.self.update(dt);

    const zone = zoneAt(me.x);
    if (zone !== me.zone) {
      me.zone = zone;
      this.ev.zone(zone);
    }

    // Gửi trạng thái tối đa NET_HZ lần/giây, chỉ khi thay đổi
    const now = performance.now();
    if (!me.seat && now - this.lastSent > 1000 / NET_HZ) {
      const state = `${me.x.toFixed(2)},${me.z.toFixed(2)},${me.ry.toFixed(2)},${anim}`;
      if (state !== this.sentState) {
        this.socket.emit('move', { x: me.x, z: me.z, ry: me.ry, a: anim });
        this.sentState = state;
        this.lastSent = now;
      }
    }

    // Ghế trống gần nhất
    let best: Seat | null = null;
    if (!me.seat && me.zone === 'library') {
      let bd = SEAT_REACH;
      for (const s of SEATS) {
        if (this.seats.has(s.id)) continue;
        const d = Math.hypot(s.x - me.x, s.z - me.z);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
    }
    if (best !== this.nearSeat) {
      this.nearSeat = best;
      this.ev.nearSeat(best);
    }
  }

  private updateRemotes(dt: number) {
    const k = Math.min(1, dt * 10);
    for (const r of this.remotes.values()) {
      const p = r.avatar.root.position;
      const dx = r.tx - p.x;
      const dz = r.tz - p.z;
      if (Math.hypot(dx, dz) > 6) p.set(r.tx, 0, r.tz); // dịch chuyển xa → nhảy thẳng
      else p.set(p.x + dx * k, 0, p.z + dz * k);
      r.avatar.root.rotation.y = lerpAngle(r.avatar.root.rotation.y, r.try_, k);
      r.avatar.update(dt);
    }
  }

  private updateCamera(dt: number) {
    const sitting = Boolean(this.me.seat);
    const dist = sitting ? Math.min(this.input.camDist, 5) : this.input.camDist;
    const yaw = this.input.camYaw;
    this.camTarget.lerp(new THREE.Vector3(this.me.x, sitting ? 1.0 : 1.2, this.me.z), Math.min(1, dt * 8));
    const height = dist * 0.62;
    const desired = new THREE.Vector3(this.camTarget.x + Math.sin(yaw) * dist, this.camTarget.y + height, this.camTarget.z + Math.cos(yaw) * dist);
    this.camera.position.lerp(desired, Math.min(1, dt * 6));
    this.camera.lookAt(this.camTarget);
  }

  /** Phím tắt trong game */
  handleKey(e: KeyboardEvent, actions: { interact(): void; nod(): void; chat(): void }) {
    if (isTyping()) return;
    if (e.code === 'KeyE') actions.interact();
    else if (e.code === 'KeyN') actions.nod();
    else if (e.code === 'Enter' || e.code === 'KeyT') {
      e.preventDefault();
      actions.chat();
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
