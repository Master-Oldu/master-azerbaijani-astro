/**
 * Individual learner action for the admin-dashboard Edge Function.
 * Field names follow the backend contract. This module does not call the
 * network and does not store responses.
 */

import type { PremiumSource } from './learners-contract';

export const LEARNER_FUNCTION = 'admin-dashboard';

export const LEARNER_HISTORY_PAGE_SIZE = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDATED_LIST_LIMIT = 100;
const PURCHASE_LIMIT = 200;
const GRANT_LIMIT = 50;

export interface LearnerRequestBody {
  action: 'learner';
  learner_id: string;
  history_page: number;
  history_page_size: 20;
}

export interface LearnerQuery {
  learnerId: string;
  historyPage: number;
}

export interface LearnerLesson {
  lesson_id: string;
  lesson_engine_id: string | null;
  title: string | null;
  lesson_order: number | null;
  completed: boolean;
  completed_at: string | null;
}

export type CompletionBasis = 'no_curriculum_lessons' | 'none' | 'undated_completion' | 'stored_progress_row';

export interface LearnerModule {
  id: string;
  module_key: string | null;
  title: string | null;
  module_order: number | null;
  is_published: boolean;
  lesson_count: number;
  completed_lesson_count: number;
  completion_percent: number | null;
  latest_completed_at: string | null;
  latest_completed_basis: CompletionBasis;
  lessons: LearnerLesson[];
}

export interface HistoryLesson {
  lesson_id: string;
  lesson_engine_id: string | null;
  title: string | null;
  module_id: string | null;
  module_key: string | null;
  module_title: string | null;
  completed_at?: string;
}

export interface LearnerHistory {
  basis: 'stored_progress_row';
  total: number;
  page: number;
  page_size: 20;
  page_count: number;
  rows: Array<HistoryLesson & { completed_at: string }>;
  undated_total: number;
  undated: HistoryLesson[];
}

export type PaymentClassification = 'promotional_code_indicated' | 'unknown' | 'legacy_unverified' | 'unrecognized';

export interface LearnerPurchase {
  id: string;
  platform: 'apple' | 'google';
  environment: 'production' | 'sandbox';
  product_id: string;
  product: 'lifetime' | 'monthly' | 'annual' | 'unrecognized';
  lineage_class: 'legacy' | 'standard';
  store_source: string;
  payment_classification: PaymentClassification;
  grant_status: 'active' | 'grace' | 'inactive' | 'pending';
  access_deadline: string | null;
  original_purchase_at: string | null;
  recorded_at: string;
  contributes_access: boolean;
}

export interface LearnerGrant {
  id: string;
  grant_kind: 'lifetime' | 'migration_window';
  status: 'provisioned' | 'active' | 'expired' | 'revoked';
  expires_at: string | null;
  recorded_at: string;
  contributes_access: boolean;
}

export interface LearnerDetail {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  sandbox_purchase_test_allowed: boolean;
  premium: {
    effective: boolean;
    sources: PremiumSource[];
  };
  modules: LearnerModule[];
  history: LearnerHistory;
  entitlements: {
    purchases: LearnerPurchase[];
    grants: LearnerGrant[];
  };
}

export type LearnerDenial = 'invalid_session' | 'not_admin';

export type LearnerOutcome =
  | { status: 'ok'; learner: LearnerDetail }
  | { status: 'denied'; reason: LearnerDenial; code: string | null }
  | { status: 'invalid_body'; code: 'invalid_body' }
  | { status: 'not_found'; code: 'learner_not_found' }
  | { status: 'unavailable'; code: string | null }
  | { status: 'network' };

/** A non-UUID is not sent. History page and page size are JSON numbers. */
export function buildLearnerRequest(learnerId: string, historyPage: number): LearnerRequestBody | null {
  const id = learnerId.trim().toLowerCase();
  if (!UUID.test(id)) return null;
  if (!Number.isInteger(historyPage) || historyPage < 1 || historyPage > 10000) return null;
  return {
    action: 'learner',
    learner_id: id,
    history_page: historyPage,
    history_page_size: LEARNER_HISTORY_PAGE_SIZE,
  };
}

