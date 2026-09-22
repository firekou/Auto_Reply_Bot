/** Thin wrapper so `node dist/tools/make-fixtures.js` works as documented. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli', 'index.js');
const result = spawnSync(process.execPath, [cli, 'make-fixtures', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
