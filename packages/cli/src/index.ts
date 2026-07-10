#!/usr/bin/env node
/**
 * This file is the CLI entrypoint that orchestrates generation and watch
 * workflows for Rasono applications.
 */
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { generateAll } from './generateAll.js';
import { generateModule, generatePolicy } from './generateScaffold.js';
import { runDev } from './dev.js';
import { pathExists } from './fs.js';

type Args = {
  cmd: string;
  rootDir: string;
  command?: string;
  commandArgs: string[];
  subcommand?: string;
  subcommandArgs: string[];
};

function pageTemplate(route: string): string {
  const title = route === 'index' ? 'Home' : route.split('/').filter(Boolean).slice(-1)[0] ?? 'Page';
  return `${renderFileHeader('This file defines a generated page component for the web starter.') }import { type PageComponent } from 'rasengan';

const Page: PageComponent = () => <main>${title}</main>;
Page.metadata = { title: '${title}', description: '${title} page' };

export default Page;
`;
}

function renderFileHeader(description: string): string {
  return `/**\n * ${description}\n */\n`;
}

async function generatePage(rootDir: string, pageName: string): Promise<string> {
  const clean = pageName.trim().replace(/^\/+|\/+$/g, '');
  const normalized = clean.length > 0 ? clean : 'index';
  const relativePath = normalized === 'index' ? 'index.page.tsx' : `${normalized}.page.tsx`;
  const filePath = resolvePath(rootDir, 'src/app', relativePath);
  if (await pathExists(filePath)) {
    throw new Error(`page already exists: ${filePath}`);
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, pageTemplate(normalized), 'utf8');
  return filePath;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const splitIndex = args.indexOf('--');
  const cliArgs = splitIndex >= 0 ? args.slice(0, splitIndex) : args;
  const childArgs = splitIndex >= 0 ? args.slice(splitIndex + 1) : [];
  const cmd = cliArgs[0] ?? 'help';
  const rootFlag = cliArgs.find((a) => a.startsWith('--root='));
  const rootDir = rootFlag ? rootFlag.split('=')[1] ?? process.cwd() : process.cwd();
  return {
    cmd,
    rootDir: resolve(rootDir),
    subcommand: cliArgs[1],
    subcommandArgs: cliArgs.slice(2).filter((a) => !a.startsWith('--root=')),
    command: childArgs[0],
    commandArgs: childArgs.slice(1),
  };
}

async function main() {
  const { cmd, rootDir, command, commandArgs, subcommand, subcommandArgs } = parseArgs(process.argv);

  if (cmd === 'gen' || cmd === 'generate') {
    if (subcommand === 'page') {
      const pageName = subcommandArgs[0];
      if (!pageName) {
        throw new Error('missing page name: rasono generate page <name>');
      }
      const filePath = await generatePage(rootDir, pageName);
      process.stdout.write(`generated page: ${filePath}\n`);
      const res = await generateAll(rootDir);
      process.stdout.write(`generated pages manifest: ${res.pages.count} pages -> ${res.pages.outFile}\n`);
      return;
    }
    if (subcommand === 'module') {
      const moduleName = subcommandArgs[0];
      if (!moduleName) {
        throw new Error('missing module name: rasono generate module <name>');
      }
      const result = await generateModule(rootDir, moduleName);
      for (const filePath of result.files) {
        process.stdout.write(`generated module file: ${filePath}\n`);
      }
      process.stdout.write(`updated module registry: ${result.registryFile}\n`);
      const res = await generateAll(rootDir);
      process.stdout.write(`generated api manifest: ${res.api.count} routes -> ${res.api.outFile}\n`);
      process.stdout.write(`generated pages manifest: ${res.pages.count} pages -> ${res.pages.outFile}\n`);
      process.stdout.write(`generated rpc manifest: ${res.rpc.count} routes -> ${res.rpc.outFile}\n`);
      return;
    }
    if (subcommand === 'policy') {
      const moduleName = subcommandArgs[0];
      const policyName = subcommandArgs[1];
      if (!moduleName || !policyName) {
        throw new Error('missing policy args: rasono generate policy <module> <name>');
      }
      const result = await generatePolicy(rootDir, moduleName, policyName);
      process.stdout.write(`generated policy: ${result.filePath}\n`);
      return;
    }
    const res = await generateAll(rootDir);
    process.stdout.write(`generated api manifest: ${res.api.count} routes -> ${res.api.outFile}\n`);
    process.stdout.write(`generated actions manifest: ${res.actions.count} actions -> ${res.actions.outFile}\n`);
    process.stdout.write(`generated pages manifest: ${res.pages.count} pages -> ${res.pages.outFile}\n`);
    process.stdout.write(`generated rpc manifest: ${res.rpc.count} routes -> ${res.rpc.outFile}\n`);
    return;
  }

  if (cmd === 'dev') {
    await runDev({
      rootDir,
      command,
      args: commandArgs,
    });
    return;
  }

  process.stdout.write(`rasono

Usage:
  rasono gen [--root=/path/to/app]
  rasono dev [--root=/path/to/app] -- <command> [...args]
  rasono generate page <name> [--root=/path/to/app]
  rasono generate module <name> [--root=/path/to/app]
  rasono generate policy <module> <name> [--root=/path/to/app]

Convention:
  src/api/**.(ts|tsx) -> /api/** routes
  src/modules/*/api/**.(ts|tsx) -> /api/<module>/** routes
  src/actions/**.(ts|tsx) -> /actions/** server actions
  src/app/**.page.tsx -> /** pages
  index.ts -> /api
  [id].ts -> :id
  [...all].ts -> *
`);
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
