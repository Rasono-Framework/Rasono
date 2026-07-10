import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function listFilesRecursive(root: string, options?: { ext?: string[]; ignoreDirNames?: string[] }): Promise<string[]> {
  const ext = options?.ext ?? [];
  const ignore = new Set(options?.ignoreDirNames ?? []);
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) stack.push(p);
        continue;
      }
      if (e.isFile()) {
        if (ext.length === 0 || ext.some((x) => e.name.endsWith(x))) out.push(p);
      }
    }
  }

  out.sort();
  return out;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

