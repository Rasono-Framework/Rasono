import { generateApi } from './generateApi.js';
import { generateActions } from './generateActions.js';
import { generatePages } from './generatePages.js';
import { generateRpc } from './generateRpc.js';

export type GenerateAllResult = {
  api: { outFile: string; count: number };
  actions: { outFile: string; count: number };
  pages: { outFile: string; count: number };
  rpc: { outFile: string; count: number };
};

export async function generateAll(rootDir: string): Promise<GenerateAllResult> {
  const [api, actions, pages, rpc] = await Promise.all([
    generateApi({ rootDir }),
    generateActions({ rootDir }),
    generatePages({ rootDir }),
    generateRpc({ rootDir }),
  ]);
  return { api, actions, pages, rpc };
}