export function parseLearnerPayload(body: unknown, expected: LearnerQuery): LearnerDetail | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const learner = body.learner;
  if (!isRecord(learner)) return null;
  const expectedId = expected.learnerId.trim().toLowerCase();
  if (!UUID.test(expectedId) || learner.user_id !== expectedId) return null;
  const email = optionalText(learner.email);
  const displayName = optionalText(learner.display_name);
  if (email === undefined || displayName === undefined) return null;
  if (!isTimestamp(learner.created_at)) return null;
  if (!(learner.last_sign_in_at === null || isTimestamp(learner.last_sign_in_at))) return null;
  if (typeof learner.sandbox_purchase_test_allowed !== 'boolean') return null;
  const premium = readPremium(learner.premium);
  if (!premium) return null;
  const modules = readModules(learner.modules);
  if (!modules) return null;
  const history = readHistory(learner.history, expected.historyPage);
  if (!history) return null;
  const entitlements = readEntitlements(learner.entitlements);
  if (!entitlements) return null;
  if (!countsAgree(modules, history)) return null;
  if (!historyAgrees(modules, history)) return null;
  if (!accessAgrees(premium, entitlements.purchases, entitlements.grants)) return null;

  return {
    user_id: expectedId,
    email,
    display_name: displayName,
    created_at: learner.created_at,
    last_sign_in_at: learner.last_sign_in_at,
    sandbox_purchase_test_allowed: learner.sandbox_purchase_test_allowed,
    premium,
    modules,
    history,
    entitlements,
  };
}

export async function readLearnerInvoke(
  result: { data: unknown; error: unknown },
  expected: LearnerQuery,
): Promise<LearnerOutcome> {
  const error = result.error;
  if (isNamedError(error, 'FunctionsFetchError')) return { status: 'network' };
  if (isNamedError(error, 'FunctionsRelayError')) return { status: 'unavailable', code: null };
  if (isNamedError(error, 'FunctionsHttpError')) {
    const http = await readHttpError(error);
    if (http.status === 401) return { status: 'denied', reason: 'invalid_session', code: http.code };
    if (http.status === 403) return { status: 'denied', reason: 'not_admin', code: http.code };
    if (http.status === 400 && http.code === 'invalid_body') return { status: 'invalid_body', code: 'invalid_body' };
    if (http.status === 404 && http.code === 'learner_not_found') return { status: 'not_found', code: 'learner_not_found' };
    return { status: 'unavailable', code: http.code };
  }
  if (error) return { status: 'unavailable', code: null };
  const parsed = parseLearnerPayload(result.data, expected);
  if (!parsed) return { status: 'unavailable', code: null };
  return { status: 'ok', learner: parsed };
}

function readModules(value: unknown): LearnerModule[] | null {
  if (!Array.isArray(value)) return null;
  const modules: LearnerModule[] = [];
  const seen = new Set<string>();
  const seenLessons = new Set<string>();
  for (const item of value) {
    const parsed = readModule(item, seenLessons);
    if (!parsed || seen.has(parsed.id)) return null;
    seen.add(parsed.id);
    modules.push(parsed);
  }
  return modules;
}

function readModule(value: unknown, seenLessons: Set<string>): LearnerModule | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value.id)) return null;
  const moduleKey = optionalText(value.module_key);
  const title = optionalText(value.title);
  const moduleOrder = integerOrNull(value.module_order);
  if (moduleKey === undefined || title === undefined || moduleOrder === undefined) return null;
  if (typeof value.is_published !== 'boolean') return null;
  const lessonCount = whole(value.lesson_count);
  const completedCount = whole(value.completed_lesson_count);
  if (lessonCount === null || completedCount === null || completedCount > lessonCount) return null;
  const basis = value.latest_completed_basis;
  if (basis !== 'no_curriculum_lessons' && basis !== 'none' && basis !== 'undated_completion' && basis !== 'stored_progress_row') {
    return null;
  }
  const latest = value.latest_completed_at;
  if (!(latest === null || isTimestamp(latest))) return null;
  if (!Array.isArray(value.lessons) || value.lessons.length !== lessonCount) return null;
  const lessons: LearnerLesson[] = [];
  for (const lesson of value.lessons) {
    const parsed = readLesson(lesson);
    if (!parsed || seenLessons.has(parsed.lesson_id)) return null;
    seenLessons.add(parsed.lesson_id);
    lessons.push(parsed);
  }
  const completedLessons = lessons.filter((lesson) => lesson.completed);
  if (completedLessons.length !== completedCount) return null;
  if (!percentMatches(value.completion_percent, completedCount, lessonCount)) return null;
  if (!basisMatches(basis, lessonCount, completedCount, latest, completedLessons)) return null;
  return {
    id: value.id,
    module_key: moduleKey,
    title,
    module_order: moduleOrder,
    is_published: value.is_published,
    lesson_count: lessonCount,
    completed_lesson_count: completedCount,
    completion_percent: lessonCount === 0 ? null : (value.completion_percent as number),
    latest_completed_at: latest,
    latest_completed_basis: basis,
    lessons,
  };
}

