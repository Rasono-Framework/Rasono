import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { listFilesRecursive, pathExists } from './fs.js';
import { pagePathFromRelativeFile, relPosix, withoutExt } from './paths.js';

type GeneratePagesOptions = {
  rootDir: string;
  srcDir?: string;
  appDir?: string;
  outDir?: string;
};

type PageEntry = {
  importPath: string;
  path: string;
};

function toImportName(i: number): string {
  return `page_${i}`;
}

function renderGenerated(entries: PageEntry[]): string {
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    lines.push(`import ${toImportName(i)} from '${entries[i]!.importPath}';`);
  }
  if (entries.length > 0) lines.push('');
  lines.push('export const generatedPages = [');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const name = toImportName(i);
    lines.push(`  (() => {`);
    lines.push(`    const page = ${name} as any;`);
    lines.push(`    if (!page.path) page.path = '${entry.path}';`);
    lines.push('    return page;');
    lines.push('  })(),');
  }
  lines.push('];');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function generatePages(options: GeneratePagesOptions): Promise<{ outFile: string; count: number }> {
  const srcDir = resolve(options.rootDir, options.srcDir ?? 'src');
  const appDir = resolve(srcDir, options.appDir ?? 'app');
  const outDir = resolve(srcDir, options.outDir ?? '.rasono');
  const outFile = resolve(outDir, 'pages.generated.ts');

  if (!(await pathExists(appDir))) {
    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, renderGenerated([]), 'utf8');
    return { outFile, count: 0 };
  }

  const files = await listFilesRecursive(appDir, { ext: ['.tsx', '.ts'], ignoreDirNames: ['__tests__'] });
  const entries: PageEntry[] = [];

  for (const abs of files) {
    if (!abs.endsWith('.page.tsx') && !abs.endsWith('.page.ts')) continue;
    const relNoExt = withoutExt(relPosix(appDir, abs));
    const importPath = `../app/${relNoExt}.js`;
    const routePath = pagePathFromRelativeFile(relNoExt.replace(/\.page$/, ''));
    entries.push({ importPath, path: routePath });
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, renderGenerated(entries), 'utf8');
  return { outFile, count: entries.length };
}

