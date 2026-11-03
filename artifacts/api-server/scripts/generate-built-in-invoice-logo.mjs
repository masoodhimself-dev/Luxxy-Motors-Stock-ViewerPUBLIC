import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// Build-time source only. The production logo resolver never reads paths or URLs.
const source = new URL('../../luxxy-motors/public/brand/multi-choice-motors/multi-choice-wordmark.svg', import.meta.url);
const target = new URL('../src/lib/built-in-invoice-logo.ts', import.meta.url);
const svg = await readFile(source);
const image = await loadImage(svg);
const canvas = createCanvas(image.width * 2, image.height * 2);
canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
const png = (await canvas.encode('png')).toString('base64');
const chunks = png.match(/.{1,120}/g).map(chunk => `  '${chunk}',`).join('\n');
await writeFile(target, `/** Generated from the shipped SVG. Do not hand-edit or load a runtime path/URL.
 * Regenerate: node artifacts/api-server/scripts/generate-built-in-invoice-logo.mjs
 * Source: artifacts/luxxy-motors/public/brand/multi-choice-motors/multi-choice-wordmark.svg
 * Raster: exact SVG at ${canvas.width} x ${canvas.height} (2x), transparent PNG.
 */
export const builtInMultiChoiceLogoPath = '/brand/multi-choice-motors/multi-choice-wordmark.svg';
export const builtInMultiChoiceLogoSvgSha256 = '${createHash('sha256').update(svg).digest('hex')}';
export const builtInMultiChoiceLogoPngDataUrl = 'data:image/png;base64,' + [
${chunks}
].join('');
`);
