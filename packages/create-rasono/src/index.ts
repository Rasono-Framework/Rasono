#!/usr/bin/env node
/**
 * Purpose: Scaffold Rasono workspaces with the official package layout and starter conventions.
 * Goal: Generate projects that stay aligned with the framework's reference architecture without manual setup drift.
 * Value: Gives teams a faster, safer bootstrap path with production-oriented defaults and workspace wiring already in place.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
type AppPreset = 'landing-page' | 'api-only' | 'simple-crud' | 'full-app' | 'custom';
type DataProvider = 'none' | 'drizzle' | 'kysely' | 'engine';
type DatabaseKind = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'turso';

type ParsedArgs = {
  target?: string;
  targetProvided: boolean;
  installDependencies?: boolean;
  yes: boolean;
  interactive: boolean;
  pm?: PackageManager;
  preset?: AppPreset;
  includeApi?: boolean;
  includeWeb?: boolean;
  includeActions?: boolean;
  includeSwagger?: boolean;
  includeRpc?: boolean;
  dataProvider?: DataProvider;
  database?: DatabaseKind;
};

type ScaffoldConfig = {
  preset: AppPreset;
  includeApi: boolean;
  includeWeb: boolean;
  includeActions: boolean;
  includeSwagger: boolean;
  includeRpc: boolean;
  dataProvider: DataProvider;
  database?: DatabaseKind;
};

const RASONO_VERSION = '0.1.0';
const RASONO_PACKAGE_DIRS = {
  '@rasono/actions': 'actions',
  '@rasono/auth': 'auth',
  '@rasono/app': 'app',
  '@rasono/cli': 'cli',
  '@rasono/core': 'core',
  '@rasono/data': 'data',
  '@rasono/data-drizzle': 'data-drizzle',
  '@rasono/data-engine': 'data-engine',
  '@rasono/data-kysely': 'data-kysely',
  '@rasono/hono': 'hono',
  '@rasono/rasengan': 'rasengan',
  '@rasono/swagger': 'swagger',
  '@rasono/web-core': 'web-core',
} as const;

const PRESET_DEFINITIONS: Record<
  Exclude<AppPreset, 'custom'>,
  { label: string; description: string; defaults: Omit<ScaffoldConfig, 'preset' | 'dataProvider' | 'database'> }
> = {
  'landing-page': {
    label: 'Landing Page',
    description: 'Lightweight marketing website with no required API or backend integration.',
    defaults: {
      includeApi: false,
      includeWeb: true,
      includeActions: false,
      includeSwagger: false,
      includeRpc: false,
    },
  },
  'api-only': {
    label: 'API Only',
    description: 'Hono/Rasono API with JSON HTTP documentation and Swagger UI ready to use.',
    defaults: {
      includeApi: true,
      includeWeb: false,
      includeActions: false,
      includeSwagger: true,
      includeRpc: false,
    },
  },
  'simple-crud': {
    label: 'Simple CRUD',
    description: 'Web + API CRUD stack with sample routes, Swagger, and generated RPC client.',
    defaults: {
      includeApi: true,
      includeWeb: true,
      includeActions: false,
      includeSwagger: true,
      includeRpc: true,
    },
  },
  'full-app': {
    label: 'Full App',
    description: 'Full starter with Web, API, Swagger, server actions, and generated RPC.',
    defaults: {
      includeApi: true,
      includeWeb: true,
      includeActions: true,
      includeSwagger: true,
      includeRpc: true,
    },
  },
};

const DATA_PROVIDER_CHOICES: Record<DataProvider, { label: string; description: string }> = {
  none: {
    label: 'No official data layer',
    description: 'Keep the starter transport-focused and add your database wiring later.',
  },
  drizzle: {
    label: 'Drizzle',
    description: 'SQL-first ORM integration with official Rasono data session support.',
  },
  kysely: {
    label: 'Kysely',
    description: 'Query-builder-first integration with strong multi-database coverage.',
  },
  engine: {
    label: 'Rasono Engine',
    description: 'Official proprietary provider for Turso-focused Engine workloads.',
  },
};

const DATA_PROVIDER_DATABASES: Record<Exclude<DataProvider, 'none'>, DatabaseKind[]> = {
  drizzle: ['postgres', 'mysql', 'sqlite', 'turso'],
  kysely: ['postgres', 'mysql', 'sqlite', 'mssql'],
  engine: ['turso'],
};

function renderFileHeader(description: string): string {
  return `/**\n * ${description}\n */\n`;
}

let promptInterface: ReturnType<typeof createInterface> | undefined;

function getPromptInterface() {
  if (!promptInterface) {
    promptInterface = createInterface({ input, output });
  }
  return promptInterface;
}

function closePromptInterface(): void {
  promptInterface?.close();
  promptInterface = undefined;
}

function isInteractiveTerminal(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

function hasExplicitFeatureFlags(args: ParsedArgs): boolean {
  return (
    args.includeApi !== undefined &&
    args.includeWeb !== undefined &&
    args.includeActions !== undefined &&
    args.includeSwagger !== undefined &&
    args.includeRpc !== undefined
  );
}

function inferIncludeApi(args: ParsedArgs): boolean | undefined {
  if (args.includeApi !== undefined) return args.includeApi;
  if (args.preset && args.preset !== 'custom') {
    return PRESET_DEFINITIONS[args.preset].defaults.includeApi;
  }
  return undefined;
}

function hasExplicitDataFlags(args: ParsedArgs, includeApi: boolean): boolean {
  if (!includeApi) return true;
  if (args.dataProvider === undefined) return false;
  if (args.dataProvider === 'none') return args.database === undefined;
  return args.database !== undefined;
}

function needsInteractivePrompt(args: ParsedArgs): boolean {
  const skipPrompts = args.yes && !args.interactive;
  if (skipPrompts) {
    return false;
  }

  if (!args.targetProvided || !args.pm || args.installDependencies === undefined || !args.preset) {
    return true;
  }

  if (args.preset === 'custom') {
    return !hasExplicitFeatureFlags(args);
  }

  if (!hasExplicitFeatureFlags(args)) {
    return true;
  }

  const includeApi = inferIncludeApi(args);
  if (includeApi === undefined) {
    return true;
  }

  return !hasExplicitDataFlags(args, includeApi);
}

function normalizePreset(value: string | undefined): AppPreset | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'landing' || normalized === 'landing-page' || normalized === 'marketing') return 'landing-page';
  if (normalized === 'api' || normalized === 'api-only') return 'api-only';
  if (normalized === 'crud' || normalized === 'simple-crud') return 'simple-crud';
  if (normalized === 'full' || normalized === 'full-app') return 'full-app';
  if (normalized === 'custom') return 'custom';
  throw new Error(`Unknown preset: ${value}`);
}

function normalizeDataProvider(value: string | undefined): DataProvider | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'none' || normalized === 'off' || normalized === 'disabled') return 'none';
  if (normalized === 'drizzle') return 'drizzle';
  if (normalized === 'kysely') return 'kysely';
  if (normalized === 'engine' || normalized === 'rasono-engine') return 'engine';
  throw new Error(`Unknown data provider: ${value}`);
}

function normalizeDatabase(value: string | undefined): DatabaseKind | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'postgres' || normalized === 'postgresql' || normalized === 'pg') return 'postgres';
  if (normalized === 'mysql' || normalized === 'mariadb') return 'mysql';
  if (normalized === 'sqlite') return 'sqlite';
  if (normalized === 'mssql' || normalized === 'sqlserver' || normalized === 'sql-server') return 'mssql';
  if (normalized === 'turso' || normalized === 'libsql') return 'turso';
  throw new Error(`Unknown database: ${value}`);
}

function supportsDatabase(provider: DataProvider, database: DatabaseKind): boolean {
  if (provider === 'none') return false;
  return DATA_PROVIDER_DATABASES[provider].includes(database);
}

function resolveDefaultDatabase(provider: Exclude<DataProvider, 'none'>): DatabaseKind {
  return provider === 'engine' ? 'turso' : 'postgres';
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const parsed: ParsedArgs = {
    targetProvided: false,
    yes: false,
    interactive: false,
  };
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === '-y') {
      parsed.yes = true;
      continue;
    }
    if (arg === '-h') {
      parsed.target = '__help__';
      parsed.targetProvided = true;
      return parsed;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--no-install') {
      parsed.installDependencies = false;
      continue;
    }
    if (arg === '--install') {
      parsed.installDependencies = true;
      continue;
    }
    if (arg === '--yes') {
      parsed.yes = true;
      continue;
    }
    if (arg === '--interactive') {
      parsed.interactive = true;
      continue;
    }
    if (arg === '--help') {
      parsed.preset = undefined;
      positionals.push('__help__');
      continue;
    }
    if (arg.startsWith('--pm=')) {
      parsed.pm = arg.split('=')[1] as PackageManager | undefined;
      continue;
    }
    if (arg.startsWith('--preset=') || arg.startsWith('--type=') || arg.startsWith('--kind=')) {
      parsed.preset = normalizePreset(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--data=')) {
      parsed.dataProvider = normalizeDataProvider(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--orm=')) {
      parsed.dataProvider = normalizeDataProvider(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--database=')) {
      parsed.database = normalizeDatabase(arg.split('=')[1]);
      continue;
    }
    if (arg === '--api' || arg === '--with-api') {
      parsed.includeApi = true;
      continue;
    }
    if (arg === '--no-api') {
      parsed.includeApi = false;
      continue;
    }
    if (arg === '--web' || arg === '--with-web') {
      parsed.includeWeb = true;
      continue;
    }
    if (arg === '--no-web') {
      parsed.includeWeb = false;
      continue;
    }
    if (arg === '--actions' || arg === '--with-actions') {
      parsed.includeActions = true;
      continue;
    }
    if (arg === '--no-actions') {
      parsed.includeActions = false;
      continue;
    }
    if (arg === '--swagger' || arg === '--with-swagger') {
      parsed.includeSwagger = true;
      continue;
    }
    if (arg === '--no-swagger') {
      parsed.includeSwagger = false;
      continue;
    }
    if (arg === '--rpc' || arg === '--with-rpc') {
      parsed.includeRpc = true;
      continue;
    }
    if (arg === '--no-rpc') {
      parsed.includeRpc = false;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }

  if (positionals.length > 0) {
    if (positionals[0] === '__help__') {
      parsed.target = '__help__';
      parsed.targetProvided = true;
      return parsed;
    }
    parsed.target = positionals[0]!;
    parsed.targetProvided = true;
  }
  return parsed;
}

function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('pnpm/')) return 'pnpm';
  if (ua.startsWith('yarn/')) return 'yarn';
  if (ua.startsWith('bun/')) return 'bun';
  return 'npm';
}

function assertSafeTargetDir(input: string): void {
  if (input.includes('\0')) throw new Error('Invalid target directory');
  if (input.startsWith('/') || input.startsWith('~')) throw new Error('Target directory must be relative');
  if (input.split(/[\\/]/g).some((p) => p === '..')) throw new Error('Target directory must not contain ..');
}

function toPackageName(dirName: string): string {
  const base = dirName.split(/[\\/]/g).filter(Boolean).pop() ?? 'rasono-app';
  const normalized = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_.]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized : 'rasono-app';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeText(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, 'utf8');
}

async function patchPackageJson(path: string, patch: (pkg: any) => any): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const pkg = JSON.parse(raw);
  const next = patch(pkg);
  await writeJson(path, next);
}

function applyPackageSpecs(deps: Record<string, string> | undefined, specs: Record<string, string>): Record<string, string> | undefined {
  if (!deps) return deps;
  const next = { ...deps };
  for (const [name, spec] of Object.entries(specs)) {
    if (name in next) {
      next[name] = spec;
    }
  }
  return next;
}

function mergeDeps(deps: Record<string, string> | undefined, additions: Record<string, string>): Record<string, string> | undefined {
  const next = { ...(deps ?? {}) };
  for (const [name, spec] of Object.entries(additions)) {
    next[name] = spec;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function removeDeps(deps: Record<string, string> | undefined, names: string[]): Record<string, string> | undefined {
  if (!deps) return deps;
  const next = { ...deps };
  for (const name of names) delete next[name];
  return Object.keys(next).length > 0 ? next : undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function removeIfExists(path: string): Promise<void> {
  if (!(await exists(path))) return;
  await rm(path, { recursive: true, force: true });
}

async function resolveLocalRasonoSpecs(outDir: string, packageRoot: string): Promise<{
  rootSpecs: Record<string, string>;
  apiSpecs: Record<string, string>;
  webSpecs: Record<string, string>;
} | null> {
  const packagesDir = resolve(packageRoot, '..');
  const required = await Promise.all(
    Object.values(RASONO_PACKAGE_DIRS).map((dirName) => pathExists(resolve(packagesDir, dirName, 'package.json'))),
  );
  if (required.some((ok) => !ok)) {
    return null;
  }

  const rootSpecs: Record<string, string> = {};
  const apiSpecs: Record<string, string> = {};
  const webSpecs: Record<string, string> = {};

  for (const [name, dirName] of Object.entries(RASONO_PACKAGE_DIRS)) {
    const packageDir = resolve(packagesDir, dirName);
    rootSpecs[name] = `file:${relative(outDir, packageDir)}`;
    apiSpecs[name] = `file:${relative(resolve(outDir, 'apps/api'), packageDir)}`;
    webSpecs[name] = `file:${relative(resolve(outDir, 'apps/web'), packageDir)}`;
  }

  return { rootSpecs, apiSpecs, webSpecs };
}

async function patchAppPackages(outDir: string, packageRoot: string): Promise<void> {
  const localSpecs = await resolveLocalRasonoSpecs(outDir, packageRoot);
  const apiSpecs = localSpecs?.apiSpecs ?? {};
  const webSpecs = localSpecs?.webSpecs ?? {};
  const versionSpecs = Object.fromEntries(
    Object.keys(RASONO_PACKAGE_DIRS).map((name) => [name, RASONO_VERSION]),
  ) as Record<string, string>;

  const apiPkg = resolve(outDir, 'apps/api/package.json');
  const webPkg = resolve(outDir, 'apps/web/package.json');

  if (await exists(apiPkg)) {
    await patchPackageJson(apiPkg, (pkg) => ({
      ...pkg,
      dependencies: applyPackageSpecs(pkg.dependencies, localSpecs ? apiSpecs : versionSpecs),
      devDependencies: applyPackageSpecs(pkg.devDependencies, localSpecs ? apiSpecs : versionSpecs),
    }));
  }

  if (await exists(webPkg)) {
    await patchPackageJson(webPkg, (pkg) => ({
      ...pkg,
      dependencies: applyPackageSpecs(pkg.dependencies, localSpecs ? webSpecs : versionSpecs),
      devDependencies: applyPackageSpecs(pkg.devDependencies, localSpecs ? webSpecs : versionSpecs),
    }));
  }

  if (!localSpecs) {
    return;
  }

  await patchPackageJson(resolve(outDir, 'package.json'), (pkg) => ({
    ...pkg,
    overrides: {
      ...(pkg.overrides ?? {}),
      ...localSpecs.rootSpecs,
    },
    pnpm: {
      ...(pkg.pnpm ?? {}),
      overrides: {
        ...(pkg.pnpm?.overrides ?? {}),
        ...localSpecs.rootSpecs,
      },
    },
    resolutions: {
      ...(pkg.resolutions ?? {}),
      ...localSpecs.rootSpecs,
    },
  }));
}

function run(pm: PackageManager, cwd: string): Promise<void> {
  const cmd = pm;
  const args = pm === 'npm' ? ['install'] : ['install'];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('exit', (code: number | null) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${pm} install failed (exit ${code})`));
    });
    child.on('error', reject);
  });
}

