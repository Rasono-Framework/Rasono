import type { BackgroundTask, BackgroundTasks, RasonoLogger } from './types.js';

export function createBackgroundTasks(): BackgroundTasks {
  const tasks: BackgroundTask[] = [];
  return {
    add: (task) => {
      tasks.push(task);
    },
    size: () => tasks.length,
    runAll: async ({ requestId, log }) => {
      if (tasks.length === 0) return;
      const results = await Promise.allSettled(tasks.map((t) => Promise.resolve().then(t)));
      for (const r of results) {
        if (r.status === 'rejected') {
          const reason = r.reason;
          log.error(
            {
              requestId,
              errName: reason instanceof Error ? reason.name : 'UnknownError',
              errMessage: reason instanceof Error ? reason.message : String(reason),
            },
            'Background task failed'
          );
        }
      }
    },
  };
}

export function runBackgroundTasksSafely(options: {
  tasks: BackgroundTasks;
  requestId: string;
  log: RasonoLogger;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<void> {
  const p = options.tasks.runAll({ requestId: options.requestId, log: options.log });
  if (options.waitUntil) {
    options.waitUntil(p);
  }
  return p;
}
