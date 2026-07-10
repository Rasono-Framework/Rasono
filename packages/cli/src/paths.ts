import { relative, sep } from 'node:path';

export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

export function relPosix(from: string, to: string): string {
  return toPosixPath(relative(from, to));
}

export function withoutExt(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

export function apiPathFromRelativeFile(relNoExt: string): string {
  const parts = relNoExt.split('/').filter(Boolean);
  const mapped = parts.map((p) => {
    if (p === 'index') return '';
    if (p.startsWith('[') && p.endsWith(']')) {
      const inner = p.slice(1, -1);
      if (inner.startsWith('...')) return '*';
      return `:${inner}`;
    }
    return p;
  });
  const cleaned = mapped.filter((p) => p.length > 0);
  return `/api/${cleaned.join('/')}`;
}

export function pagePathFromRelativeFile(relNoExt: string): string {
  const parts = relNoExt.split('/').filter(Boolean);
  const mapped = parts.map((p) => {
    if (p === 'index') return '';
    if (p.startsWith('[') && p.endsWith(']')) {
      const inner = p.slice(1, -1);
      if (inner.startsWith('...')) return '*';
      return `:${inner}`;
    }
    return p;
  });
  const cleaned = mapped.filter((p) => p.length > 0);
  if (cleaned.length === 0) return '/';
  return `/${cleaned.join('/')}`;
}
