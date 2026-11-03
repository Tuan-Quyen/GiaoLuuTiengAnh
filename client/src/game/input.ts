// Bàn phím (WASD/mũi tên, Shift chạy) + joystick cảm ứng + kéo để xoay camera, cuộn/chụm để zoom.
import { h, isTouch, ui } from '../dom.ts';

export class Input {
  private keys = new Set<string>();
  private joy = { x: 0, y: 0, active: false };
  camYaw = 0;
  camDist = 9;
  enabled = true;
  private dragId: number | null = null;
  private lastX = 0;
  private pinch: { d: number; dist: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();

  constructor(canvas: HTMLCanvasElement) {
    addEventListener('keydown', (e) => {
      if (isTyping()) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.camDist };
        this.dragId = null;
        return;
      }
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.camDist = clamp((this.pinch.dist * this.pinch.d) / Math.max(d, 1), 4, 16);
        return;
      }
      if (e.pointerId !== this.dragId) return;
      this.camYaw -= (e.clientX - this.lastX) * 0.006;
      this.lastX = e.clientX;
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (e.pointerId === this.dragId) this.dragId = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => (this.camDist = clamp(this.camDist + e.deltaY * 0.01, 4, 16)), { passive: true });

    if (isTouch()) this.mountJoystick();
  }

  private mountJoystick() {
    const knob = h('div.knob');
    const pad = h('div.joy', knob);
    ui().appendChild(pad);
    const R = 50;
    let id: number | null = null;
    let cx = 0;
    let cy = 0;
    pad.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      pad.setPointerCapture(e.pointerId);
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy = { x: dx / R, y: dy / R, active: true };
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.joy = { x: 0, y: 0, active: false };
    };
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
  }

  /** Hướng di chuyển trong hệ trục camera: x phải, y tiến; run = chạy */
  axis() {
    if (!this.enabled) return { x: 0, y: 0, run: false };
    if (this.joy.active) {
      const m = Math.hypot(this.joy.x, this.joy.y);
      if (m < 0.15) return { x: 0, y: 0, run: false };
      return { x: this.joy.x, y: -this.joy.y, run: m > 0.9 };
    }
    const k = (c: string) => this.keys.has(c);
    const x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, run: k('ShiftLeft') || k('ShiftRight') };
  }

  clear() {
    this.keys.clear();
  }
}

export const isTyping = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
