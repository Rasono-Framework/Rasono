/**
 * This file provides framework-oriented generators for Rasono modules and
 * authorization policies so projects can follow the official conventions.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathExists } from './fs.js';

function renderFileHeader(description: string): string {
  return `/**\n * ${description}\n */\n`;
}

function normalizeInputName(value: string, label: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-');
  if (!normalized || normalized.includes('..')) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return normalized;
}

function toSegments(value: string): string[] {
  return value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function toCamelCase(value: string): string {
  const compact = value.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!compact) return 'generated';
  const [first, ...rest] = compact.split(/\s+/);
  return `${first.toLowerCase()}${rest.map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`).join('')}`;
}

function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return `${camel[0]?.toUpperCase() ?? 'G'}${camel.slice(1)}`;
}

function renderModuleFile(moduleName: string, moduleSymbol: string): string {
  return `${renderFileHeader('This file declares a domain module following the official Rasono module boundary.')}import { defineModule } from '@rasono/app';

export const ${moduleSymbol} = defineModule<{}>({
  name: '${moduleName}',
});
`;
}

function renderServiceFile(moduleLabel: string, serviceSymbol: string): string {
  return `${renderFileHeader('This file contains the module service entrypoint used by generated routes and use-cases.')}export type ${serviceSymbol} = {
  list: () => Array<{ id: string; name: string }>;
};

export function create${serviceSymbol}(): ${serviceSymbol} {
  return {
    list: () => [{ id: '${moduleLabel}-1', name: '${moduleLabel} example' }],
  };
}
`;
}

function renderRouteFile(moduleName: string, operationId: string): string {
  return `${renderFileHeader('This file exposes the generated module route entrypoint using the official file-based API convention.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'get',
  operationId: '${operationId}',
  summary: 'List ${moduleName} resources',
  tags: ['${moduleName}'],
  response: {
    status: 200,
    description: 'Generated module route response',
  },
  handler: () => ({
    items: [],
  }),
});
`;
}

function renderPolicyFile(policySymbol: string): string {
  return `${renderFileHeader('This file defines a reusable authorization policy for a Rasono module.')}import { definePolicy } from '@rasono/app';

export const ${policySymbol} = definePolicy(({ principal }) => {
  return Boolean(principal);
});
`;
}

async function writeGeneratedFile(filePath: string, contents: string): Promise<void> {
  if (await pathExists(filePath)) {
    throw new Error(`file already exists: ${filePath}`);
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

async function upsertModuleRegistry(rootDir: string, moduleRel: string, moduleSymbol: string): Promise<string> {
  const registryPath = resolve(rootDir, 'src/modules/index.ts');
  const importPath = `./${moduleRel}/${moduleRel.split('/').pop()}.module.js`;
  const importLine = `import { ${moduleSymbol} } from '${importPath}';`;

  if (!(await pathExists(registryPath))) {
    const contents = `${renderFileHeader('This file centralizes the app module registry used by createApp().')}${importLine}

export const appModules = [
  ${moduleSymbol},
];
`;
    await mkdir(dirname(registryPath), { recursive: true });
    await writeFile(registryPath, contents, 'utf8');
    return registryPath;
  }

  let source = await readFile(registryPath, 'utf8');
  if (!source.includes(importLine)) {
    const lines = source.split('\n');
    let insertIndex = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i]?.startsWith('import ')) {
        insertIndex = i;
        break;
      }
    }
    if (insertIndex >= 0) {
      lines.splice(insertIndex + 1, 0, importLine);
    } else {
      lines.unshift(importLine);
    }
    source = lines.join('\n');
  }

  if (!source.includes(moduleSymbol)) {
    source = source.replace(
      /export const appModules = \[\n([\s\S]*?)\n\];/,
      (_match, body: string) => `export const appModules = [\n${body}\n  ${moduleSymbol},\n];`,
    );
  }

  await writeFile(registryPath, source, 'utf8');
  return registryPath;
}

export async function generateModule(rootDir: string, rawModuleName: string): Promise<{ files: string[]; registryFile: string }> {
  const moduleRel = normalizeInputName(rawModuleName, 'module name');
  const segments = toSegments(moduleRel);
  const moduleName = segments.at(-1) ?? moduleRel;
  const moduleDir = resolve(rootDir, 'src/modules', moduleRel);
  const moduleSymbol = `${toCamelCase(moduleName)}Module`;
  const serviceSymbol = `${toPascalCase(moduleName)}Service`;
  const operationId = `${toCamelCase(moduleName)}List`;

  const files = [
    resolve(moduleDir, `${moduleName}.module.ts`),
    resolve(moduleDir, `${moduleName}.service.ts`),
    resolve(moduleDir, 'api/index.ts'),
  ];

  await writeGeneratedFile(files[0], renderModuleFile(moduleName, moduleSymbol));
  await writeGeneratedFile(files[1], renderServiceFile(moduleName, serviceSymbol));
  await writeGeneratedFile(files[2], renderRouteFile(moduleName, operationId));
  const registryFile = await upsertModuleRegistry(rootDir, moduleRel, moduleSymbol);

  return { files, registryFile };
}

export async function generatePolicy(
  rootDir: string,
  rawModuleName: string,
  rawPolicyName: string,
): Promise<{ filePath: string }> {
  const moduleRel = normalizeInputName(rawModuleName, 'module name');
  const policyName = normalizeInputName(rawPolicyName, 'policy name').split('/').pop() as string;
  const policySymbol = `${toCamelCase(policyName)}Policy`;
  const filePath = resolve(rootDir, 'src/modules', moduleRel, `${policyName}.policy.ts`);

  await writeGeneratedFile(filePath, renderPolicyFile(policySymbol));
  return { filePath };
}
