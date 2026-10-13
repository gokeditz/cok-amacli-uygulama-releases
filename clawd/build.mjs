// src/ altındaki modülleri tek bir JS paketine toplar ve şablona gömerek
// internet bağlantısı gerektirmeyen tek dosyalık index.html üretir.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  write: false,
  legalComments: 'eof',
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('/*__BUNDLE__*/', () => js);
writeFileSync('index.html', html);
console.log(`index.html yazıldı (${(html.length / 1024).toFixed(0)} KB)`);
