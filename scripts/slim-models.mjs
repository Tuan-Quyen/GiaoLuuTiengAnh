// Giảm dung lượng model KayKit: chỉ giữ animation app dùng, bỏ vũ khí/khiên.
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample, quantize } from '@gltf-transform/functions';
import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'assets-src/kaykit';
const OUT = 'client/public/models';
const KEEP_ANIMS = new Set(['Idle', 'Walking_A', 'Running_A', 'Sit_Chair_Down', 'Sit_Chair_Idle', 'Sit_Chair_StandUp', 'Cheer', 'Interact']);
const WEAPON = /(sword|shield|axe|crossbow|dagger|staff|wand|spellbook|quiver|arrow|mug|knife|throwable)/i;

mkdirSync(OUT, { recursive: true });
const io = new NodeIO();
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(join(SRC, file));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!KEEP_ANIMS.has(a.getName())) a.dispose();
  for (const n of root.listNodes()) if (n.getMesh() && WEAPON.test(n.getName())) n.dispose();
  await doc.transform(resample(), prune(), dedup(), quantize());
  await io.write(join(OUT, file), doc);
  console.log('slimmed', file, root.listAnimations().map((a) => a.getName()).join(','));
}
copyFileSync(join(SRC, 'LICENSE.txt'), join(OUT, 'KAYKIT_LICENSE.txt'));
