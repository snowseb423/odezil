// Génère les icônes PWA à partir des SVG de scripts/ (npm run icons).
// - icône « any » : carré arrondi sur fond transparent ;
// - maskable et Apple : fond plein, goutte dans la zone sûre (80 %).
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import ico from 'sharp-ico'

const rounded = await readFile(new URL('./icon.svg', import.meta.url))
const fullBleed = (scale) =>
  readFile(new URL('./icon-full-bleed.svg', import.meta.url), 'utf8').then((svg) => Buffer.from(svg.replace('SCALE', String(scale))))

const render = (svg, size) => sharp(svg, { density: Math.ceil((72 * size) / 64) }).resize(size, size).png({ compressionLevel: 9 })

const targets = [
  ['public/pwa-64x64.png', rounded, 64],
  ['public/pwa-192x192.png', rounded, 192],
  ['public/pwa-512x512.png', rounded, 512],
  ['public/maskable-icon-512x512.png', await fullBleed(0.66), 512],
  ['public/apple-touch-icon-180x180.png', await fullBleed(0.78), 180],
]

for (const [path, svg, size] of targets) {
  await render(svg, size).toFile(path)
  console.log(`✓ ${path}`)
}

const favicon = await Promise.all([16, 32, 48].map((size) => render(rounded, size).toBuffer()))
await writeFile('public/favicon.ico', ico.encode(favicon))
await copyFile(new URL('./icon.svg', import.meta.url), 'public/favicon.svg')
console.log('✓ public/favicon.ico, public/favicon.svg')
