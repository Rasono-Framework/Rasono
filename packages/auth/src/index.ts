/**
 * This file exposes transport-agnostic principal resolvers for bearer tokens,
 * API keys, cookie sessions, and resolver composition.
 */
import type { Principal, RasonoLogger } from '@rasono/core';

export type PrincipalResolverInput<Deps = unknown> = {
  request: Request;
  requestId?: string;
  log?: RasonoLogger;
  deps?: Deps;
};

export type PrincipalResolver<Deps = unknown> = (
  input: PrincipalResolverInput<Deps>,
) => Principal | undefined | Promise<Principal | undefined>;

export type BearerPrincipalVerifier<Deps = unknown> = (
  token: string,
  input: PrincipalResolverInput<Deps>,
) => Principal | undefined | Promise<Principal | undefined>;

export type ApiKeyPrincipalVerifier<Deps = unknown> = (
  apiKey: string,
  input: PrincipalResolverInput<Deps>,
) => Principal | undefined | Promise<Principal | undefined>;

export type SessionPrincipalVerifier<Deps = unknown> = (
  sessionToken: string,
  input: PrincipalResolverInput<Deps>,
) => Principal | undefined | Promise<Principal | undefined>;

export type BearerPrincipalResolverOptions<Deps = unknown> = {
  verifyToken: BearerPrincipalVerifier<Deps>;
  headerName?: string;
  scheme?: string;
  maxCredentialLength?: number;
};

export type ApiKeyPrincipalResolverOptions<Deps = unknown> = {
  verifyKey: ApiKeyPrincipalVerifier<Deps>;
  headerName?: string;
  maxCredentialLength?: number;
};

export type SessionPrincipalResolverOptions<Deps = unknown> = {
  verifySession: SessionPrincipalVerifier<Deps>;
  cookieName?: string;
  maxCredentialLength?: number;
};

function normalizeHeaderName(value: string | undefined, fallback: string): string {
  return (value ?? fallback).trim().toLowerCase();
}

function isReasonableCredential(value: string, maxCredentialLength: number): boolean {
  return value.length > 0 && value.length <= maxCredentialLength;
}

function readHeader(request: Request, headerName: string): string | undefined {
  const raw = request.headers.get(headerName);
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCookie(request: Request, cookieName: string): string | undefined {
  const cookieHeader = readHeader(request, 'cookie');
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = entry.split('=');
    if (rawName?.trim() !== cookieName) continue;
    const value = rawValue.join('=').trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function extractBearerCredential(rawHeader: string, scheme: string): string | undefined {
  const parts = rawHeader.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return undefined;
  if (parts[0]?.toLowerCase() !== scheme.toLowerCase()) return undefined;
  return parts[1];
}

export function createBearerPrincipalResolver<Deps = unknown>(
  options: BearerPrincipalResolverOptions<Deps>,
): PrincipalResolver<Deps> {
  const headerName = normalizeHeaderName(options.headerName, 'authorization');
  const scheme = (options.scheme ?? 'Bearer').trim() || 'Bearer';
  const maxCredentialLength = options.maxCredentialLength ?? 4096;

  return async (input) => {
    const rawHeader = readHeader(input.request, headerName);
    if (!rawHeader) return undefined;
    const token = extractBearerCredential(rawHeader, scheme);
    if (!token || !isReasonableCredential(token, maxCredentialLength)) return undefined;
    return options.verifyToken(token, input);
  };
}

export function createApiKeyPrincipalResolver<Deps = unknown>(
  options: ApiKeyPrincipalResolverOptions<Deps>,
): PrincipalResolver<Deps> {
  const headerName = normalizeHeaderName(options.headerName, 'x-api-key');
  const maxCredentialLength = options.maxCredentialLength ?? 4096;

  return async (input) => {
    const apiKey = readHeader(input.request, headerName);
    if (!apiKey || !isReasonableCredential(apiKey, maxCredentialLength)) return undefined;
    return options.verifyKey(apiKey, input);
  };
}

export function createSessionPrincipalResolver<Deps = unknown>(
  options: SessionPrincipalResolverOptions<Deps>,
): PrincipalResolver<Deps> {
  const cookieName = (options.cookieName ?? 'session').trim() || 'session';
  const maxCredentialLength = options.maxCredentialLength ?? 4096;

  return async (input) => {
    const sessionToken = readCookie(input.request, cookieName);
    if (!sessionToken || !isReasonableCredential(sessionToken, maxCredentialLength)) return undefined;
    return options.verifySession(sessionToken, input);
  };
}

export function composePrincipalResolvers<Deps = unknown>(
  resolvers: Array<PrincipalResolver<Deps>>,
): PrincipalResolver<Deps> {
  return async (input) => {
    for (const resolver of resolvers) {
      const principal = await resolver(input);
      if (principal) return principal;
    }
    return undefined;
  };
}
