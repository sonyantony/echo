// Copies the Camel catalog that Kaoto needs into public/camel-catalog.
// Only the pinned Spring Boot runtime catalog is copied (the full package is ~440 MB).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CAMEL_VERSION = '4.22.1';
const RUNTIME = 'camel-springboot';

const require = createRequire(import.meta.url);
const srcDir = dirname(require.resolve('@kaoto/camel-catalog/index.json'));
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'camel-catalog');

const index = JSON.parse(readFileSync(join(srcDir, 'index.json'), 'utf8'));
const definitions = index.definitions.filter(
  (d) => d.fileName.startsWith(`${RUNTIME}/${CAMEL_VERSION}/`) || d.runtime === 'Citrus',
);
if (!definitions.some((d) => d.fileName.startsWith(`${RUNTIME}/`))) {
  throw new Error(`Camel ${CAMEL_VERSION} (${RUNTIME}) not found in @kaoto/camel-catalog`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const dirs = new Set(definitions.map((d) => dirname(d.fileName)));
for (const extra of ['xslt', 'starter-templates']) {
  if (existsSync(join(srcDir, extra))) dirs.add(extra);
}
for (const dir of dirs) {
  cpSync(join(srcDir, dir), join(outDir, dir), { recursive: true });
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ ...index, definitions }, null, 2));
console.log(`Copied Camel catalog ${RUNTIME} ${CAMEL_VERSION} to ${outDir}`);
