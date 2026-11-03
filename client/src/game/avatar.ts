// Nhân vật KayKit Adventurers (CC0). Mỗi loại chỉ tải 1 lần, người chơi dùng bản clone.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Anim, Avatar as AvatarKind, Emote } from '../../../shared/protocol.ts';

export const AVATAR_LABEL: Record<AvatarKind, string> = {
  Knight: 'Hiệp sĩ',
  Mage: 'Pháp sư',
  Rogue: 'Lữ khách',
  Rogue_Hooded: 'Áo choàng',
  Barbarian: 'Chiến binh',
};
export const AVATAR_COLOR: Record<AvatarKind, string> = {
  Knight: '#7c9cc6',
  Mage: '#9a6fd1',
  Rogue: '#6aa57a',
  Rogue_Hooded: '#4f6f5a',
  Barbarian: '#d08b5b',
};

const loader = new GLTFLoader();
const cache = new Map<AvatarKind, Promise<GLTF>>();
const load = (kind: AvatarKind) => {
  if (!cache.has(kind)) cache.set(kind, loader.loadAsync(`/models/${kind}.glb`));
  return cache.get(kind)!;
};

const TARGET_HEIGHT = 1.75;
const CLIP: Record<Anim, string> = { 0: 'Idle', 1: 'Walking_A', 2: 'Running_A', 3: 'Sit_Chair_Idle' };

export class Avatar {
  readonly root = new THREE.Group();
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;
  private head?: THREE.Object3D;
  private label: THREE.Sprite;
  private labelCanvas = document.createElement('canvas');
  private nodT = -1;
  private anim: Anim = 0;
  private name = '';
  private mic = false;
  private speaking = false;
  private oneShot?: THREE.AnimationAction;
  /** Xong khi model + animation đã tải */
  readonly ready: Promise<void>;

  constructor(kind: AvatarKind, name: string, private shadows: boolean, isSelf = false) {
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 64;
    const tex = new THREE.CanvasTexture(this.labelCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.label.scale.set(1.6, 0.4, 1);
    this.label.position.y = TARGET_HEIGHT + 0.35;
    this.label.renderOrder = 10;
    this.root.add(this.label);
    this.isSelf = isSelf;
    this.setName(name);
    // khối giữ chỗ trong lúc tải model
    const ph = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8899aa }));
    ph.position.y = 0.8;
    this.root.add(ph);
    this.ready = this.setKind(kind, ph);
  }
  private isSelf: boolean;

  private async setKind(kind: AvatarKind, placeholder?: THREE.Object3D) {
    const gltf = await load(kind);
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = this.shadows;
        o.frustumCulled = false; // skinned mesh có bbox sai khi quantize → tránh bị ẩn nhầm
      }
      if (o.name === 'head') this.head = o;
    });
    // KayKit cao ~2.5 đơn vị → thu về ~1.75m
    model.scale.setScalar(TARGET_HEIGHT / 2.45);
    placeholder?.removeFromParent();
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.oneShot) return;
      this.oneShot = undefined;
      this.play(this.anim, 0.25, true);
    });
    this.play(this.anim, 0, true);
  }

  setName(name: string, mic = this.mic, speaking = this.speaking) {
    if (name === this.name && mic === this.mic && speaking === this.speaking) return;
    this.name = name;
    this.mic = mic;
    this.speaking = speaking;
    const c = this.labelCanvas;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = '600 28px system-ui, sans-serif';
    const text = (mic ? '🎤 ' : '') + name;
    const w = Math.min(c.width - 8, ctx.measureText(text).width + 28);
    ctx.fillStyle = speaking ? 'rgba(31,111,67,0.92)' : this.isSelf ? 'rgba(244,184,96,0.92)' : 'rgba(20,26,38,0.78)';
    roundRect(ctx, (c.width - w) / 2, 8, w, 48, 22);
    ctx.fill();
    ctx.fillStyle = this.isSelf && !speaking ? '#2a1c05' : '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, 33, c.width - 20);
    (this.label.material.map as THREE.Texture).needsUpdate = true;
  }

  setMic(on: boolean) {
    this.setName(this.name, on, this.speaking);
  }
  setSpeaking(on: boolean) {
    this.setName(this.name, this.mic, on);
  }

  setAnim(a: Anim) {
    if (a === this.anim) return;
    this.anim = a;
    if (!this.oneShot) this.play(a, 0.2);
  }

  private play(a: Anim, fade: number, force = false) {
    const next = this.actions.get(CLIP[a]);
    if (!next || (next === this.current && !force)) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
    if (this.current && this.current !== next) this.current.fadeOut(fade);
    this.current = next;
  }

  emote(type: Emote) {
    if (type === 'nod') {
      this.nodT = 0;
      return;
    }
    if (this.anim === 3) return; // đang ngồi chỉ gật đầu
    const clip = this.actions.get(type === 'wave' ? 'Interact' : 'Cheer');
    if (!clip) return;
    // Bấm lại khi động tác đang chạy: phát lại từ đầu. Không fadeOut chính nó (weight về 0 → three.js
    // tắt action, 'finished' không bao giờ bắn → oneShot kẹt và nhân vật đứng im mãi).
    clip.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1);
    clip.clampWhenFinished = false;
    if (clip !== this.current) {
      clip.fadeIn(0.15);
      this.current?.fadeOut(0.15);
    }
    clip.play();
    this.current = clip;
    this.oneShot = clip;
  }

  update(dt: number) {
    // Gật đầu: cộng góc cúi đầu sau khi animation đã đặt tư thế (gỡ góc frame trước để không cộng dồn)
    if (this.head) this.head.rotation.x -= this.nodOffset;
    this.nodOffset = 0;
    this.mixer?.update(dt);
    if (this.nodT >= 0 && this.head) {
      this.nodT += dt;
      const dur = 1.1;
      if (this.nodT > dur) this.nodT = -1;
      else {
        const t = this.nodT / dur;
        this.nodOffset = Math.sin(t * Math.PI * 4) * 0.35 * Math.sin(t * Math.PI);
        this.head.rotation.x += this.nodOffset;
      }
    }
  }
  private nodOffset = 0;

  dispose() {
    this.root.removeFromParent();
    this.mixer?.stopAllAction();
    (this.label.material.map as THREE.Texture).dispose();
    this.label.material.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function preloadAvatar(kind: AvatarKind) {
  return load(kind);
}