function readLesson(value: unknown): LearnerLesson | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value.lesson_id)) return null;
  const engine = optionalText(value.lesson_engine_id);
  const title = optionalText(value.title);
  const lessonOrder = integerOrNull(value.lesson_order);
  if (engine === undefined || title === undefined || lessonOrder === undefined) return null;
  if (typeof value.completed !== 'boolean') return null;
  if (value.completed) {
    if (!(value.completed_at === null || isTimestamp(value.completed_at))) return null;
  } else if (value.completed_at !== null) {
    return null;
  }
  return {
    lesson_id: value.lesson_id,
    lesson_engine_id: engine,
    title,
    lesson_order: lessonOrder,
    completed: value.completed,
    completed_at: value.completed ? value.completed_at : null,
  };
}

function basisMatches(
  basis: CompletionBasis,
  lessonCount: number,
  completedCount: number,
  latest: string | null,
  completedLessons: LearnerLesson[],
): boolean {
  if (basis === 'no_curriculum_lessons') {
    return lessonCount === 0 && completedCount === 0 && latest === null;
  }
  if (basis === 'none') {
    return lessonCount > 0 && completedCount === 0 && latest === null;
  }
  if (basis === 'undated_completion') {
    return completedLessons.some((lesson) => lesson.completed_at === null) && latest === null;
  }
  if (completedCount < 1 || latest === null) return false;
  if (completedLessons.some((lesson) => lesson.completed_at === null)) return false;
  const newest = Math.max(...completedLessons.map((lesson) => Date.parse(lesson.completed_at as string)));
  return Date.parse(latest) === newest;
}

function readHistory(value: unknown, historyPage: number): LearnerHistory | null {
  if (!isRecord(value) || value.basis !== 'stored_progress_row') return null;
  const total = whole(value.total);
  const undatedTotal = whole(value.undated_total);
  const pageCount = whole(value.page_count);
  if (total === null || undatedTotal === null || pageCount === null) return null;
  if (value.page !== historyPage || value.page_size !== LEARNER_HISTORY_PAGE_SIZE) return null;
  const expectedPages = total === 0 ? 0 : Math.ceil(total / LEARNER_HISTORY_PAGE_SIZE);
  if (pageCount !== expectedPages) return null;
  if (!Array.isArray(value.rows) || !Array.isArray(value.undated)) return null;
  const expectedRows = expectedPages === 0 || historyPage > expectedPages ? 0 : Math.min(LEARNER_HISTORY_PAGE_SIZE, total - (historyPage - 1) * LEARNER_HISTORY_PAGE_SIZE);
  if (value.rows.length !== expectedRows) return null;
  const expectedUndated = Math.min(undatedTotal, UNDATED_LIST_LIMIT);
  if (value.undated.length !== expectedUndated) return null;

  const rows: LearnerHistory['rows'] = [];
  const seen = new Set<string>();
  for (const row of value.rows) {
    const parsed = readHistoryLesson(row, true);
    if (!parsed || !parsed.completed_at || seen.has(parsed.lesson_id)) return null;
    seen.add(parsed.lesson_id);
    rows.push({ ...parsed, completed_at: parsed.completed_at });
  }
  const undated: HistoryLesson[] = [];
  for (const row of value.undated) {
    if (!isRecord(row) || 'completed_at' in row) return null;
    const parsed = readHistoryLesson(row, false);
    if (!parsed || seen.has(parsed.lesson_id)) return null;
    seen.add(parsed.lesson_id);
    undated.push(parsed);
  }
  return {
    basis: 'stored_progress_row',
    total,
    page: historyPage,
    page_size: LEARNER_HISTORY_PAGE_SIZE,
    page_count: pageCount,
    rows,
    undated_total: undatedTotal,
    undated,
  };
}

