// Elimina caracteres invisibles (zero-width / BOM) que rompen el build de esbuild.
// Se ejecuta automaticamente antes de "vite build" mediante el script "prebuild".
import fs from 'fs';
import path from 'path';

const EXT = /\.(ts|tsx|js|jsx|css|html|json)$/;
const BAD = /[\u200b\u200c\u200d\u2060\ufeff]/g;
let cleaned = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (EXT.test(name)) {
      const original = fs.readFileSync(full, 'utf8');
      const fixed = original.replace(BAD, '');
      if (fixed !== original) {
        fs.writeFileSync(full, fixed);
        cleaned++;
        console.log('  limpiado:', full);
      }
    }
  }
}

walk('src');
console.log(`[strip-invisibles] Caracteres invisibles eliminados en ${cleaned} archivo(s).`);
