import { lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, '..');
const localPackagePath = resolve(webDir, 'node_modules/rasengan');
const hoistedPackagePath = resolve(webDir, '../../node_modules/rasengan');

async function ensureLink() {
  try {
    const stats = await lstat(localPackagePath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(localPackagePath);
      if (resolve(dirname(localPackagePath), target) === hoistedPackagePath) {
        return;
      }
    }
    await rm(localPackagePath, { recursive: true, force: true });
  } catch {
    // No existing package link to clean up.
  }

  await mkdir(dirname(localPackagePath), { recursive: true });
  await symlink(hoistedPackagePath, localPackagePath, 'junction');
}

ensureLink().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`failed to link rasengan locally: ${message}\n`);
  process.exit(1);
});