async function ask(question: string): Promise<string> {
  return (await getPromptInterface().question(question)).trim();
}

async function askYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
  const answer = (await ask(`${question}${suffix}`)).toLowerCase();
  if (answer === '') return defaultValue;
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no') return false;
  throw new Error(`Invalid answer: ${answer}`);
}

async function promptTargetDirectory(defaultTarget: string): Promise<string> {
  const answer = await ask(`Project directory [${defaultTarget}]: `);
  return answer === '' ? defaultTarget : answer;
}

async function promptPackageManager(defaultPm: PackageManager): Promise<PackageManager> {
  output.write('\nChoose a package manager:\n');
  output.write('- 1. npm\n');
  output.write('- 2. pnpm\n');
  output.write('- 3. yarn\n');
  output.write('- 4. bun\n');
  const answer = await ask(`Package manager [${defaultPm}]: `);
  const value = answer === '' ? defaultPm : answer.trim().toLowerCase();
  if (value === '1' || value === 'npm') return 'npm';
  if (value === '2' || value === 'pnpm') return 'pnpm';
  if (value === '3' || value === 'yarn') return 'yarn';
  if (value === '4' || value === 'bun') return 'bun';
  throw new Error(`Unknown package manager: ${answer}`);
}

async function promptPreset(target: string): Promise<AppPreset> {
  output.write(`\nRasono - create-rasono\n\nTarget directory: ${target}\n\nChoose a starter preset:\n`);
  const options: Array<{ key: AppPreset; label: string; description: string }> = [
    { key: 'landing-page', label: '1. Landing Page', description: PRESET_DEFINITIONS['landing-page'].description },
    { key: 'api-only', label: '2. API Only', description: PRESET_DEFINITIONS['api-only'].description },
    { key: 'simple-crud', label: '3. Simple CRUD', description: PRESET_DEFINITIONS['simple-crud'].description },
    { key: 'full-app', label: '4. Full App', description: PRESET_DEFINITIONS['full-app'].description },
    { key: 'custom', label: '5. Custom', description: 'Choose Web, API, Swagger, server actions, and RPC step by step.' },
  ];
  for (const option of options) {
    output.write(`- ${option.label}\n  ${option.description}\n`);
  }
  const answer = await ask('\nPreset [4]: ');
  const value = answer === '' ? '4' : answer;
  if (value === '1') return 'landing-page';
  if (value === '2') return 'api-only';
  if (value === '3') return 'simple-crud';
  if (value === '4') return 'full-app';
  if (value === '5') return 'custom';
  return normalizePreset(value) ?? 'full-app';
}

