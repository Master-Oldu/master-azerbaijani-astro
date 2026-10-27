/**
 * Purchases directory action for the admin-dashboard Edge Function.
 * Field names follow the backend contract. This module does not call the
 * network and does not store responses.
 */

export const PURCHASES_FUNCTION = 'admin-dashboard';

export const PURCHASES_PAGE_SIZE = 20;

const SEARCH_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ['all', 'apple', 'google', 'grant'] as const;
const PRODUCTS = ['all', 'monthly', 'annual', 'lifetime'] as const;
const PAYMENTS = ['all', 'promotional_code_indicated', 'unknown', 'legacy_unverified'] as const;
const ENTITLEMENTS = ['all', 'active', 'grace', 'expired', 'revoked', 'inactive', 'pending', 'provisioned'] as const;
const OWNERSHIPS = ['all', 'owned', 'unowned'] as const;
const ENVIRONMENTS = ['production', 'sandbox', 'all'] as const;
const RESOLUTIONS = ['all', 'required', 'not_required'] as const;
const INACTIVE_REASONS = new Set(['expired', 'revoked', 'refunded', 'canceled', 'paused', 'hold', 'unknown', 'unrecognized']);

export interface PurchaseFilters {
  platform: (typeof PLATFORMS)[number];
  product: (typeof PRODUCTS)[number];
  payment_classification: (typeof PAYMENTS)[number];
  entitlement: (typeof ENTITLEMENTS)[number];
  ownership: (typeof OWNERSHIPS)[number];
  environment: (typeof ENVIRONMENTS)[number];
  resolution: (typeof RESOLUTIONS)[number];
}

export const DEFAULT_PURCHASE_FILTERS: PurchaseFilters = {
  platform: 'all',
  product: 'all',
  payment_classification: 'all',
  entitlement: 'all',
  ownership: 'all',
  environment: 'production',
  resolution: 'all',
};

export interface PurchasesRequestBody {
  action: 'purchases';
  page: number;
  page_size: 20;
  environment: PurchaseFilters['environment'];
  search?: string;
  platform?: Exclude<PurchaseFilters['platform'], 'all'>;
  product?: Exclude<PurchaseFilters['product'], 'all'>;
  payment_classification?: Exclude<PurchaseFilters['payment_classification'], 'all'>;
  entitlement?: Exclude<PurchaseFilters['entitlement'], 'all'>;
  ownership?: Exclude<PurchaseFilters['ownership'], 'all'>;
  resolution?: Exclude<PurchaseFilters['resolution'], 'all'>;
}

export interface PurchasesQuery {
  search: string | null;
  page: number;
  filters: PurchaseFilters;
}

export interface PurchaseAccount {
  user_id: string;
  email: string | null;
  display_name: string | null;
  sandbox_purchase_test_allowed: boolean;
}

interface PurchaseRowBase {
  id: string;
  entitlement_status: 'active' | 'grace' | 'pending' | 'expired' | 'revoked' | 'inactive' | 'provisioned';
  ownership: 'owned' | 'unowned';
  account: PurchaseAccount | null;
  recorded_at: string;
  updated_at: string;
  contributes_access: boolean;
  expiration_lapsed: boolean;
  explicitly_requiring_review: boolean;
  review_basis: 'pending_legacy_link_request' | null;
}

export interface StorePurchaseRow extends PurchaseRowBase {
  record_kind: 'store';
  platform: 'apple' | 'google';
  environment: 'production' | 'sandbox';
  product_id: string;
  product: 'lifetime' | 'monthly' | 'annual' | 'unrecognized';
  lineage_class: 'legacy' | 'standard';
  store_source: 'paid_purchase' | 'offer_code' | 'unknown';
  payment_classification: 'promotional_code_indicated' | 'unknown' | 'legacy_unverified';
  grant_status: 'active' | 'grace' | 'inactive' | 'pending';
  inactive_reason: string | null;
  access_deadline: string | null;
  original_purchase_at: string | null;
  grant_kind: null;
  grant_expires_at: null;
}