function readHistoryLesson(value: unknown, dated: boolean): HistoryLesson | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value.lesson_id)) return null;
  const engine = optionalText(value.lesson_engine_id);
  const title = optionalText(value.title);
  const moduleId = optionalText(value.module_id);
  const moduleKey = optionalText(value.module_key);
  const moduleTitle = optionalText(value.module_title);
  if (engine === undefined || title === undefined || moduleId === undefined || moduleKey === undefined || moduleTitle === undefined) {
    return null;
  }
  if (dated) {
    if (!isTimestamp(value.completed_at)) return null;
  }
  return {
    lesson_id: value.lesson_id,
    lesson_engine_id: engine,
    title,
    module_id: moduleId,
    module_key: moduleKey,
    module_title: moduleTitle,
    ...(dated ? { completed_at: value.completed_at as string } : {}),
  };
}

function readEntitlements(value: unknown): LearnerDetail['entitlements'] | null {
  if (!isRecord(value) || !Array.isArray(value.purchases) || !Array.isArray(value.grants)) return null;
  if (value.purchases.length > PURCHASE_LIMIT || value.grants.length > GRANT_LIMIT) return null;
  const purchases: LearnerPurchase[] = [];
  const purchaseIds = new Set<string>();
  for (const purchase of value.purchases) {
    const parsed = readPurchase(purchase);
    if (!parsed || purchaseIds.has(parsed.id)) return null;
    purchaseIds.add(parsed.id);
    purchases.push(parsed);
  }
  const grants: LearnerGrant[] = [];
  const grantIds = new Set<string>();
  for (const grant of value.grants) {
    const parsed = readGrant(grant);
    if (!parsed || grantIds.has(parsed.id)) return null;
    grantIds.add(parsed.id);
    grants.push(parsed);
  }
  return { purchases, grants };
}

function readPurchase(value: unknown): LearnerPurchase | null {
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.product_id)) return null;
  if (value.platform !== 'apple' && value.platform !== 'google') return null;
  if (value.environment !== 'production' && value.environment !== 'sandbox') return null;
  if (value.product !== 'lifetime' && value.product !== 'monthly' && value.product !== 'annual' && value.product !== 'unrecognized') {
    return null;
  }
  if (!productMatches(value.product_id, value.product)) return null;
  if (value.lineage_class !== 'legacy' && value.lineage_class !== 'standard') return null;
  if (typeof value.store_source !== 'string' || !value.store_source.trim()) return null;
  const classification = paymentFor(value.store_source, value.payment_classification);
  if (!classification) return null;
  if (value.grant_status !== 'active' && value.grant_status !== 'grace' && value.grant_status !== 'inactive' && value.grant_status !== 'pending') {
    return null;
  }
  if (!(value.access_deadline === null || isTimestamp(value.access_deadline))) return null;
  if (!(value.original_purchase_at === null || isTimestamp(value.original_purchase_at))) return null;
  if (!isTimestamp(value.recorded_at) || typeof value.contributes_access !== 'boolean') return null;
  const contributes = value.environment === 'production' && (value.grant_status === 'active' || value.grant_status === 'grace');
  if (value.contributes_access !== contributes) return null;
  return {
    id: value.id,
    platform: value.platform,
    environment: value.environment,
    product_id: value.product_id,
    product: value.product,
    lineage_class: value.lineage_class,
    store_source: value.store_source,
    payment_classification: classification,
    grant_status: value.grant_status,
    access_deadline: value.access_deadline,
    original_purchase_at: value.original_purchase_at,
    recorded_at: value.recorded_at,
    contributes_access: value.contributes_access,
  };
}

function readGrant(value: unknown): LearnerGrant | null {
  if (!isRecord(value) || !nonEmpty(value.id)) return null;
  if (value.grant_kind !== 'lifetime' && value.grant_kind !== 'migration_window') return null;
  if (value.status !== 'provisioned' && value.status !== 'active' && value.status !== 'expired' && value.status !== 'revoked') {
    return null;
  }
  if (!(value.expires_at === null || isTimestamp(value.expires_at))) return null;
  if (!isTimestamp(value.recorded_at) || typeof value.contributes_access !== 'boolean') return null;
  if (value.status !== 'active' && value.contributes_access) return null;
  if (value.status === 'active' && value.expires_at === null && !value.contributes_access) return null;
  return {
    id: value.id,
    grant_kind: value.grant_kind,
    status: value.status,
    expires_at: value.expires_at,
    recorded_at: value.recorded_at,
    contributes_access: value.contributes_access,
  };
}

