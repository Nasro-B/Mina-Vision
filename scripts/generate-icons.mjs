// Génère toutes les icônes de Mina Vision à partir de assets/Logo/Mina Vision3.png :
//   - Windows : PNG 256 (icône de fenêtre/barre des tâches) + .ico multi-tailles (raccourci bureau) ;
//   - Android : mipmaps ic_launcher / ic_launcher_round aux 5 densités.
// Source unique de vérité pour le logo (app + Mina + lanceurs) — relancer après toute mise à jour.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets', 'Logo', 'Mina Vision3.png');

const pngAt = (size) => sharp(SOURCE)
  .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

// Encodeur ICO minimal : Windows Vista+ accepte des PNG embarqués (une entrée par taille).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type = icône
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  const dataChunks = [];
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base); // 0 = 256
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, base + 1);
    directory.writeUInt8(0, base + 2); // palette
    directory.writeUInt8(0, base + 3); // réservé
    directory.writeUInt16LE(1, base + 4); // plans
    directory.writeUInt16LE(32, base + 6); // bits/pixel
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
    dataChunks.push(entry.png);
  });
  return Buffer.concat([header, directory, ...dataChunks]);
}

const ANDROID_DENSITIES = [
  ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192],
];

async function main() {
  // --- Windows ---
  const logoDir = join(ROOT, 'assets', 'Logo');
  await writeFile(join(logoDir, 'mina-vision-256.png'), await pngAt(256));
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoEntries = await Promise.all(icoSizes.map(async (size) => ({ size, png: await pngAt(size) })));
  await writeFile(join(logoDir, 'mina-vision.ico'), buildIco(icoEntries));
  console.log('Windows : mina-vision-256.png + mina-vision.ico');

  // --- Android : mipmaps legacy (carré + rond) ---
  for (const [density, size] of ANDROID_DENSITIES) {
    const dir = join(ROOT, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
    await mkdir(dir, { recursive: true });
    const square = await pngAt(size);
    await writeFile(join(dir, 'ic_launcher.png'), square);
    // Rond : masque circulaire sur le même rendu.
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
    );
    const round = await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();
    await writeFile(join(dir, 'ic_launcher_round.png'), round);
  }
  console.log('Android : mipmaps ic_launcher + ic_launcher_round (5 densités)');
}

main().catch((error) => {
  console.error('Échec génération icônes :', error.message);
  process.exit(1);
});
