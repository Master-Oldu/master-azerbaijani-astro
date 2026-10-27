/**
 * Learners directory action for the admin-dashboard Edge Function.
 * Field names follow the backend contract. This module does not call the
 * network and does not store responses.
 */

export const LEARNERS_FUNCTION = 'admin-dashboard';

export const LEARNERS_PAGE_SIZE = 20;

const SEARCH_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LearnersRequestBody {
  action: 'learners';
  page: number;
  page_size: 20;
  search?: string;
}

export interface LearnersQuery {
  search: string | null;
  page: number;
}

export interface LessonCompletionRow {
  lesson_id: string;
  lesson_engine_id: string | null;
  title: string | null;
  completed_at: string;
}

export interface ProductionPurchaseSource {
  kind: 'production_purchase';
  platform: 'apple' | 'google';
  store_source: 'paid_purchase' | 'offer_code' | 'unknown';
  grant_status: 'active' | 'grace';
}

export interface AccountGrantSource {
  kind: 'account_grant';
  grant_kind: 'lifetime' | 'migration_window';
}

export type PremiumSource = ProductionPurchaseSource | AccountGrantSource;

export interface LearnerDirectoryRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  completed_lessons: number;
  latest_completion: LessonCompletionRow | null;
  latest_completion_basis: 'none' | 'stored_progress_row' | 'undated_completion';
  premium: {
    effective: boolean;
    sources: PremiumSource[];
  };
  sandbox_purchase_test_allowed: boolean;
}

export interface LearnersPayload {
  search: string | null;
  page: number;
  page_size: 20;
  total: number;
  page_count: number;
  rows: LearnerDirectoryRow[];
}

export type LearnersDenial = 'invalid_session' | 'not_admin';

export type LearnersOutcome =
  | { status: 'ok'; learners: LearnersPayload }
  | { status: 'denied'; reason: LearnersDenial; code: string | null }
  | { status: 'invalid_body'; code: 'invalid_body' }
  | { status: 'unavailable'; code: string | null }
  | { status: 'network' };

/** Named periods are unrelated. A blank search is omitted. page_size stays 20. */
export function buildLearnersRequest(search: string, page: number): LearnersRequestBody | null {
  const trimmed = search.trim();
  if (trimmed.length > SEARCH_LIMIT) return null;
  if (!Number.isInteger(page) || page < 1 || page > 10000) return null;
  const body: LearnersRequestBody = { action: 'learners', page, page_size: LEARNERS_PAGE_SIZE };
  if (trimmed) body.search = trimmed;
  return body;
}

export function parseLearnersPayload(body: unknown, expected: LearnersQuery): LearnersPayload | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const learners = body.learners;
  if (!isRecord(learners)) return null;
  if (!('search' in learners)) return null;
  if (expected.search === null) {
    if (learners.search !== null) return null;
  } else if (learners.search !== expected.search) {
    return null;
  }
  if (learners.page !== expected.page || learners.page_size !== LEARNERS_PAGE_SIZE) return null;
  const total = whole(learners.total);
  const pageCount = whole(learners.page_count);
  if (total === null || pageCount === null) return null;
  if (pageCount !== expectedPageCount(total, LEARNERS_PAGE_SIZE)) return null;
  if (!Array.isArray(learners.rows)) return null;
  const expectedRows = expectedRowCount(total, expected.page, LEARNERS_PAGE_SIZE, pageCount);
  if (learners.rows.length !== expectedRows) return null;

  const rows: LearnerDirectoryRow[] = [];
  const seen = new Set<string>();
  for (const row of learners.rows) {
    const parsed = readRow(row);
    if (!parsed || seen.has(parsed.user_id.toLowerCase())) return null;
    seen.add(parsed.user_id.toLowerCase());
    rows.push(parsed);
  }

  return {
    search: expected.search,
    page: expected.page,
    page_size: LEARNERS_PAGE_SIZE,
    total,
    page_count: pageCount,
    rows,
  };
}

export async function readLearnersInvoke(
  result: { data: unknown; error: unknown },
  expected: LearnersQuery,
): Promise<LearnersOutcome> {
  const error = result.error;
  if (isNamedError(error, 'FunctionsFetchError')) return { status: 'network' };
  if (isNamedError(error, 'FunctionsRelayError')) return { status: 'unavailable', code: null };
  if (isNamedError(error, 'FunctionsHttpError')) {
    const http = await readHttpError(error);
    if (http.status === 401) return { status: 'denied', reason: 'invalid_session', code: http.code };
    if (http.status === 403) return { status: 'denied', reason: 'not_admin', code: http.code };
    if (http.status === 400 && http.code === 'invalid_body') return { status: 'invalid_body', code: 'invalid_body' };
    return { status: 'unavailable', code: http.code };
  }
  if (error) return { status: 'unavailable', code: null };
  const parsed = parseLearnersPayload(result.data, expected);
  if (!parsed) return { status: 'unavailable', code: null };
  return { status: 'ok', learners: parsed };
}