function readPremium(value: unknown): LearnerDetail['premium'] | null {
  if (!isRecord(value) || typeof value.effective !== 'boolean' || !Array.isArray(value.sources)) return null;
  const sources: PremiumSource[] = [];
  const seen = new Set<string>();
  for (const source of value.sources) {
    const parsed = readSource(source);
    if (!parsed) return null;
    const key = sourceKey(parsed);
    if (seen.has(key)) return null;
    seen.add(key);
    sources.push(parsed);
  }
  if (value.effective !== sources.length > 0) return null;
  return { effective: value.effective, sources };
}

function readSource(value: unknown): PremiumSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'production_purchase') {
    if (value.platform !== 'apple' && value.platform !== 'google') return null;
    if (value.store_source !== 'paid_purchase' && value.store_source !== 'offer_code' && value.store_source !== 'unknown') return null;
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

function countsAgree(modules: LearnerModule[], history: LearnerHistory): boolean {
  let dated = 0;
  let undated = 0;
  for (const module of modules) {
    for (const lesson of module.lessons) {
      if (!lesson.completed) continue;
      if (lesson.completed_at) dated += 1;
      else undated += 1;
    }
  }
  return dated <= history.total && undated <= history.undated_total;
}

function historyAgrees(modules: LearnerModule[], history: LearnerHistory): boolean {
  const byLesson = new Map<string, LearnerLesson>();
  for (const module of modules) {
    for (const lesson of module.lessons) byLesson.set(lesson.lesson_id, lesson);
  }
  const undatedIds = new Set(history.undated.map((row) => row.lesson_id));
  for (const row of history.rows) {
    const known = byLesson.get(row.lesson_id);
    if (known && (!known.completed || !sameInstant(known.completed_at, row.completed_at))) return false;
    if (undatedIds.has(row.lesson_id)) return false;
  }
  for (const row of history.undated) {
    const known = byLesson.get(row.lesson_id);
    if (known && (!known.completed || known.completed_at !== null)) return false;
  }
  if (history.undated_total > UNDATED_LIST_LIMIT) return true;
  for (const lesson of byLesson.values()) {
    if (lesson.completed && lesson.completed_at === null && !undatedIds.has(lesson.lesson_id)) return false;
  }
  return true;
}

function accessAgrees(premium: LearnerDetail['premium'], purchases: LearnerPurchase[], grants: LearnerGrant[]): boolean {
  const contributing = new Set<string>();
  for (const purchase of purchases) {
    if (!purchase.contributes_access) continue;
    contributing.add(`purchase:${purchase.platform}:${purchase.store_source}:${purchase.grant_status}`);
  }
  for (const grant of grants) {
    if (!grant.contributes_access) continue;
    contributing.add(`grant:${grant.grant_kind}`);
  }
  if (premium.effective !== contributing.size > 0) return false;
  if (premium.sources.length !== contributing.size) return false;
  const seen = new Set<string>();
  for (const source of premium.sources) {
    const key = sourceKey(source);
    if (seen.has(key) || !contributing.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function sourceKey(source: PremiumSource): string {
  if (source.kind === 'production_purchase') {
    return `purchase:${source.platform}:${source.store_source}:${source.grant_status}`;
  }
  return `grant:${source.grant_kind}`;
}

function productMatches(productId: string, product: string): boolean {
  const expected =
    productId === 'lifetime_access' ? 'lifetime' : productId === 'master_monthly' ? 'monthly' : productId === 'master_annual' ? 'annual' : 'unrecognized';
  return product === expected;
}

function paymentFor(storeSource: string, classification: unknown): PaymentClassification | null {
  if (storeSource === 'offer_code') return classification === 'promotional_code_indicated' ? classification : null;
  if (storeSource === 'unknown') return classification === 'unknown' ? classification : null;
  if (storeSource === 'paid_purchase') return classification === 'legacy_unverified' ? classification : null;
  return classification === 'unrecognized' ? classification : null;
}

function percentMatches(percent: unknown, completed: number, lessonCount: number): boolean {
  if (lessonCount === 0) return percent === null;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return false;
  const expected = Math.round((completed / lessonCount) * 1000) / 10;
  return Math.abs(percent - expected) < 0.001;
}

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return Date.parse(left) === Date.parse(right);
}

function optionalText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() ? value : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function whole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function integerOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isSafeInteger(value)) return undefined;
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