async function promptCustomConfig(): Promise<ScaffoldConfig> {
  output.write('\nCustom mode\n');
  output.write('- Web: Rasengan UI with file-based pages.\n');
  output.write('- API: Hono + createApp() with file-based routes.\n');
  output.write('- Swagger: interactive API documentation UI.\n');
  output.write('- Server actions: generated POST endpoints from src/actions.\n');
  output.write('- RPC: generated Web client from API routes.\n\n');

  const includeWeb = await askYesNo('Include a Web app?', true);
  const includeApi = await askYesNo('Include an API app?', true);
  if (!includeWeb && !includeApi) {
    throw new Error('The custom starter must include at least one app (Web or API).');
  }

  const includeSwagger = includeApi ? await askYesNo('Include Swagger UI for the API?', true) : false;
  const includeActions = includeApi ? await askYesNo('Include server actions?', false) : false;
  const includeRpc = includeWeb && includeApi ? await askYesNo('Include the generated RPC client in the Web app?', true) : false;

  return {
    preset: 'custom',
    includeApi,
    includeWeb,
    includeActions,
    includeSwagger,
    includeRpc,
    dataProvider: 'none',
  };
}

async function promptFeatureConfig(base: ScaffoldConfig): Promise<ScaffoldConfig> {
  output.write('\nFeature selection\n');
  const includeWeb = await askYesNo('Include a Web app?', base.includeWeb);
  const includeApi = await askYesNo('Include an API app?', base.includeApi);
  if (!includeWeb && !includeApi) {
    throw new Error('The starter must include at least one app (Web or API).');
  }

  const includeSwagger = includeApi ? await askYesNo('Include Swagger UI for the API?', base.includeSwagger) : false;
  const includeActions = includeApi ? await askYesNo('Include server actions?', base.includeActions) : false;
  const includeRpc = includeApi && includeWeb ? await askYesNo('Include the generated RPC client in the Web app?', base.includeRpc) : false;

  return {
    preset: base.preset,
    includeApi,
    includeWeb,
    includeActions,
    includeSwagger,
    includeRpc,
    dataProvider: base.dataProvider,
    database: base.database,
  };
}

function resolvePresetDefaults(preset: Exclude<AppPreset, 'custom'>): ScaffoldConfig {
  return { preset, ...PRESET_DEFINITIONS[preset].defaults, dataProvider: 'none' };
}

async function promptDataProvider(): Promise<DataProvider> {
  output.write('\nData layer selection\n');
  output.write(`- 1. None\n  ${DATA_PROVIDER_CHOICES.none.description}\n`);
  output.write(`- 2. Drizzle\n  ${DATA_PROVIDER_CHOICES.drizzle.description}\n`);
  output.write(`- 3. Kysely\n  ${DATA_PROVIDER_CHOICES.kysely.description}\n`);
  output.write(`- 4. Rasono Engine\n  ${DATA_PROVIDER_CHOICES.engine.description}\n`);
  const answer = await ask('Data provider [1]: ');
  const value = answer === '' ? '1' : answer.trim().toLowerCase();
  if (value === '1' || value === 'none') return 'none';
  if (value === '2' || value === 'drizzle') return 'drizzle';
  if (value === '3' || value === 'kysely') return 'kysely';
  if (value === '4' || value === 'engine' || value === 'rasono-engine') return 'engine';
  return normalizeDataProvider(value) ?? 'none';
}

async function promptDatabase(provider: Exclude<DataProvider, 'none'>): Promise<DatabaseKind> {
  const supported = DATA_PROVIDER_DATABASES[provider];
  const defaultDatabase = resolveDefaultDatabase(provider);
  output.write(`\nChoose a database for ${DATA_PROVIDER_CHOICES[provider].label}:\n`);
  supported.forEach((database, index) => {
    const descriptions: Record<DatabaseKind, string> = {
      postgres: 'General-purpose relational default with first-class production support.',
      mysql: 'Widely deployed relational option for traditional MySQL or MariaDB stacks.',
      sqlite: 'Local embedded SQLite for lightweight and low-ops deployments.',
      mssql: 'Microsoft SQL Server for enterprise environments and existing estates.',
      turso: 'Serverless libSQL/Turso setup for remote or sync-friendly SQLite workloads.',
    };
    output.write(`- ${index + 1}. ${database}\n  ${descriptions[database]}\n`);
  });
  const answer = await ask(`Database [${defaultDatabase}]: `);
  const normalized = answer === '' ? defaultDatabase : normalizeDatabase(answer);
  if (!normalized || !supportsDatabase(provider, normalized)) {
    throw new Error(`Unsupported database for ${provider}: ${answer || defaultDatabase}`);
  }
  return normalized;
}

async function resolveDataConfig(args: ParsedArgs, config: ScaffoldConfig): Promise<Pick<ScaffoldConfig, 'dataProvider' | 'database'>> {
  if (!config.includeApi) {
    if (args.dataProvider || args.database) {
      throw new Error('Data layer flags require an API app. Remove --data/--database or enable the API starter.');
    }
    return { dataProvider: 'none' };
  }
  if (args.database && !args.dataProvider) {
    throw new Error('Use --data=<provider> together with --database=<kind>.');
  }

  const provider = args.dataProvider ?? (args.yes ? 'none' : await promptDataProvider());
  if (provider === 'none') {
    if (args.database) {
      throw new Error('Database selection is only valid when a data provider is enabled.');
    }
    return { dataProvider: 'none' };
  }

  const database = args.database ?? (args.yes ? resolveDefaultDatabase(provider) : await promptDatabase(provider));
  if (!supportsDatabase(provider, database)) {
    throw new Error(`Unsupported database for ${provider}: ${database}`);
  }

  return { dataProvider: provider, database };
}

async function resolveScaffoldConfig(args: ParsedArgs, target: string): Promise<ScaffoldConfig> {
  const requestedPreset = args.preset ?? (args.yes ? 'full-app' : await promptPreset(target));

  let base =
    requestedPreset === 'custom'
      ? args.yes
        ? {
            preset: 'custom' as const,
            includeApi: true,
            includeWeb: true,
            includeActions: false,
            includeSwagger: true,
            includeRpc: true,
            dataProvider: 'none' as const,
          }
        : hasExplicitFeatureFlags(args)
          ? {
              preset: 'custom' as const,
              includeApi: true,
              includeWeb: true,
              includeActions: false,
              includeSwagger: true,
              includeRpc: true,
              dataProvider: 'none' as const,
            }
          : await promptCustomConfig()
      : resolvePresetDefaults(requestedPreset);

  if (!args.yes && requestedPreset !== 'custom' && !hasExplicitFeatureFlags(args)) {
    base = await promptFeatureConfig(base);
  }

  const merged: ScaffoldConfig = {
    preset: base.preset,
    includeApi: args.includeApi ?? base.includeApi,
    includeWeb: args.includeWeb ?? base.includeWeb,
    includeActions: args.includeActions ?? base.includeActions,
    includeSwagger: args.includeSwagger ?? base.includeSwagger,
    includeRpc: args.includeRpc ?? base.includeRpc,
    dataProvider: base.dataProvider,
    database: base.database,
  };

  if (!merged.includeApi && !merged.includeWeb) {
    throw new Error('The starter must include at least one app: use --api, --web, or a suitable preset.');
  }
  if (!merged.includeApi) {
    merged.includeActions = false;
    merged.includeSwagger = false;
  }
  if (!(merged.includeApi && merged.includeWeb)) {
    merged.includeRpc = false;
  }

  return {
    ...merged,
    ...(await resolveDataConfig(args, merged)),
  };
}