export function sourceLabel(source: PremiumSource): string {
  if (source.kind === 'account_grant') {
    return source.grant_kind === 'lifetime' ? 'Complimentary lifetime grant' : 'Temporary migration grant';
  }
  const store = source.platform === 'apple' ? 'Apple production entitlement' : 'Google Play production entitlement';
  const payment =
    source.store_source === 'offer_code'
      ? 'Promotional code indicated'
      : source.store_source === 'unknown'
        ? 'Payment type unknown'
        : 'Payment type unverified (legacy)';
  const access = source.grant_status === 'active' ? 'Active' : 'Grace';
  return `${store} · ${payment} · ${access}`;
}

function readRow(value: unknown): LearnerDirectoryRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.user_id !== 'string' || !UUID.test(value.user_id)) return null;
  const email = optionalText(value.email);
  const displayName = optionalText(value.display_name);
  if (email === undefined || displayName === undefined) return null;
  if (!isTimestamp(value.created_at)) return null;
  if (!(value.last_sign_in_at === null || isTimestamp(value.last_sign_in_at))) return null;
  const completed = whole(value.completed_lessons);
  if (completed === null) return null;
  const basis = value.latest_completion_basis;
  if (basis !== 'none' && basis !== 'stored_progress_row' && basis !== 'undated_completion') return null;
  const latest = readLatest(value.latest_completion, basis);
  if (latest === undefined) return null;
  if (basis === 'none' && (completed !== 0 || latest !== null)) return null;
  if (basis !== 'none' && (completed < 1 || (basis === 'stored_progress_row') !== (latest !== null))) return null;
  if (basis === 'undated_completion' && latest !== null) return null;
  const premium = readPremium(value.premium);
  if (!premium) return null;
  if (typeof value.sandbox_purchase_test_allowed !== 'boolean') return null;
  return {
    user_id: value.user_id,
    email,
    display_name: displayName,
    created_at: value.created_at,
    last_sign_in_at: value.last_sign_in_at,
    completed_lessons: completed,
    latest_completion: latest,
    latest_completion_basis: basis,
    premium,
    sandbox_purchase_test_allowed: value.sandbox_purchase_test_allowed,
  };
}

function readLatest(value: unknown, basis: string): LessonCompletionRow | null | undefined {
  if (basis !== 'stored_progress_row') return value === null ? null : undefined;
  if (!isRecord(value)) return undefined;
  if (typeof value.lesson_id !== 'string' || !value.lesson_id.trim()) return undefined;
  const engine = optionalText(value.lesson_engine_id);
  const title = optionalText(value.title);
  if (engine === undefined || title === undefined) return undefined;
  if (!isTimestamp(value.completed_at)) return undefined;
  return {
    lesson_id: value.lesson_id,
    lesson_engine_id: engine,
    title,
    completed_at: value.completed_at,
  };
}

function readPremium(value: unknown): LearnerDirectoryRow['premium'] | null {
  if (!isRecord(value) || typeof value.effective !== 'boolean' || !Array.isArray(value.sources)) return null;
  const sources: PremiumSource[] = [];
  for (const source of value.sources) {
    const parsed = readSource(source);
    if (!parsed) return null;
    sources.push(parsed);
  }
  if (value.effective !== sources.length > 0) return null;
  return { effective: value.effective, sources };
}

function readSource(value: unknown): PremiumSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'production_purchase') {
    if (value.platform !== 'apple' && value.platform !== 'google') return null;
    if (value.store_source !== 'paid_purchase' && value.store_source !== 'offer_code' && value.store_source !== 'unknown') {
      return null;
    }
    if (value.grant_status !== 'active' && value.grant_status !== 'grace') return null;
    if ('grant_kind' in value) return null;
    return {
      kind: 'production_purchase',
      platform: value.platform,
      store_source: value.store_source,
      grant_status: value.grant_status,
    };
  }
  if (value.kind === 'account_grant') {
    if (value.grant_kind !== 'lifetime' && value.grant_kind !== 'migration_window') return null;
    if ('platform' in value || 'store_source' in value || 'grant_status' in value) return null;
    return { kind: 'account_grant', grant_kind: value.grant_kind };
  }
  return null;
}

function expectedPageCount(total: number, pageSize: number): number {
  if (total === 0) return 0;
  return Math.ceil(total / pageSize);
}

function expectedRowCount(total: number, page: number, pageSize: number, pageCount: number): number {
  if (pageCount === 0 || page > pageCount) return 0;
  return Math.min(pageSize, total - (page - 1) * pageSize);
}

function optionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() ? value : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function whole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNamedError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

async function readHttpError(error: unknown): Promise<{ status: number; code: string | null }> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return { status: 0, code: null };
  let code: string | null = null;
  try {
    if (!context.bodyUsed) {
      const body: unknown = await context.clone().json();
      if (isRecord(body) && typeof body.error === 'string') code = body.error;
    }
  } catch {
    code = null;
  }
  return { status: context.status, code };
}
