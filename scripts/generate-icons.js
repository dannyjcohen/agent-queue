// Generate PWA + Apple touch icons from the agent-dashboard hexagon SVG.
// Source of truth for the mark: agent-system dashboard favicon
// (C:\dev\agent-system\dashboard\client\public\favicon.svg), copied into
// assets/icon.svg here so the repo is self-contained.
//
// Usage: node scripts/generate-icons.js
//
// Outputs (public/):
//   apple-touch-icon.png  180x180  — iOS home screen (opaque, dark bg)
//   icon-192.png          192x192  — PWA maskable (icon in 80% safe zone)
//   icon-512.png          512x512  — PWA maskable (icon in 80% safe zone)

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SVG_PATH = path.join(__dirname, '..', 'assets', 'icon.svg');
const OUT_DIR = path.join(__dirname, '..', 'public');
const BG = '#0f0f0f'; // matches manifest background_color / theme_color

async function makeIcon(size, iconRatio, outName) {
  const iconSize = Math.round(size * iconRatio);
  const icon = await sharp(SVG_PATH, { density: 300 })
    .resize(iconSize, iconSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: icon, gravity: 'center' }])
    .flatten({ background: BG }) // opaque — required for apple-touch-icon, correct for maskable
    .png()
    .toFile(path.join(OUT_DIR, outName));

  console.log(`wrote public/${outName} (${size}x${size}, icon ${iconSize}px)`);
}

(async () => {
  if (!fs.existsSync(SVG_PATH)) {
    console.error(`Missing ${SVG_PATH} — copy the dashboard favicon.svg there first.`);
    process.exit(1);
  }
  // Apple touch icon: iOS rounds the corners itself; ~72% mark looks right.
  await makeIcon(180, 0.72, 'apple-touch-icon.png');
  // Maskable PWA icons: keep the mark inside the central 80% safe zone.
  await makeIcon(192, 0.66, 'icon-192.png');
  await makeIcon(512, 0.66, 'icon-512.png');
})();
