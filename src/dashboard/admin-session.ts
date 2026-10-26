/**
 * Browser-side preparation for the admin-dashboard session check.
 * The Edge Function decides authorization. This module never sends an
 * administrator id and never reads premium_admins.
 *
 * Contract: POST {supabaseUrl}/functions/v1/admin-dashboard
 * body: { "action": "session" }
 * authorized response: { "ok": true }
 */

export interface PublicSupabaseConfig {
  url: string;
  anonKey: string;
}

export type SessionCheckStatus = 'authorized' | 'invalid_session' | 'not_admin' | 'unavailable';

export function readPublicSupabaseConfig(env: { url?: string | null; anonKey?: string | null }): PublicSupabaseConfig | null {
  const url = env.url?.trim() ?? '';
  const anonKey = env.anonKey?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
  if (!isPublishableKey(anonKey)) return null;
  const base = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  return { url: base, anonKey };
}

export function sessionRequest(config: PublicSupabaseConfig, accessToken: string): { url: string; init: RequestInit } {
  return {
    url: `${config.url}/functions/v1/admin-dashboard`,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'session' }),
    },
  };
}

export function classifySessionResponse(status: number, body: unknown): SessionCheckStatus {
  if (status === 401) return 'invalid_session';
  if (status === 403) return 'not_admin';
  if (status === 200 && isAuthorizedBody(body)) return 'authorized';
  return 'unavailable';
}

export async function checkAdministratorSession(
  config: PublicSupabaseConfig,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<SessionCheckStatus> {
  if (!accessToken.trim()) return 'invalid_session';
  const request = sessionRequest(config, accessToken);
  let response: Response;
  try {
    response = await fetchImpl(request.url, request.init);
  } catch {
    return 'unavailable';
  }
  if (response.status !== 200) return classifySessionResponse(response.status, null);
  try {
    return classifySessionResponse(response.status, await response.json());
  } catch {
    return 'unavailable';
  }
}

function isAuthorizedBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true;
}

function isPublishableKey(key: string): boolean {
  if (key.startsWith('sb_secret_') || key.startsWith('sb_service_')) return false;
  if (key.startsWith('sb_publishable_')) return key.length >= 20;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  const payload = decodeJwtPayload(parts[1]);
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { role?: unknown }).role === 'anon';
}

function decodeJwtPayload(part: string): unknown {
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
