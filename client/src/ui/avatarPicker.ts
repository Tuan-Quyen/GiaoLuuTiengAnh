// Chọn nhân vật kèm xem thử 3D: nhân vật đứng xoay chậm, đổi nhân vật thì vẫy tay chào,
// kéo để xoay, bấm vào để cổ vũ. Dùng ở màn tạo hồ sơ và màn sửa hồ sơ.
// Renderer tự giải phóng khi canvas bị gỡ khỏi trang (đóng modal, chuyển màn).
import * as THREE from 'three';
import { AVATARS, type Avatar as AvatarKind } from '../../../shared/protocol.ts';
import { h } from '../dom.ts';
import { AVATAR_COLOR, AVATAR_LABEL, Avatar } from '../game/avatar.ts';

export function avatarPicker(initial: AvatarKind, name: () => string) {
  let kind = initial;
  const canvas = h('canvas.avatar-preview');
  const caption = h('div.avatar-caption');
  const btns = AVATARS.map((a) =>
    h(`button${a === kind ? '.on' : ''}`, { type: 'button', onclick: () => select(a) }, h('span.dot', { style: { background: AVATAR_COLOR[a] } }), AVATAR_LABEL[a]),
  );

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404a5c, 1.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 3);
  scene.add(key);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 1.3, 4.1);
  camera.lookAt(0, 1.1, 0);

  let avatar: Avatar | undefined;
  let yaw = 0.5;
  let shownName = '';
  const show = (a: AvatarKind, greet: boolean) => {
    avatar?.dispose();
    shownName = name().trim() || 'Tên của bạn';
    const av = (avatar = new Avatar(a, shownName, false));
    scene.add(av.root);
    if (greet) av.ready.then(() => av === avatar && av.emote('wave'));
    caption.textContent = AVATAR_LABEL[a];
  };
  const select = (a: AvatarKind) => {
    if (a === kind) return avatar?.emote('cheer');
    kind = a;
    btns.forEach((b, i) => b.classList.toggle('on', AVATARS[i] === a));
    show(a, true);
  };
  show(kind, false);

  // kéo để xoay; chạm/bấm (không kéo) thì cổ vũ
  let drag: { x: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    yaw += dx * 0.012;
    drag.x = e.clientX;
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && !drag.moved) avatar?.emote('cheer');
    drag = null;
  });

  const clock = new THREE.Clock();
  let mounted = false;
  const frame = () => {
    if (!canvas.isConnected) {
      if (mounted) return dispose();
      return requestAnimationFrame(frame); // chưa gắn vào trang
    }
    mounted = true;
    const dt = Math.min(clock.getDelta(), 0.1);
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (w && hgt && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(hgt * renderer.getPixelRatio()))) {
      renderer.setSize(w, hgt, false);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
    }
    const n = name().trim() || 'Tên của bạn';
    if (avatar && n !== shownName) avatar.setName((shownName = n));
    if (!drag) yaw += dt * 0.4;
    if (avatar) {
      avatar.root.rotation.y = yaw;
      avatar.update(dt);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  function dispose() {
    avatar?.dispose();
    disc.geometry.dispose();
    disc.material.dispose();
    renderer.dispose();
    renderer.forceContextLoss(); // trả lại WebGL context, trình duyệt chỉ cho mở vài cái cùng lúc
  }

  return {
    el: h('div.col.avatar-picker', h('div.avatar-stage', canvas, caption, h('div.avatar-hint', 'Kéo để xoay · chạm để cổ vũ')), h('div.avatars', btns)),
    get: () => kind,
  };
}