export interface GrantPurchaseRow extends PurchaseRowBase {
  record_kind: 'grant';
  platform: null;
  environment: null;
  product_id: null;
  product: 'lifetime' | null;
  lineage_class: null;
  store_source: null;
  payment_classification: null;
  grant_status: null;
  inactive_reason: null;
  access_deadline: null;
  original_purchase_at: null;
  grant_kind: 'lifetime' | 'migration_window';
  grant_expires_at: string | null;
}

export type PurchaseRow = StorePurchaseRow | GrantPurchaseRow;

export interface FilteredSummary {
  applies_to: 'current_filters';
  ignores_filters: false;
  matching_records: number;
  production_store_records: number;
  sandbox_store_records: number;
  apple_records: number;
  google_records: number;
  promotional_code_records: number;
  grant_records: number;
  unowned_production_store_records: number;
  explicitly_requiring_review: number;
}

export interface CatalogSummary {
  applies_to: 'all_production_store_records_and_all_grants';
  ignores_filters: true;
  production_store_records: number;
  sandbox_store_records: number;
  apple_records: number;
  google_records: number;
  promotional_code_records: number;
  grant_records: number;
  unowned_production_store_records: number;
  explicitly_requiring_review: number;
}

export interface PurchasesPayload {
  filters: PurchaseFilters;
  search: string | null;
  page: number;
  page_size: 20;
  total: number;
  page_count: number;
  rows: PurchaseRow[];
  summary: {
    filtered: FilteredSummary;
    production_catalog: CatalogSummary;
    counting: {
      record_unit: 'entitlement_or_grant_row';
      lineage_means: 'one_stored_entitlement_not_each_payment_or_renewal';
      promotional_code_records: 'subset_of_store_rows_not_an_extra_transaction';
      production_catalog_store_counts: 'production_only';
      production_catalog_sandbox_store_records: 'excluded_from_every_other_production_catalog_count';
    };
    unavailable: {
      revenue: string;
      payment_amounts: string;
      verified_payments: string;
      renewal_events: string;
      redemption_codes: string;
      unresolved_without_link_request: string;
    };
  };
}

export type PurchasesDenial = 'invalid_session' | 'not_admin';

export type PurchasesOutcome =
  | { status: 'ok'; purchases: PurchasesPayload }
  | { status: 'denied'; reason: PurchasesDenial; code: string | null }
  | { status: 'invalid_body'; code: 'invalid_body' }
  | { status: 'unavailable'; code: string | null }
  | { status: 'network' };

/** Defaults stay omitted except environment, which the Purchases screen always names. */
export function buildPurchasesRequest(search: string, page: number, filters: PurchaseFilters): PurchasesRequestBody | null {
  const trimmed = search.trim();
  if (trimmed.length > SEARCH_LIMIT) return null;
  if (!Number.isInteger(page) || page < 1 || page > 10000) return null;
  if (!isFilters(filters)) return null;
  const body: PurchasesRequestBody = {
    action: 'purchases',
    page,
    page_size: PURCHASES_PAGE_SIZE,
    environment: filters.environment,
  };
  if (trimmed) body.search = trimmed;
  if (filters.platform !== 'all') body.platform = filters.platform;
  if (filters.product !== 'all') body.product = filters.product;
  if (filters.payment_classification !== 'all') body.payment_classification = filters.payment_classification;
  if (filters.entitlement !== 'all') body.entitlement = filters.entitlement;
  if (filters.ownership !== 'all') body.ownership = filters.ownership;
  if (filters.resolution !== 'all') body.resolution = filters.resolution;
  return body;
}

