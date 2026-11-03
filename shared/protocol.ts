// Giao thức socket giữa client và server.
import type { Zone } from './map.ts';

/** 0 đứng, 1 đi, 2 chạy, 3 ngồi */
export type Anim = 0 | 1 | 2 | 3;
export type Emote = 'nod' | 'wave' | 'cheer';
export type ChatChannel = 'global' | 'zone';

export const AVATARS = ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'] as const;
export type Avatar = (typeof AVATARS)[number];

export interface PlayerInfo {
  sid: string;
  userId: string;
  name: string;
  avatar: Avatar;
  x: number;
  z: number;
  ry: number;
  a: Anim;
  zone: Zone;
  seat: string | null;
  mic: boolean;
}

/** [sid, x, z, ry, anim] — gói gọn để gửi 10 lần/giây */
export type SnapEntry = [string, number, number, number, Anim];

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  zone?: Zone;
  userId: string;
  name: string;
  text: string;
  at: number;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  sid?: string;
  room?: { code: string; name: string; epoch: number };
  serverNow?: number;
  players?: PlayerInfo[];
  seats?: Record<string, string>; // seatId -> sid
  chat?: ChatMessage[];
}

export const NET_HZ = 10;
/** Pomodoro chung 25/5 phút, tính từ epoch của phòng */
export const FOCUS_MS = 25 * 60_000;
export const BREAK_MS = 5 * 60_000;

export function pomodoro(now: number, epoch: number) {
  const cycle = FOCUS_MS + BREAK_MS;
  const t = (((now - epoch) % cycle) + cycle) % cycle;
  return t < FOCUS_MS
    ? { phase: 'focus' as const, remaining: FOCUS_MS - t }
    : { phase: 'break' as const, remaining: cycle - t };
}

/** Âm thanh nhỏ dần theo khoảng cách (khu thư giãn) */
export const VOICE_FULL = 3;
export const VOICE_MAX = 12;
export const VOICE_DISCONNECT = 14;
export function voiceGain(dist: number) {
  if (dist <= VOICE_FULL) return 1;
  if (dist >= VOICE_MAX) return 0;
  const t = (dist - VOICE_FULL) / (VOICE_MAX - VOICE_FULL);
  return (1 - t) * (1 - t);
}
