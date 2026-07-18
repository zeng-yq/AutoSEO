// 从 SVG 源文件生成浏览器插件图标 PNG(全部尺寸统一使用 source.svg)。
//   logo 本身简洁(蓝色球弧 + 黄色 SEO 字),各尺寸共用同一 SVG 即可。
//
// 用法:node scripts/generate-icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, 'icon-src');        // SVG 源(不发布)
const OUT_DIR = resolve(__dirname, '../public/icon');   // 输出 PNG(WXT 自动识别)

const SIZES = [16, 32, 48, 96, 128];

function render(size) {
  const svg = readFileSync(resolve(SRC_DIR, 'source.svg'), 'utf-8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  return resvg.render().asPng();
}

for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `${size}.png`), render(size));
  console.log(`✓ ${size}.png`);
}
console.log('done.');