export function parsePurchasesPayload(body: unknown, expected: PurchasesQuery): PurchasesPayload | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const purchases = body.purchases;
  if (!isRecord(purchases)) return null;
  const filters = readFilters(purchases.filters);
  if (!filters || !sameFilters(filters, expected.filters)) return null;
  if (expected.search === null) {
    if (purchases.search !== null) return null;
  } else if (purchases.search !== expected.search) return null;
  if (purchases.page !== expected.page || purchases.page_size !== PURCHASES_PAGE_SIZE) return null;
  const total = whole(purchases.total);
  const pageCount = whole(purchases.page_count);
  if (total === null || pageCount === null) return null;
  const expectedPages = total === 0 ? 0 : Math.ceil(total / PURCHASES_PAGE_SIZE);
  if (pageCount !== expectedPages) return null;
  if (!Array.isArray(purchases.rows)) return null;
  const expectedRows = expectedPages === 0 || expected.page > expectedPages ? 0 : Math.min(PURCHASES_PAGE_SIZE, total - (expected.page - 1) * PURCHASES_PAGE_SIZE);
  if (purchases.rows.length !== expectedRows) return null;

  const rows: PurchaseRow[] = [];
  const seen = new Set<string>();
  for (const row of purchases.rows) {
    const parsed = readRow(row);
    if (!parsed || seen.has(`${parsed.record_kind}:${parsed.id}`)) return null;
    if (!rowMatches(parsed, filters, expected.search)) return null;
    seen.add(`${parsed.record_kind}:${parsed.id}`);
    rows.push(parsed);
  }

  const summary = readSummary(purchases.summary, total, rows);
  if (!summary || !summaryMatchesFilters(summary.filtered, filters)) return null;
  return {
    filters,
    search: expected.search,
    page: expected.page,
    page_size: PURCHASES_PAGE_SIZE,
    total,
    page_count: pageCount,
    rows,
    summary,
  };
}

export async function readPurchasesInvoke(
  result: { data: unknown; error: unknown },
  expected: PurchasesQuery,
): Promise<PurchasesOutcome> {
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
  const parsed = parsePurchasesPayload(result.data, expected);
  if (!parsed) return { status: 'unavailable', code: null };
  return { status: 'ok', purchases: parsed };
}

function readRow(value: unknown): PurchaseRow | null {
  if (!isRecord(value) || !nonEmpty(value.id)) return null;
  if (value.record_kind === 'store') return readStore(value);
  if (value.record_kind === 'grant') return readGrant(value);
  return null;
}

function readStore(value: Record<string, unknown>): StorePurchaseRow | null {
  if (value.platform !== 'apple' && value.platform !== 'google') return null;
  if (value.environment !== 'production' && value.environment !== 'sandbox') return null;
  if (!nonEmpty(value.product_id)) return null;
  if (value.product !== 'lifetime' && value.product !== 'monthly' && value.product !== 'annual' && value.product !== 'unrecognized') return null;
  if (!productMatches(value.product_id, value.product)) return null;
  if (value.lineage_class !== 'legacy' && value.lineage_class !== 'standard') return null;
  if (value.store_source !== 'paid_purchase' && value.store_source !== 'offer_code' && value.store_source !== 'unknown') return null;
  const payment = paymentFor(value.store_source, value.payment_classification);
  if (!payment) return null;
  if (value.grant_status !== 'active' && value.grant_status !== 'grace' && value.grant_status !== 'inactive' && value.grant_status !== 'pending') return null;
  if (value.grant_status === 'inactive') {
    if (!(value.inactive_reason === null || (typeof value.inactive_reason === 'string' && INACTIVE_REASONS.has(value.inactive_reason)))) return null;
  } else if (value.inactive_reason !== null) return null;
  const entitlement = storeEntitlement(value.grant_status, value.inactive_reason);
  if (value.entitlement_status !== entitlement) return null;
  if (value.ownership !== 'owned' && value.ownership !== 'unowned') return null;
  const account = readAccount(value.account, value.ownership === 'owned');
  if (account === undefined) return null;
  if (!(value.access_deadline === null || isTimestamp(value.access_deadline))) return null;
  if (value.grant_expires_at !== null || value.grant_kind !== null) return null;
  if (!(value.original_purchase_at === null || isTimestamp(value.original_purchase_at))) return null;
  if (!isTimestamp(value.recorded_at) || !isTimestamp(value.updated_at)) return null;
  if (typeof value.contributes_access !== 'boolean' || value.expiration_lapsed !== false) return null;
  const contributes = value.ownership === 'owned' && value.environment === 'production' && (value.grant_status === 'active' || value.grant_status === 'grace');
  if (value.contributes_access !== contributes) return null;
  if (typeof value.explicitly_requiring_review !== 'boolean') return null;
  if (value.explicitly_requiring_review) {
    if (value.ownership !== 'unowned' || value.lineage_class !== 'legacy' || value.review_basis !== 'pending_legacy_link_request') return null;
  } else if (value.review_basis !== null) return null;
  return {
    record_kind: 'store',
    id: value.id as string,
    platform: value.platform,
    environment: value.environment,
    product_id: value.product_id,
    product: value.product,
    lineage_class: value.lineage_class,
    store_source: value.store_source,
    payment_classification: payment,
    grant_status: value.grant_status,
    inactive_reason: value.grant_status === 'inactive' ? (value.inactive_reason as string | null) : null,
    entitlement_status: entitlement,
    ownership: value.ownership,
    account,
    access_deadline: value.access_deadline,
    grant_expires_at: null,
    original_purchase_at: value.original_purchase_at,
    recorded_at: value.recorded_at,
    updated_at: value.updated_at,
    contributes_access: value.contributes_access,
    expiration_lapsed: false,
    explicitly_requiring_review: value.explicitly_requiring_review,
    review_basis: value.explicitly_requiring_review ? 'pending_legacy_link_request' : null,
    grant_kind: null,
  };
}

