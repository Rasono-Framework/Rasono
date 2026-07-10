import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { listFilesRecursive, pathExists } from './fs.js';
import { relPosix, withoutExt } from './paths.js';

type GenerateActionsOptions = {
  rootDir: string;
  srcDir?: string;
  actionsDir?: string;
  outDir?: string;
};

type ActionEntry = {
  importPath: string;
  path: string;
};

function actionPathFromRelativeFile(relNoExt: string): string {
  const parts = relNoExt.split('/').filter(Boolean);
  return `/actions/${parts.join('/')}`;
}

function toImportName(i: number): string {
  return `action_${i}`;
}

function renderGenerated(entries: ActionEntry[]): string {
  const lines: string[] = [];
  if (entries.length > 0) {
    lines.push("import type { ServerActionDef } from '@rasono/actions';");
    lines.push('');
  }
  for (let i = 0; i < entries.length; i += 1) {
    lines.push(`import ${toImportName(i)} from '${entries[i]!.importPath}';`);
  }
  if (entries.length > 0) lines.push('');
  lines.push('export type GeneratedAction = {');
  lines.push('  path: string;');
  lines.push('  summary?: string;');
  lines.push('  description?: string;');
  lines.push('};');
  lines.push('');
  lines.push('export const generatedActions: GeneratedAction[] = [');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const action = toImportName(i);
    lines.push(`  { path: '${entry.path}', summary: ${action}.summary, description: ${action}.description },`);
  }
  lines.push('];');
  lines.push('');
  lines.push('export function installGeneratedActions(app: any): void {');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const action = toImportName(i);
    lines.push(`  app.post('${entry.path}', async (c: any) => {`);
    lines.push("    const body = await c.req.json().catch(() => ({}));");
    lines.push(`    const data = await (${action} as ServerActionDef<any, any>).handler(body?.input, c);`);
    lines.push("    return c.json({ ok: true, data });");
    lines.push('  });');
  }
  lines.push('}');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function generateActions(options: GenerateActionsOptions): Promise<{ outFile: string; count: number }> {
  const srcDir = resolve(options.rootDir, options.srcDir ?? 'src');
  const actionsDir = resolve(srcDir, options.actionsDir ?? 'actions');
  const outDir = resolve(srcDir, options.outDir ?? '.rasono');
  const outFile = resolve(outDir, 'actions.generated.ts');

  if (!(await pathExists(actionsDir))) {
    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, renderGenerated([]), 'utf8');
    return { outFile, count: 0 };
  }

  const files = await listFilesRecursive(actionsDir, { ext: ['.ts', '.tsx'], ignoreDirNames: ['__tests__'] });
  const entries: ActionEntry[] = [];
  for (const abs of files) {
    if (abs.endsWith('.d.ts')) continue;
    if (abs.endsWith('.test.ts') || abs.endsWith('.spec.ts')) continue;
    const relFromActions = withoutExt(relPosix(actionsDir, abs));
    entries.push({
      importPath: `../actions/${relFromActions}.js`,
      path: actionPathFromRelativeFile(relFromActions),
    });
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, renderGenerated(entries), 'utf8');
  return { outFile, count: entries.length };
}
