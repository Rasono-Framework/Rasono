/**
 * This file runs the development watcher that keeps generated manifests in sync
 * with API, module, action, and page source changes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generateAll } from './generateAll.js';
import { pathExists } from './fs.js';

type DevOptions = {
  rootDir: string;
  command?: string;
  args?: string[];
};

type Cleanup = () => void;

async function listDirectories(root: string): Promise<string[]> {
  const out: string[] = [root];
  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const next = join(dir, entry.name);
      out.push(next);
      stack.push(next);
    }
  }

  return out;
}

function createDebounced(task: () => Promise<void>, delayMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;

  const run = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await task();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void run();
      }
    }
  };

  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void run();
    }, delayMs);
  };
}

async function createWatcher(root: string, onChange: () => void): Promise<Cleanup> {
  const watchers: FSWatcher[] = [];

  const attach = (target: string, recursive: boolean) => {
    const watcher = watch(target, { recursive }, (_eventType, filename) => {
      if (!filename) return;
      const rel = String(filename);
      if (rel.includes('.rasono')) return;
      onChange();
    });
    watchers.push(watcher);
  };

  try {
    attach(root, true);
  } catch {
    const dirs = await listDirectories(root);
    for (const dir of dirs) attach(dir, false);
  }

  return () => {
    for (const watcher of watchers) watcher.close();
  };
}

function spawnChild(command: string, args: string[], cwd: string): ChildProcess {
  return spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

export async function runDev(options: DevOptions): Promise<void> {
  const rootDir = resolve(options.rootDir);
  const apiRoot = resolve(rootDir, 'src/api');
  const modulesRoot = resolve(rootDir, 'src/modules');
  const appRoot = resolve(rootDir, 'src/app');
  const actionsRoot = resolve(rootDir, 'src/actions');

  const initial = await generateAll(rootDir);
  process.stdout.write(`generated api manifest: ${initial.api.count} routes -> ${initial.api.outFile}\n`);
  process.stdout.write(`generated actions manifest: ${initial.actions.count} actions -> ${initial.actions.outFile}\n`);
  process.stdout.write(`generated pages manifest: ${initial.pages.count} pages -> ${initial.pages.outFile}\n`);
  process.stdout.write(`generated rpc manifest: ${initial.rpc.count} routes -> ${initial.rpc.outFile}\n`);

  const triggerGenerate = createDebounced(async () => {
    const res = await generateAll(rootDir);
    process.stdout.write(`regenerated api manifest: ${res.api.count} routes -> ${res.api.outFile}\n`);
    process.stdout.write(`regenerated actions manifest: ${res.actions.count} actions -> ${res.actions.outFile}\n`);
    process.stdout.write(`regenerated pages manifest: ${res.pages.count} pages -> ${res.pages.outFile}\n`);
    process.stdout.write(`regenerated rpc manifest: ${res.rpc.count} routes -> ${res.rpc.outFile}\n`);
  }, 60);

  const cleanups: Cleanup[] = [];
  if (await pathExists(apiRoot)) cleanups.push(await createWatcher(apiRoot, triggerGenerate));
  if (await pathExists(modulesRoot)) cleanups.push(await createWatcher(modulesRoot, triggerGenerate));
  if (await pathExists(appRoot)) cleanups.push(await createWatcher(appRoot, triggerGenerate));
  if (await pathExists(actionsRoot)) cleanups.push(await createWatcher(actionsRoot, triggerGenerate));

  let child: ChildProcess | undefined;
  if (options.command) {
    child = spawnChild(options.command, options.args ?? [], rootDir);
  }

  const cleanup = () => {
    for (const stop of cleanups) stop();
    if (child && !child.killed) {
      child.kill('SIGTERM');
    }
  };

  const forwardSignal = (signal: NodeJS.Signals) => {
    if (child && !child.killed) {
      child.kill(signal);
      return;
    }
    cleanup();
    process.exit(0);
  };

  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));

  if (!child) {
    await new Promise<void>(() => {});
    return;
  }

  await new Promise<void>((resolvePromise, reject) => {
    child!.once('exit', (code, signal) => {
      cleanup();
      if (signal) {
        process.stderr.write(`child process exited from signal ${signal}\n`);
        resolvePromise();
        return;
      }
      if ((code ?? 0) === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`child process exited with code ${code}`));
    });
    child!.once('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}