function readGrant(value: Record<string, unknown>): GrantPurchaseRow | null {
  if (value.platform !== null || value.environment !== null || value.product_id !== null) return null;
  if (value.store_source !== null || value.payment_classification !== null || value.grant_status !== null || value.inactive_reason !== null) return null;
  if (value.lineage_class !== null || value.access_deadline !== null || value.original_purchase_at !== null) return null;
  if (value.grant_kind !== 'lifetime' && value.grant_kind !== 'migration_window') return null;
  if (value.grant_kind === 'lifetime' && value.product !== 'lifetime') return null;
  if (value.grant_kind === 'migration_window' && value.product !== null) return null;
  if (value.entitlement_status !== 'provisioned' && value.entitlement_status !== 'active' && value.entitlement_status !== 'expired' && value.entitlement_status !== 'revoked') return null;
  if (value.ownership !== 'owned') return null;
  const account = readAccount(value.account, true);
  if (!account) return null;
  if (!(value.grant_expires_at === null || isTimestamp(value.grant_expires_at))) return null;
  if (!isTimestamp(value.recorded_at) || !isTimestamp(value.updated_at)) return null;
  if (typeof value.contributes_access !== 'boolean' || typeof value.expiration_lapsed !== 'boolean') return null;
  if (value.explicitly_requiring_review !== false || value.review_basis !== null) return null;
  const lapsed = value.expiration_lapsed;
  if (value.entitlement_status !== 'active' || value.grant_expires_at === null) {
    if (lapsed) return null;
  }
  if (value.entitlement_status !== 'active' && value.contributes_access) return null;
  if (lapsed && value.contributes_access) return null;
  if (value.entitlement_status === 'active' && value.grant_expires_at === null && !value.contributes_access) return null;
  if (value.entitlement_status === 'active' && value.grant_expires_at !== null && lapsed !== !value.contributes_access) return null;
  return {
    record_kind: 'grant',
    id: value.id as string,
    platform: null,
    environment: null,
    product_id: null,
    product: value.grant_kind === 'lifetime' ? 'lifetime' : null,
    lineage_class: null,
    store_source: null,
    payment_classification: null,
    grant_status: null,
    inactive_reason: null,
    entitlement_status: value.entitlement_status,
    ownership: 'owned',
    account,
    access_deadline: null,
    grant_expires_at: value.grant_expires_at,
    original_purchase_at: null,
    recorded_at: value.recorded_at,
    updated_at: value.updated_at,
    contributes_access: value.contributes_access,
    expiration_lapsed: lapsed,
    explicitly_requiring_review: false,
    review_basis: null,
    grant_kind: value.grant_kind,
  };
}