function getDataDependencyPatch(config: ScaffoldConfig): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  if (config.dataProvider === 'none') {
    return { dependencies: {}, devDependencies: {} };
  }

  const dependencies: Record<string, string> = {
    '@rasono/data': RASONO_VERSION,
  };
  const devDependencies: Record<string, string> = {};

  if (config.dataProvider === 'drizzle') {
    dependencies['@rasono/data-drizzle'] = RASONO_VERSION;
    dependencies['drizzle-orm'] = 'latest';
    if (config.database === 'postgres') {
      dependencies.pg = 'latest';
      devDependencies['@types/pg'] = 'latest';
    } else if (config.database === 'mysql') {
      dependencies.mysql2 = 'latest';
    } else if (config.database === 'sqlite') {
      dependencies['better-sqlite3'] = 'latest';
      devDependencies['@types/better-sqlite3'] = 'latest';
    } else if (config.database === 'turso') {
      dependencies['@libsql/client'] = 'latest';
    }
    return { dependencies, devDependencies };
  }

  if (config.dataProvider === 'kysely') {
    dependencies['@rasono/data-kysely'] = RASONO_VERSION;
    dependencies.kysely = 'latest';
    if (config.database === 'postgres') {
      dependencies.pg = 'latest';
      devDependencies['@types/pg'] = 'latest';
    } else if (config.database === 'mysql') {
      dependencies.mysql2 = 'latest';
    } else if (config.database === 'sqlite') {
      dependencies['better-sqlite3'] = 'latest';
      devDependencies['@types/better-sqlite3'] = 'latest';
    } else if (config.database === 'mssql') {
      dependencies.tedious = 'latest';
      dependencies.tarn = 'latest';
      devDependencies['@types/tedious'] = 'latest';
    }
    return { dependencies, devDependencies };
  }

  dependencies['@rasono/data-engine'] = RASONO_VERSION;
  dependencies['@libsql/client'] = 'latest';
  return { dependencies, devDependencies };
}