function readAccount(value: unknown, required: boolean): PurchaseAccount | null | undefined {
  if (!required) return value === null ? null : undefined;
  if (!isRecord(value) || typeof value.user_id !== 'string' || !UUID.test(value.user_id)) return undefined;
  const email = optionalText(value.email);
  const displayName = optionalText(value.display_name);
  if (email === undefined || displayName === undefined || typeof value.sandbox_purchase_test_allowed !== 'boolean') return undefined;
  return {
    user_id: value.user_id,
    email,
    display_name: displayName,
    sandbox_purchase_test_allowed: value.sandbox_purchase_test_allowed,
  };
}

function readSummary(value: unknown, total: number, rows: PurchaseRow[]): PurchasesPayload['summary'] | null {
  if (!isRecord(value)) return null;
  const filtered = readFiltered(value.filtered);
  const catalog = readCatalog(value.production_catalog);
  if (!filtered || !catalog || !countingMatches(value.counting) || !readUnavailable(value.unavailable)) return null;
  if (!filteredMath(filtered, total) || !catalogMath(catalog) || !pageFits(rows, filtered, total)) return null;
  const unavailable = value.unavailable as PurchasesPayload['summary']['unavailable'];
  return {
    filtered,
    production_catalog: catalog,
    counting: {
      record_unit: 'entitlement_or_grant_row',
      lineage_means: 'one_stored_entitlement_not_each_payment_or_renewal',
      promotional_code_records: 'subset_of_store_rows_not_an_extra_transaction',
      production_catalog_store_counts: 'production_only',
      production_catalog_sandbox_store_records: 'excluded_from_every_other_production_catalog_count',
    },
    unavailable: {
      revenue: unavailable.revenue,
      payment_amounts: unavailable.payment_amounts,
      verified_payments: unavailable.verified_payments,
      renewal_events: unavailable.renewal_events,
      redemption_codes: unavailable.redemption_codes,
      unresolved_without_link_request: unavailable.unresolved_without_link_request,
    },
  };
}

function readFiltered(value: unknown): FilteredSummary | null {
  if (!isRecord(value) || value.applies_to !== 'current_filters' || value.ignores_filters !== false) return null;
  const counts = readCounts(value, true);
  if (!counts) return null;
  return { applies_to: 'current_filters', ignores_filters: false, ...counts };
}

function readCatalog(value: unknown): CatalogSummary | null {
  if (!isRecord(value) || value.applies_to !== 'all_production_store_records_and_all_grants' || value.ignores_filters !== true) return null;
  const counts = readCounts(value, false);
  if (!counts) return null;
  return { applies_to: 'all_production_store_records_and_all_grants', ignores_filters: true, ...counts };
}

function readCounts(value: Record<string, unknown>, filtered: boolean): Omit<FilteredSummary, 'applies_to' | 'ignores_filters'> | null {
  const production = whole(value.production_store_records);
  const sandbox = whole(value.sandbox_store_records);
  const apple = whole(value.apple_records);
  const google = whole(value.google_records);
  const promotional = whole(value.promotional_code_records);
  const grants = whole(value.grant_records);
  const unowned = whole(value.unowned_production_store_records);
  const review = whole(value.explicitly_requiring_review);
  if (production === null || sandbox === null || apple === null || google === null || promotional === null || grants === null || unowned === null || review === null) return null;
  const matching = filtered ? whole(value.matching_records) : production + sandbox + grants;
  if (matching === null) return null;
  return {
    ...(filtered ? { matching_records: matching } : {}),
    production_store_records: production,
    sandbox_store_records: sandbox,
    apple_records: apple,
    google_records: google,
    promotional_code_records: promotional,
    grant_records: grants,
    unowned_production_store_records: unowned,
    explicitly_requiring_review: review,
  } as Omit<FilteredSummary, 'applies_to' | 'ignores_filters'>;
}

function filteredMath(summary: FilteredSummary, total: number): boolean {
  if (summary.matching_records !== total) return false;
  if (summary.matching_records !== summary.production_store_records + summary.sandbox_store_records + summary.grant_records) return false;
  if (summary.apple_records + summary.google_records !== summary.production_store_records + summary.sandbox_store_records) return false;
  if (summary.promotional_code_records > summary.apple_records + summary.google_records) return false;
  if (summary.unowned_production_store_records > summary.production_store_records) return false;
  if (summary.explicitly_requiring_review > summary.matching_records) return false;
  return true;
}

function catalogMath(summary: CatalogSummary): boolean {
  if (summary.apple_records + summary.google_records !== summary.production_store_records) return false;
  if (summary.promotional_code_records > summary.production_store_records) return false;
  if (summary.unowned_production_store_records > summary.production_store_records) return false;
  if (summary.explicitly_requiring_review > summary.production_store_records) return false;
  return true;
}

function pageFits(rows: PurchaseRow[], summary: FilteredSummary, total: number): boolean {
  const seen = countRows(rows);
  const complete = rows.length === total;
  const compare = (left: number, right: number) => (complete ? left === right : left <= right);
  return compare(seen.production, summary.production_store_records)
    && compare(seen.sandbox, summary.sandbox_store_records)
    && compare(seen.apple, summary.apple_records)
    && compare(seen.google, summary.google_records)
    && compare(seen.promotional, summary.promotional_code_records)
    && compare(seen.grants, summary.grant_records)
    && compare(seen.unownedProduction, summary.unowned_production_store_records)
    && compare(seen.review, summary.explicitly_requiring_review);
}

function summaryMatchesFilters(summary: FilteredSummary, filters: PurchaseFilters): boolean {
  if (filters.environment === 'sandbox' && (summary.production_store_records !== 0 || summary.grant_records !== 0 || summary.unowned_production_store_records !== 0)) return false;
  if (filters.environment === 'production' && summary.sandbox_store_records !== 0) return false;
  if (filters.platform === 'grant' && (summary.production_store_records !== 0 || summary.sandbox_store_records !== 0 || summary.explicitly_requiring_review !== 0)) return false;
  if (filters.platform === 'apple' && (summary.google_records !== 0 || summary.grant_records !== 0)) return false;
  if (filters.platform === 'google' && (summary.apple_records !== 0 || summary.grant_records !== 0)) return false;
  if (filters.ownership === 'unowned' && summary.grant_records !== 0) return false;
  if (filters.ownership === 'owned' && (summary.unowned_production_store_records !== 0 || summary.explicitly_requiring_review !== 0)) return false;
  if (filters.resolution === 'required' && summary.explicitly_requiring_review !== summary.matching_records) return false;
  if (filters.resolution === 'not_required' && summary.explicitly_requiring_review !== 0) return false;
  return true;
}

function rowMatches(row: PurchaseRow, filters: PurchaseFilters, search: string | null): boolean {
  if (filters.platform === 'apple' && !(row.record_kind === 'store' && row.platform === 'apple')) return false;
  if (filters.platform === 'google' && !(row.record_kind === 'store' && row.platform === 'google')) return false;
  if (filters.platform === 'grant' && row.record_kind !== 'grant') return false;
  if (filters.product !== 'all' && row.product !== filters.product) return false;
  if (filters.payment_classification !== 'all' && !(row.record_kind === 'store' && row.payment_classification === filters.payment_classification)) return false;
  if (filters.entitlement !== 'all' && row.entitlement_status !== filters.entitlement) return false;
  if (filters.ownership !== 'all' && row.ownership !== filters.ownership) return false;
  if (filters.environment === 'production' && row.record_kind === 'store' && row.environment !== 'production') return false;
  if (filters.environment === 'sandbox' && !(row.record_kind === 'store' && row.environment === 'sandbox')) return false;
  if (filters.resolution === 'required' && !row.explicitly_requiring_review) return false;
  if (filters.resolution === 'not_required' && row.explicitly_requiring_review) return false;
  if (search !== null && !matchesSearch(row, search)) return false;
  return true;
}

function matchesSearch(row: PurchaseRow, search: string): boolean {
  if (!row.account) return false;
  const query = search.toLowerCase();
  if (UUID.test(search) && row.account.user_id.toLowerCase() === query) return true;
  return (row.account.email ?? '').toLowerCase().includes(query) || (row.account.display_name ?? '').toLowerCase().includes(query);
}