function renderApiIndex(config: ScaffoldConfig): string {
  const lines: string[] = [];
  lines.push(renderFileHeader('This file boots the API runtime, loads validated configuration, and wires the generated module routes.').trimEnd());
  lines.push("import { serve } from '@hono/node-server';");
  lines.push("import { createApp } from '@rasono/app';");
  lines.push("import { composePrincipalResolvers, createApiKeyPrincipalResolver, createBearerPrincipalResolver, createSessionPrincipalResolver } from '@rasono/auth';");
  lines.push("import { createHonoAdapter } from '@rasono/hono';");
  lines.push("import { apiConfig, type ApiRuntimeDeps } from './config.js';");
  lines.push("import { createReferenceAuthService } from './modules/auth/auth.service.js';");
  lines.push("import { appModules } from './modules/index.js';");
  if (config.includeSwagger) lines.push("import { installSwaggerUi } from '@rasono/swagger';");
  if (config.includeActions) lines.push("import { installGeneratedActions } from './.rasono/actions.generated.js';");
  lines.push("import { installGeneratedApi, installGeneratedDocs } from './.rasono/api.generated.js';");
  lines.push('');
  lines.push('type Deps = ApiRuntimeDeps;');
  lines.push('');
  lines.push('const deps: Deps = {');
  lines.push('  authService: createReferenceAuthService(apiConfig.referenceAuth),');
  lines.push('};');
  lines.push('const app = createApp({');
  lines.push('  deps,');
  lines.push('  modules: appModules,');
  lines.push('  resolvePrincipal: composePrincipalResolvers([');
  lines.push('    createBearerPrincipalResolver({');
  lines.push('      verifyToken: (token, { deps: requestDeps }) => requestDeps.authService.verifyBearerToken(token),');
  lines.push('    }),');
  lines.push('    createApiKeyPrincipalResolver({');
  lines.push('      verifyKey: (apiKey, { deps: requestDeps }) => requestDeps.authService.verifyApiKey(apiKey),');
  lines.push('    }),');
  lines.push('    createSessionPrincipalResolver({');
  lines.push('      cookieName: apiConfig.referenceAuth.sessionCookieName,');
  lines.push('      verifySession: (sessionToken, { deps: requestDeps }) => requestDeps.authService.verifySessionToken(sessionToken),');
  lines.push('    }),');
  lines.push('  ]),');
  lines.push('  transport: {');
  lines.push('    adapter: createHonoAdapter(),');
  lines.push('    options: {');
  lines.push('      rateLimit: {');
  lines.push('        enabled: true,');
  lines.push('        limit: 300,');
  lines.push('        windowMs: 60_000,');
  lines.push('        trustProxy: false,');
  lines.push('      },');
  lines.push('    },');
  lines.push('  },');
  lines.push('});');
  lines.push('await app.ready;');
  lines.push('');
  lines.push('let closing = false;');
  lines.push('const closeApp = async () => {');
  lines.push('  if (closing) return;');
  lines.push('  closing = true;');
  lines.push('  await app.close();');
  lines.push('};');
  lines.push('');
  lines.push('installGeneratedApi(app);');
  if (config.includeActions) lines.push('installGeneratedActions(app);');
  lines.push('installGeneratedDocs(app, { title: apiConfig.appName, version: apiConfig.appVersion }, { docPath: apiConfig.docPath });');
  if (config.includeSwagger) lines.push("installSwaggerUi(app, { uiPath: apiConfig.swaggerPath, docPath: apiConfig.docPath, title: `${apiConfig.appName} Docs` });");
  lines.push('');
  lines.push("app.get('/health', () => new Response(JSON.stringify({ ok: true, service: apiConfig.appName, version: apiConfig.appVersion }), { headers: { 'content-type': 'application/json' } }));");
  lines.push('');
  lines.push('serve({ fetch: app.fetch, port: apiConfig.port }, (info: { port: number }) => {');
  lines.push("  console.log(`API listening on http://localhost:${info.port}`);");
  lines.push('});');
  lines.push('');
  lines.push("process.once('SIGINT', () => {");
  lines.push('  void closeApp().finally(() => process.exit(0));');
  lines.push('});');
  lines.push('');
  lines.push("process.once('SIGTERM', () => {");
  lines.push('  void closeApp().finally(() => process.exit(0));');
  lines.push('});');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderApiConfig(): string {
  return `${renderFileHeader('This file validates runtime environment variables and exposes the API configuration used by the starter.')}type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ReferenceAuthConfig = {
  adminBearerToken?: string;
  serviceApiKey?: string;
  sessionToken?: string;
  sessionCookieName: string;
  adminRole: string;
  serviceRole: string;
  sessionRole: string;
  adminTenantId: string;
  serviceTenantId: string;
  sessionTenantId: string;
};

export type ApiRuntimeConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  appName: string;
  appVersion: string;
  port: number;
  docPath: string;
  swaggerPath: string;
  logLevel: LogLevel;
  referenceAuth: ReferenceAuthConfig;
};

export type ApiRuntimeDeps = {
  authService: {
    verifyBearerToken: (token: string) => { sub: string; roles: string[]; tenantId: string } | undefined | Promise<{ sub: string; roles: string[]; tenantId: string } | undefined>;
    verifyApiKey: (apiKey: string) => { sub: string; roles: string[]; tenantId: string } | undefined | Promise<{ sub: string; roles: string[]; tenantId: string } | undefined>;
    verifySessionToken: (sessionToken: string) => { sub: string; roles: string[]; tenantId: string } | undefined | Promise<{ sub: string; roles: string[]; tenantId: string } | undefined>;
  };
};

function readString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function readOptionalString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(\`Invalid \${key}: expected an integer between 1 and 65535\`);
  }
  return value;
}

function readLogLevel(env: NodeJS.ProcessEnv, key: string, fallback: LogLevel): LogLevel {
  const value = env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') return value;
  throw new Error(\`Invalid \${key}: expected debug, info, warn, or error\`);
}

function readPath(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = readString(env, key, fallback);
  if (!value.startsWith('/')) {
    throw new Error(\`Invalid \${key}: expected a path starting with "/"\`);
  }
  return value;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const nodeEnv = readString(env, 'NODE_ENV', 'development');
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('Invalid NODE_ENV: expected development, test, or production');
  }

  return {
    nodeEnv,
    appName: readString(env, 'RASONO_APP_NAME', 'Rasono API'),
    appVersion: readString(env, 'RASONO_APP_VERSION', '0.1.0'),
    port: readPort(env, 'PORT', 3000),
    docPath: readPath(env, 'RASONO_DOC_PATH', '/doc'),
    swaggerPath: readPath(env, 'RASONO_SWAGGER_PATH', '/docs'),
    logLevel: readLogLevel(env, 'RASONO_LOG_LEVEL', 'info'),
    referenceAuth: {
      adminBearerToken: readOptionalString(env, 'RASONO_ADMIN_BEARER_TOKEN'),
      serviceApiKey: readOptionalString(env, 'RASONO_SERVICE_API_KEY'),
      sessionToken: readOptionalString(env, 'RASONO_SESSION_TOKEN'),
      sessionCookieName: readString(env, 'RASONO_SESSION_COOKIE_NAME', 'session'),
      adminRole: readString(env, 'RASONO_ADMIN_ROLE', 'admin'),
      serviceRole: readString(env, 'RASONO_SERVICE_ROLE', 'service'),
      sessionRole: readString(env, 'RASONO_SESSION_ROLE', 'user'),
      adminTenantId: readString(env, 'RASONO_ADMIN_TENANT_ID', 'tenant-admin'),
      serviceTenantId: readString(env, 'RASONO_SERVICE_TENANT_ID', 'tenant-service'),
      sessionTenantId: readString(env, 'RASONO_SESSION_TENANT_ID', 'tenant-user'),
    },
  };
}

export const apiConfig = loadApiConfig();
`;
}

function renderDataIndex(config: ScaffoldConfig): string {
  if (config.dataProvider === 'drizzle' && config.database === 'postgres') {
    return `${renderFileHeader('This file wires the selected Drizzle + PostgreSQL starter integration without forcing the rest of the framework to depend on one database choice.')}import { createDrizzleDataAdapter } from '@rasono/data-drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rasono',
});

export const db = drizzle({ client: pool });

export const dataAdapter = createDrizzleDataAdapter({
  name: 'drizzle-postgres',
  client: db,
  transactionOptions: {
    isolationLevel: 'serializable',
  },
});
`;
  }

  if (config.dataProvider === 'drizzle' && config.database === 'mysql') {
    return `${renderFileHeader('This file wires the selected Drizzle + MySQL starter integration while keeping the framework data layer adapter-first and provider-neutral.')}import { createDrizzleDataAdapter } from '@rasono/data-drizzle';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL ?? 'mysql://root:password@127.0.0.1:3306/rasono',
});

export const db = drizzle({ client: pool });

export const dataAdapter = createDrizzleDataAdapter({
  name: 'drizzle-mysql',
  client: db,
});
`;
  }

  if (config.dataProvider === 'drizzle' && config.database === 'sqlite') {
    return `${renderFileHeader('This file wires the selected Drizzle + SQLite starter integration for local embedded storage without turning Rasono into an ORM-owned framework.')}import { createDrizzleDataAdapter } from '@rasono/data-drizzle';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const sqlite = new Database(process.env.DATABASE_FILE ?? './local.db');

export const db = drizzle(sqlite);

export const dataAdapter = createDrizzleDataAdapter({
  name: 'drizzle-sqlite',
  client: db,
});
`;
  }

  if (config.dataProvider === 'drizzle' && config.database === 'turso') {
    return `${renderFileHeader('This file wires the selected Drizzle + Turso starter integration so teams can use Turso without being forced onto the proprietary Engine provider.')}import { createClient } from '@libsql/client';
import { createDrizzleDataAdapter } from '@rasono/data-drizzle';
import { drizzle } from 'drizzle-orm/libsql';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'libsql://your-database.turso.io',
  ...(process.env.TURSO_AUTH_TOKEN ? { authToken: process.env.TURSO_AUTH_TOKEN } : {}),
});

export const db = drizzle(client);

export const dataAdapter = createDrizzleDataAdapter({
  name: 'drizzle-turso',
  client: db,
});
`;
  }

  if (config.dataProvider === 'kysely' && config.database === 'postgres') {
    return `${renderFileHeader('This file wires the selected Kysely + PostgreSQL starter integration with explicit dialect setup and no ORM lock-in.')}import { createKyselyDataAdapter } from '@rasono/data-kysely';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

type Database = Record<string, never>;

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rasono',
    }),
  }),
});

export const dataAdapter = createKyselyDataAdapter({
  name: 'kysely-postgres',
  client: db,
  isolationLevel: 'serializable',
});
`;
  }

  if (config.dataProvider === 'kysely' && config.database === 'mysql') {
    return `${renderFileHeader('This file wires the selected Kysely + MySQL starter integration while preserving Kysely dialect control and Rasono neutrality.')}import { createKyselyDataAdapter } from '@rasono/data-kysely';
import { Kysely, MysqlDialect } from 'kysely';
import mysql from 'mysql2';

type Database = Record<string, never>;

export const db = new Kysely<Database>({
  dialect: new MysqlDialect({
    pool: mysql.createPool({
      uri: process.env.DATABASE_URL ?? 'mysql://root:password@127.0.0.1:3306/rasono',
    }),
  }),
});

export const dataAdapter = createKyselyDataAdapter({
  name: 'kysely-mysql',
  client: db,
});
`;
  }

  if (config.dataProvider === 'kysely' && config.database === 'sqlite') {
    return `${renderFileHeader('This file wires the selected Kysely + SQLite starter integration for embedded deployments with minimal operational overhead.')}import { createKyselyDataAdapter } from '@rasono/data-kysely';
import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';

type DatabaseShape = Record<string, never>;

export const db = new Kysely<DatabaseShape>({
  dialect: new SqliteDialect({
    database: new Database(process.env.DATABASE_FILE ?? './local.db'),
  }),
});

export const dataAdapter = createKyselyDataAdapter({
  name: 'kysely-sqlite',
  client: db,
});
`;
  }

  if (config.dataProvider === 'kysely' && config.database === 'mssql') {
    return `${renderFileHeader('This file wires the selected Kysely + MSSQL starter integration for SQL Server environments that still want a thin, explicit data story.')}import { createKyselyDataAdapter } from '@rasono/data-kysely';
import { Kysely, MssqlDialect } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';

type Database = Record<string, never>;

export const db = new Kysely<Database>({
  dialect: new MssqlDialect({
    tarn: {
      ...Tarn,
      options: {
        min: 0,
        max: 10,
      },
    },
    tedious: {
      ...Tedious,
      connectionFactory: () =>
        new Tedious.Connection({
          server: process.env.MSSQL_HOST ?? '127.0.0.1',
          authentication: {
            type: 'default',
            options: {
              userName: process.env.MSSQL_USER ?? 'sa',
              password: process.env.MSSQL_PASSWORD ?? 'YourStrong!Passw0rd',
            },
          },
          options: {
            database: process.env.MSSQL_DATABASE ?? 'rasono',
            port: Number(process.env.MSSQL_PORT ?? '1433'),
            trustServerCertificate: true,
          },
        }),
    },
  }),
});

export const dataAdapter = createKyselyDataAdapter({
  name: 'kysely-mssql',
  client: db,
});
`;
  }

  return `${renderFileHeader("This file wires the selected proprietary Engine + Turso starter integration while keeping the rest of the framework neutral to the user's ORM and database choices.")}import { createClient } from '@libsql/client';
import { createEngineClientFactory, createEngineDataAdapter } from '@rasono/data-engine';

export const dataAdapter = createEngineDataAdapter({
  name: 'engine-turso',
  client: createEngineClientFactory(createClient, {
    url: process.env.TURSO_DATABASE_URL ?? 'libsql://your-database.turso.io',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
  transactionMode: 'write',
});
`;
}

function renderApiEnvExample(config: ScaffoldConfig): string {
  const lines = [
    '# Starter runtime configuration',
    'PORT=3000',
    'RASONO_APP_NAME=Rasono API',
    'RASONO_APP_VERSION=0.1.0',
    'RASONO_DOC_PATH=/doc',
    'RASONO_SWAGGER_PATH=/docs',
    'RASONO_LOG_LEVEL=info',
    '',
    '# Reference auth tokens',
    'RASONO_ADMIN_BEARER_TOKEN=dev-admin-token',
    'RASONO_SERVICE_API_KEY=dev-service-key',
    'RASONO_SESSION_TOKEN=dev-session-token',
    'RASONO_SESSION_COOKIE_NAME=session',
    'RASONO_ADMIN_ROLE=admin',
    'RASONO_SERVICE_ROLE=service',
    'RASONO_SESSION_ROLE=user',
    'RASONO_ADMIN_TENANT_ID=tenant-admin',
    'RASONO_SERVICE_TENANT_ID=tenant-service',
    'RASONO_SESSION_TENANT_ID=tenant-user',
  ];

  if (config.dataProvider !== 'none') {
    lines.push('', '# Data layer selection');
    lines.push(`RASONO_DATA_PROVIDER=${config.dataProvider}`);
    lines.push(`RASONO_DATABASE_KIND=${config.database}`);
    if (config.database === 'postgres') {
      lines.push('DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/rasono');
    } else if (config.database === 'mysql') {
      lines.push('DATABASE_URL=mysql://root:password@127.0.0.1:3306/rasono');
    } else if (config.database === 'sqlite') {
      lines.push('DATABASE_FILE=./local.db');
    } else if (config.database === 'mssql') {
      lines.push('MSSQL_HOST=127.0.0.1');
      lines.push('MSSQL_PORT=1433');
      lines.push('MSSQL_DATABASE=rasono');
      lines.push('MSSQL_USER=sa');
      lines.push('MSSQL_PASSWORD=YourStrong!Passw0rd');
    } else if (config.database === 'turso') {
      lines.push('TURSO_DATABASE_URL=libsql://your-database.turso.io');
      lines.push('TURSO_AUTH_TOKEN=replace-me');
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderModulesIndex(config: ScaffoldConfig): string {
  const lines: string[] = [];
  lines.push(renderFileHeader('This file centralizes the app module registry used by createApp().').trimEnd());
  lines.push("import { authModule } from './auth/auth.module.js';");
  lines.push("import { systemModule } from './system/system.module.js';");
  if (config.preset === 'simple-crud') lines.push("import { itemsModule } from './items/items.module.js';");
  lines.push('');
  lines.push('export const appModules = [');
  lines.push('  authModule,');
  lines.push('  systemModule,');
  if (config.preset === 'simple-crud') lines.push('  itemsModule,');
  lines.push('];');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderAuthModule(): string {
  return `${renderFileHeader('This file declares the reference auth module used by the starter application.')}import { defineModule } from '@rasono/app';

export const authModule = defineModule<{}>({
  name: 'auth',
});
`;
}

function renderReferenceAuthService(): string {
  return `${renderFileHeader('This file implements the starter reference auth service used by bearer, API key, and session resolvers.')}import type { Principal } from '@rasono/app';
import type { ReferenceAuthConfig } from '../../config.js';

export type ReferenceAuthService = {
  verifyBearerToken: (token: string) => Principal | undefined;
  verifyApiKey: (apiKey: string) => Principal | undefined;
  verifySessionToken: (sessionToken: string) => Principal | undefined;
};

function principal(sub: string, role: string, tenantId: string): Principal {
  return { sub, roles: [role], tenantId };
}

export function createReferenceAuthService(config: ReferenceAuthConfig): ReferenceAuthService {
  return {
    verifyBearerToken: (token) => {
      if (!config.adminBearerToken || token !== config.adminBearerToken) return undefined;
      return principal('reference-admin', config.adminRole, config.adminTenantId);
    },
    verifyApiKey: (apiKey) => {
      if (!config.serviceApiKey || apiKey !== config.serviceApiKey) return undefined;
      return principal('reference-service', config.serviceRole, config.serviceTenantId);
    },
    verifySessionToken: (sessionToken) => {
      if (!config.sessionToken || sessionToken !== config.sessionToken) return undefined;
      return principal('reference-session-user', config.sessionRole, config.sessionTenantId);
    },
  };
}
`;
}

function renderReferenceAuthPolicies(): string {
  return `${renderFileHeader('This file defines reusable authorization policies for the starter reference auth module.')}import { composePolicies, definePolicy } from '@rasono/app';
import type { ApiRuntimeDeps } from '../../config.js';

export const requireAuthenticatedPrincipal = definePolicy<ApiRuntimeDeps>(({ principal }) => Boolean(principal));

export function requireRole(role: string) {
  return definePolicy<ApiRuntimeDeps>(({ principal }) => {
    return (principal?.roles ?? []).includes(role);
  });
}

export function requireSubjectPrefix(prefix: string) {
  return definePolicy<ApiRuntimeDeps>(({ principal }) => {
    return typeof principal?.sub === 'string' && principal.sub.startsWith(prefix);
  });
}

export function requireTenantAccess(expectedTenantId: string) {
  return definePolicy<ApiRuntimeDeps>(({ principal }) => {
    return typeof principal?.tenantId === 'string' && principal.tenantId === expectedTenantId;
  });
}

export function requireReferenceAccess(options: { role: string; subjectPrefix: string; tenantId: string }) {
  return composePolicies<ApiRuntimeDeps>([
    requireAuthenticatedPrincipal,
    requireRole(options.role),
    requireSubjectPrefix(options.subjectPrefix),
    requireTenantAccess(options.tenantId),
  ]);
}
`;
}

function renderSystemModule(): string {
  return `${renderFileHeader('This file declares the built-in system module used by the starter application.')}import { defineModule } from '@rasono/app';

export const systemModule = defineModule<{}>({
  name: 'system',
});
`;
}

function renderItemsModule(): string {
  return `${renderFileHeader('This file declares the sample items module used by the CRUD starter profile.')}import { defineModule } from '@rasono/app';

export const itemsModule = defineModule<{}>({
  name: 'items',
});
`;
}

function renderHelloRoute(config: ScaffoldConfig): string {
  const summary = config.preset === 'api-only' ? 'API ready' : config.preset === 'simple-crud' ? 'CRUD starter ready' : 'Hello';
  const message = config.preset === 'api-only' ? 'api-ready' : config.preset === 'simple-crud' ? 'crud-ready' : 'world';
  return `${renderFileHeader('This file exposes a system route that confirms the API starter is alive.')}import { defineRoute, defineSchema } from '@rasono/app';

const helloResponse = defineSchema(
  (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Expected object response');
    const value = input as Record<string, unknown>;
    if (typeof value.hello !== 'string') throw new Error('Expected "hello" to be a string');
    if (typeof value.requestId !== 'string') throw new Error('Expected "requestId" to be a string');
    return { hello: value.hello, requestId: value.requestId };
  },
  {
    type: 'object',
    properties: {
      hello: { type: 'string' },
      requestId: { type: 'string' },
    },
    required: ['hello', 'requestId'],
    additionalProperties: false,
  },
);

export default defineRoute({
  method: 'get',
  operationId: 'systemHello',
  summary: '${summary}',
  tags: ['system'],
  output: helloResponse,
  response: {
    status: 200,
    description: 'System hello response',
  },
  handler: (_c, { ctx }) => {
    ctx.tasks.add(async () => {
      ctx.log.info({ requestId: ctx.requestId }, 'background task executed');
    });
    return { hello: '${message}', requestId: ctx.requestId };
  },
});
`;
}

function renderHttpErrorRoute(): string {
  return `${renderFileHeader('This file demonstrates how explicit HTTP errors are exposed from module routes.')}import { defineRoute, httpError } from '@rasono/app';

export default defineRoute({
  method: 'get',
  operationId: 'systemHttpErrorExample',
  summary: 'HTTP error example',
  tags: ['system'],
  errors: [
    {
      status: 418,
      code: 'I_AM_A_TEAPOT',
      description: 'Example typed HTTP error',
      detail: 'This route demonstrates explicit HTTP errors.',
    },
  ],
  handler: () => {
    throw httpError(418, 'This route demonstrates explicit HTTP errors.', {
      code: 'I_AM_A_TEAPOT',
    });
  },
});
`;
}

function renderAuthMeRoute(): string {
  return `${renderFileHeader('This file exposes the authenticated identity returned by the starter reference auth resolvers.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'get',
  operationId: 'authMe',
  summary: 'Current principal',
  tags: ['auth'],
  auth: {
    required: true,
  },
  response: {
    status: 200,
    description: 'Authenticated principal details',
  },
  handler: (_c, { principal }) => ({
    principal,
  }),
});
`;
}

function renderAuthAdminRoute(): string {
  return `${renderFileHeader('This file demonstrates an admin-only route protected by the reference bearer token resolver.')}import { defineRoute } from '@rasono/app';
import { apiConfig } from '../../../config.js';
import { requireReferenceAccess } from '../auth.policies.js';

export default defineRoute({
  method: 'get',
  operationId: 'authAdminOnly',
  summary: 'Admin only endpoint',
  tags: ['auth'],
  auth: {
    required: true,
    roles: [apiConfig.referenceAuth.adminRole],
    scheme: 'bearer',
  },
  policy: requireReferenceAccess({
    role: apiConfig.referenceAuth.adminRole,
    subjectPrefix: 'reference-admin',
    tenantId: apiConfig.referenceAuth.adminTenantId,
  }),
  response: {
    status: 200,
    description: 'Admin access granted',
  },
  handler: () => ({
    ok: true,
    policy: 'admin-only',
  }),
});
`;
}

function renderAuthServiceRoute(): string {
  return `${renderFileHeader('This file demonstrates a service-only route protected by the reference API key resolver.')}import { defineRoute } from '@rasono/app';
import { apiConfig } from '../../../config.js';
import { requireReferenceAccess } from '../auth.policies.js';

export default defineRoute({
  method: 'get',
  operationId: 'authServiceOnly',
  summary: 'Service API key endpoint',
  tags: ['auth'],
  auth: {
    required: true,
    roles: [apiConfig.referenceAuth.serviceRole],
    scheme: 'apiKey',
  },
  policy: requireReferenceAccess({
    role: apiConfig.referenceAuth.serviceRole,
    subjectPrefix: 'reference-service',
    tenantId: apiConfig.referenceAuth.serviceTenantId,
  }),
  response: {
    status: 200,
    description: 'Service access granted',
  },
  handler: () => ({
    ok: true,
    policy: 'service-only',
  }),
});
`;
}

function renderAuthSessionRoute(): string {
  return `${renderFileHeader('This file demonstrates a session-protected route using explicit cookie validation.')}import { defineRoute, defineSchema } from '@rasono/app';
import { apiConfig } from '../../../config.js';
import { requireReferenceAccess } from '../auth.policies.js';

const sessionCookieSchema = defineSchema(
  (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Expected cookies object');
    const value = input as Record<string, unknown>;
    const cookieValue = value[apiConfig.referenceAuth.sessionCookieName];
    if (typeof cookieValue !== 'string') {
      throw new Error(\`Expected cookie "\${apiConfig.referenceAuth.sessionCookieName}"\`);
    }
    return {
      [apiConfig.referenceAuth.sessionCookieName]: cookieValue,
    };
  },
  {
    type: 'object',
    properties: {
      [apiConfig.referenceAuth.sessionCookieName]: { type: 'string' },
    },
    required: [apiConfig.referenceAuth.sessionCookieName],
    additionalProperties: true,
  },
);

export default defineRoute({
  method: 'get',
  operationId: 'authSessionOnly',
  summary: 'Session cookie endpoint',
  tags: ['auth'],
  input: {
    cookies: sessionCookieSchema,
  },
  auth: {
    required: true,
    roles: [apiConfig.referenceAuth.sessionRole],
    scheme: 'session',
  },
  policy: requireReferenceAccess({
    role: apiConfig.referenceAuth.sessionRole,
    subjectPrefix: 'reference-session',
    tenantId: apiConfig.referenceAuth.sessionTenantId,
  }),
  response: {
    status: 200,
    description: 'Session access granted',
  },
  handler: (_c, { input, principal }) => ({
    ok: true,
    principal,
    cookieName: apiConfig.referenceAuth.sessionCookieName,
    cookieValue: input.cookies?.[apiConfig.referenceAuth.sessionCookieName],
  }),
});
`;
}

function renderAuthTenantRoute(): string {
  return `${renderFileHeader('This file demonstrates a tenant-isolated route backed by the starter reference auth policies.')}import { composePolicies, definePolicy, defineRoute, defineSchema } from '@rasono/app';
import { requireAuthenticatedPrincipal } from '../auth.policies.js';

const tenantQuerySchema = defineSchema(
  (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Expected tenant query object');
    const value = input as Record<string, unknown>;
    if (typeof value.tenantId !== 'string') throw new Error('Expected tenantId query');
    return { tenantId: value.tenantId };
  },
  {
    type: 'object',
    properties: {
      tenantId: { type: 'string' },
    },
    required: ['tenantId'],
    additionalProperties: false,
  },
);

export default defineRoute({
  method: 'get',
  operationId: 'authTenantScoped',
  summary: 'Tenant scoped endpoint',
  tags: ['auth'],
  input: {
    query: tenantQuerySchema,
  },
  auth: {
    required: true,
  },
  policy: composePolicies([
    requireAuthenticatedPrincipal,
    definePolicy(({ principal, input }) => principal?.tenantId === input.query.tenantId),
  ]),
  response: {
    status: 200,
    description: 'Tenant access granted',
  },
  handler: (_c, { principal, input }) => ({
    ok: true,
    tenantId: input.query.tenantId,
    subject: principal?.sub,
  }),
});
`;
}

function renderWebIndexPage(config: ScaffoldConfig): string {
  const pageByPreset: Record<AppPreset, { title: string; description: string; heading: string; body: string }> = {
    'landing-page': {
      title: 'Landing Page',
      description: 'Starter marketing Web uniquement pour lancer une landing page rapidement.',
      heading: 'Launch faster with Rasono',
      body: 'Web starter minimal pour site vitrine, page produit ou landing marketing, sans backend impose.',
    },
    'api-only': {
      title: 'API Starter',
      description: 'Starter API only.',
      heading: 'Rasono API Starter',
      body: 'Ce preset est centré API, donc aucune application Web n’est générée.',
    },
    'simple-crud': {
      title: 'Simple CRUD',
      description: 'Starter full stack orienté CRUD avec Web, API et RPC.',
      heading: 'Simple CRUD Starter',
      body: 'Base propre pour dashboard interne, back-office léger ou application CRUD simple avec Web + API.',
    },
    'full-app': {
      title: 'Full App',
      description: 'Starter full stack complet avec Web, API, server actions et RPC.',
      heading: 'Full App Starter',
      body: 'Base complète pour une application produit avec interface Web, API, Swagger, RPC et server actions.',
    },
    custom: {
      title: 'Custom Starter',
      description: 'Starter Rasono personnalisé.',
      heading: 'Custom Rasono Starter',
      body: 'Starter généré à partir d’une composition personnalisée des briques Web et API.',
    },
  };
  const copy = pageByPreset[config.preset];
  return `${renderFileHeader('This file renders the starter landing page for the generated web application.')}import { type PageComponent } from 'rasengan';

const IndexPage: PageComponent = () => (
  <main>
    <h1>${copy.heading}</h1>
    <p>${copy.body}</p>
  </main>
);

IndexPage.metadata = { title: '${copy.title}', description: '${copy.description}' };

export default IndexPage;
`;
}

function renderCrudRoute(fileKey: 'list' | 'create' | 'read' | 'update' | 'delete'): string {
  if (fileKey === 'list') {
    return `${renderFileHeader('This file exposes the sample list route for the CRUD starter module.')}import { defineRoute } from '@rasono/app';

const items = [
  { id: '1', name: 'Starter item' },
  { id: '2', name: 'Second item' },
];

export default defineRoute({
  method: 'get',
  operationId: 'itemsList',
  summary: 'List items',
  tags: ['items'],
  response: {
    status: 200,
    description: 'List of sample items',
  },
  handler: (c) => c.json({ items }),
});
`;
  }
  if (fileKey === 'create') {
    return `${renderFileHeader('This file exposes the sample create route for the CRUD starter module.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'post',
  operationId: 'itemsCreate',
  summary: 'Create item',
  tags: ['items'],
  response: {
    status: 201,
    description: 'Created sample item',
  },
  handler: async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ created: true, item: { id: 'new-item', ...(body as Record<string, unknown>) } }, 201);
  },
});
`;
  }
  if (fileKey === 'read') {
    return `${renderFileHeader('This file exposes the sample read route for the CRUD starter module.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'get',
  operationId: 'itemsRead',
  summary: 'Get item',
  tags: ['items'],
  response: {
    status: 200,
    description: 'Sample item details',
  },
  handler: (c) => c.json({ item: { id: c.req.param('id'), name: 'Starter item' } }),
});
`;
  }
  if (fileKey === 'update') {
    return `${renderFileHeader('This file exposes the sample update route for the CRUD starter module.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'put',
  operationId: 'itemsUpdate',
  summary: 'Update item',
  tags: ['items'],
  response: {
    status: 200,
    description: 'Updated sample item',
  },
  handler: async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ updated: true, item: { id: c.req.param('id'), ...(body as Record<string, unknown>) } });
  },
});
`;
  }
  return `${renderFileHeader('This file exposes the sample delete route for the CRUD starter module.')}import { defineRoute } from '@rasono/app';

export default defineRoute({
  method: 'delete',
  operationId: 'itemsDelete',
  summary: 'Delete item',
  tags: ['items'],
  response: {
    status: 200,
    description: 'Deleted sample item',
  },
  handler: (c) => c.json({ deleted: true, id: c.req.param('id') }),
});
`;
}

async function configureApiTemplate(outDir: string, config: ScaffoldConfig): Promise<void> {
  const apiDir = resolve(outDir, 'apps/api');
  const dataPatch = getDataDependencyPatch(config);
  await patchPackageJson(resolve(apiDir, 'package.json'), (pkg) => ({
    ...pkg,
    dependencies: mergeDeps(
      removeDeps(pkg.dependencies, [
        ...(config.includeActions ? [] : ['@rasono/actions']),
        ...(config.includeSwagger ? [] : ['@rasono/swagger']),
      ]),
      dataPatch.dependencies,
    ),
    devDependencies: mergeDeps(pkg.devDependencies, dataPatch.devDependencies),
  }));

  if (!config.includeActions) {
    await removeIfExists(resolve(apiDir, 'src/actions'));
  }

  await removeIfExists(resolve(apiDir, 'src/api'));
  await writeText(resolve(apiDir, 'src/index.ts'), renderApiIndex(config));
  await writeText(resolve(apiDir, 'src/config.ts'), renderApiConfig());
  await writeText(resolve(apiDir, '.env.example'), renderApiEnvExample(config));
  await writeText(resolve(apiDir, 'src/modules/index.ts'), renderModulesIndex(config));
  await writeText(resolve(apiDir, 'src/modules/auth/auth.module.ts'), renderAuthModule());
  await writeText(resolve(apiDir, 'src/modules/auth/auth.service.ts'), renderReferenceAuthService());
  await writeText(resolve(apiDir, 'src/modules/auth/auth.policies.ts'), renderReferenceAuthPolicies());
  await writeText(resolve(apiDir, 'src/modules/auth/api/me.ts'), renderAuthMeRoute());
  await writeText(resolve(apiDir, 'src/modules/auth/api/admin.ts'), renderAuthAdminRoute());
  await writeText(resolve(apiDir, 'src/modules/auth/api/service.ts'), renderAuthServiceRoute());
  await writeText(resolve(apiDir, 'src/modules/auth/api/session.ts'), renderAuthSessionRoute());
  await writeText(resolve(apiDir, 'src/modules/auth/api/tenant.ts'), renderAuthTenantRoute());
  await writeText(resolve(apiDir, 'src/modules/system/system.module.ts'), renderSystemModule());
  await writeText(resolve(apiDir, 'src/modules/system/api/hello.ts'), renderHelloRoute(config));
  await writeText(resolve(apiDir, 'src/modules/system/api/http-error.ts'), renderHttpErrorRoute());

  const crudBase = resolve(apiDir, 'src/modules/items/api');
  if (config.preset === 'simple-crud') {
    await writeText(resolve(apiDir, 'src/modules/items/items.module.ts'), renderItemsModule());
    await writeText(resolve(crudBase, 'index.ts'), renderCrudRoute('list'));
    await writeText(resolve(crudBase, 'create.ts'), renderCrudRoute('create'));
    await writeText(resolve(crudBase, '[id].ts'), renderCrudRoute('read'));
    await writeText(resolve(crudBase, '[id]/update.ts'), renderCrudRoute('update'));
    await writeText(resolve(crudBase, '[id]/delete.ts'), renderCrudRoute('delete'));
  } else {
    await removeIfExists(resolve(apiDir, 'src/modules/items'));
  }

  if (config.dataProvider === 'none') {
    await removeIfExists(resolve(apiDir, 'src/data'));
  } else {
    await writeText(resolve(apiDir, 'src/data/index.ts'), renderDataIndex(config));
  }
}

async function configureWebTemplate(outDir: string, config: ScaffoldConfig): Promise<void> {
  const webDir = resolve(outDir, 'apps/web');
  await patchPackageJson(resolve(webDir, 'package.json'), (pkg) => ({
    ...pkg,
    dependencies: removeDeps(pkg.dependencies, [
      ...(config.includeActions ? [] : ['@rasono/actions']),
    ]),
  }));

  if (!config.includeActions) {
    await removeIfExists(resolve(webDir, 'src/lib/actions.ts'));
  }
  if (!config.includeRpc) {
    await removeIfExists(resolve(webDir, 'src/lib/rpc.ts'));
  }

  await writeText(resolve(webDir, 'src/app/index.page.tsx'), renderWebIndexPage(config));
}

async function applyScaffoldProfile(outDir: string, config: ScaffoldConfig): Promise<void> {
  if (!config.includeApi) {
    await removeIfExists(resolve(outDir, 'apps/api'));
  }
  if (!config.includeWeb) {
    await removeIfExists(resolve(outDir, 'apps/web'));
  }

  const workspaces = [
    ...(config.includeApi ? ['apps/api'] : []),
    ...(config.includeWeb ? ['apps/web'] : []),
  ];

  await patchPackageJson(resolve(outDir, 'package.json'), (pkg) => ({
    ...pkg,
    workspaces,
  }));

  if (config.includeApi) {
    await configureApiTemplate(outDir, config);
  }
  if (config.includeWeb) {
    await configureWebTemplate(outDir, config);
  }
}

function printScaffoldSummary(target: string, config: ScaffoldConfig, pm: PackageManager): void {
  const flags = [
    `--preset=${config.preset}`,
    ...(config.includeApi ? ['--api'] : ['--no-api']),
    ...(config.includeWeb ? ['--web'] : ['--no-web']),
    ...(config.includeActions ? ['--actions'] : ['--no-actions']),
    ...(config.includeSwagger ? ['--swagger'] : ['--no-swagger']),
    ...(config.includeRpc ? ['--rpc'] : ['--no-rpc']),
    `--data=${config.dataProvider}`,
    ...(config.dataProvider !== 'none' && config.database ? [`--database=${config.database}`] : []),
  ];
  output.write(`\nRasono starter ready\n`);
  output.write(`- Directory: ${target}\n`);
  output.write(`- Preset: ${config.preset}\n`);
  output.write(`- Web: ${config.includeWeb ? 'yes' : 'no'}\n`);
  output.write(`- API: ${config.includeApi ? 'yes' : 'no'}\n`);
  output.write(`- Swagger: ${config.includeSwagger ? 'yes' : 'no'}\n`);
  output.write(`- Server actions: ${config.includeActions ? 'yes' : 'no'}\n`);
  output.write(`- RPC: ${config.includeRpc ? 'yes' : 'no'}\n`);
  output.write(`- Data provider: ${config.dataProvider}\n`);
  output.write(`- Database: ${config.database ?? 'none'}\n`);
  output.write(`\nEquivalent non-interactive command:\n`);
  output.write(`  create-rasono ${target} ${flags.join(' ')} --pm=${pm}\n\n`);
}

function printHelp(): void {
  process.stdout.write(`create-rasono

Usage:
  create-rasono [target] [options]

Options:
  --preset=<landing-page|api-only|simple-crud|full-app|custom>
  --pm=<npm|pnpm|yarn|bun>
  --api | --no-api
  --web | --no-web
  --actions | --no-actions
  --swagger | --no-swagger
  --rpc | --no-rpc
  --data=<none|drizzle|kysely|engine>
  --database=<postgres|mysql|sqlite|mssql|turso>
  --install | --no-install
  --interactive
  --yes, -y
  --help, -h

Behavior:
  - With flags, the CLI can run fully non-interactively.
  - Without --yes, the CLI guides setup step by step in English.
`);
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    if (args.target === '__help__') {
      printHelp();
      return;
    }
    if (needsInteractivePrompt(args) && !isInteractiveTerminal()) {
      throw new Error('Interactive mode requires a TTY. Use --yes or pass explicit flags such as --preset, --pm, --api, --web, --data, and --no-install.');
    }

    const target = args.targetProvided
      ? args.target!
      : args.yes && !args.interactive
        ? 'rasono-app'
        : await promptTargetDirectory('rasono-app');
    assertSafeTargetDir(target);

    const detectedPm = detectPackageManager();
    const pm = args.pm ?? (args.yes && !args.interactive ? detectedPm : await promptPackageManager(detectedPm));
    const config = await resolveScaffoldConfig(args, target);
    const installDependencies =
      args.installDependencies ?? (args.yes && !args.interactive ? true : await askYesNo('Install dependencies now?', true));
    const outDir = resolve(process.cwd(), target);

    if (await exists(outDir)) {
      throw new Error(`Directory already exists: ${target}`);
    }

    const here = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(here, '..');
    const templateDir = resolve(here, '../template');

    await mkdir(outDir, { recursive: true });
    await cp(templateDir, outDir, { recursive: true });

    await patchPackageJson(resolve(outDir, 'package.json'), (pkg) => ({
      ...pkg,
      name: toPackageName(target),
    }));
    await applyScaffoldProfile(outDir, config);
    await patchAppPackages(outDir, packageRoot);

    if (installDependencies) {
      await run(pm, outDir);
    }

    printScaffoldSummary(target, config, pm);
  } finally {
    closePromptInterface();
  }
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