function countRows(rows: PurchaseRow[]): {
  production: number;
  sandbox: number;
  apple: number;
  google: number;
  promotional: number;
  grants: number;
  unownedProduction: number;
  review: number;
} {
  const counts = { production: 0, sandbox: 0, apple: 0, google: 0, promotional: 0, grants: 0, unownedProduction: 0, review: 0 };
  for (const row of rows) {
    if (row.explicitly_requiring_review) counts.review += 1;
    if (row.record_kind === 'grant') {
      counts.grants += 1;
      continue;
    }
    if (row.environment === 'production') counts.production += 1;
    else counts.sandbox += 1;
    if (row.platform === 'apple') counts.apple += 1;
    else counts.google += 1;
    if (row.payment_classification === 'promotional_code_indicated') counts.promotional += 1;
    if (row.environment === 'production' && row.ownership === 'unowned') counts.unownedProduction += 1;
  }
  return counts;
}

function storeEntitlement(status: StorePurchaseRow['grant_status'], reason: unknown): StorePurchaseRow['entitlement_status'] {
  if (status === 'active' || status === 'grace' || status === 'pending') return status;
  if (reason === 'expired') return 'expired';
  if (reason === 'revoked') return 'revoked';
  return 'inactive';
}

function countingMatches(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.record_unit === 'entitlement_or_grant_row'
    && value.lineage_means === 'one_stored_entitlement_not_each_payment_or_renewal'
    && value.promotional_code_records === 'subset_of_store_rows_not_an_extra_transaction'
    && value.production_catalog_store_counts === 'production_only'
    && value.production_catalog_sandbox_store_records === 'excluded_from_every_other_production_catalog_count';
}

function readUnavailable(value: unknown): value is PurchasesPayload['summary']['unavailable'] {
  if (!isRecord(value)) return false;
  return explanation(value.revenue)
    && explanation(value.payment_amounts)
    && explanation(value.verified_payments)
    && explanation(value.renewal_events)
    && explanation(value.redemption_codes)
    && explanation(value.unresolved_without_link_request);
}

function explanation(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 400 && !value.includes('@');
}

function isFilters(value: PurchaseFilters): boolean {
  return PLATFORMS.includes(value.platform)
    && PRODUCTS.includes(value.product)
    && PAYMENTS.includes(value.payment_classification)
    && ENTITLEMENTS.includes(value.entitlement)
    && OWNERSHIPS.includes(value.ownership)
    && ENVIRONMENTS.includes(value.environment)
    && RESOLUTIONS.includes(value.resolution);
}

function readFilters(value: unknown): PurchaseFilters | null {
  if (!isRecord(value)) return null;
  const filters = {
    platform: value.platform,
    product: value.product,
    payment_classification: value.payment_classification,
    entitlement: value.entitlement,
    ownership: value.ownership,
    environment: value.environment,
    resolution: value.resolution,
  } as PurchaseFilters;
  return isFilters(filters) ? filters : null;
}

function sameFilters(left: PurchaseFilters, right: PurchaseFilters): boolean {
  return left.platform === right.platform
    && left.product === right.product
    && left.payment_classification === right.payment_classification
    && left.entitlement === right.entitlement
    && left.ownership === right.ownership
    && left.environment === right.environment
    && left.resolution === right.resolution;
}

function productMatches(productId: string, product: string): boolean {
  const expected = productId === 'lifetime_access' ? 'lifetime' : productId === 'master_monthly' ? 'monthly' : productId === 'master_annual' ? 'annual' : 'unrecognized';
  return product === expected;
}

function paymentFor(storeSource: string, classification: unknown): StorePurchaseRow['payment_classification'] | null {
  if (storeSource === 'offer_code') return classification === 'promotional_code_indicated' ? classification : null;
  if (storeSource === 'unknown') return classification === 'unknown' ? classification : null;
  if (storeSource === 'paid_purchase') return classification === 'legacy_unverified' ? classification : null;
  return null;
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
