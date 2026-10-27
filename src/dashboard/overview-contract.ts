/**
 * Overview action for the admin-dashboard Edge Function.
 * Field names and period identifiers follow the backend contract.
 * This module does not call the network and does not store responses.
 */

export const OVERVIEW_FUNCTION = 'admin-dashboard';

export const OVERVIEW_PERIODS = [
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'year_to_date',
  'all_time',
  'custom',
] as const;

export type OverviewPeriodId = (typeof OVERVIEW_PERIODS)[number];

export const DEFAULT_OVERVIEW_PERIOD: OverviewPeriodId = 'last_30_days';

export const OVERVIEW_PERIOD_OPTIONS: { id: OverviewPeriodId; label: string }[] = [
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'last_90_days', label: 'Last 90 days' },
  { id: 'year_to_date', label: 'Year to date' },
  { id: 'all_time', label: 'All time' },
  { id: 'custom', label: 'Custom start and end dates' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface OverviewRequestBody {
  action: 'overview';
  period: OverviewPeriodId;
  start?: string;
  end?: string;
}

export interface OverviewCurrent {
  registered_accounts: number;
  accounts_with_completed_lesson: number;
  effective_premium_accounts: number;
  unowned_production_purchases: number;
}

export interface OverviewSelectedPeriod {
  new_registrations: number;
  learners_with_completed_lesson: number;
  lessons_completed: number;
}

export interface OverviewLessonCompletion {
  basis: 'stored_progress_row';
  period_coverage: 'complete' | 'dated_records_only';
  undated_completed_lessons: number;
}

export interface OverviewPayload {
  time_zone: 'America/Los_Angeles';
  period: {
    id: OverviewPeriodId;
    start: string | null;
    end: string;
  };
  current: OverviewCurrent;
  selected_period: OverviewSelectedPeriod;
  lesson_completion: OverviewLessonCompletion;
}

export type OverviewDenial = 'invalid_session' | 'not_admin';

export type OverviewOutcome =
  | { status: 'ok'; overview: OverviewPayload }
  | { status: 'denied'; reason: OverviewDenial; code: string | null }
  | { status: 'invalid_period'; code: 'invalid_body' }
  | { status: 'unavailable'; code: string | null }
  | { status: 'network' };

/**
 * Named periods send action and period only.
 * Custom sends start and end as YYYY-MM-DD. An unusable custom range is not sent.
 */
export function buildOverviewRequest(
  period: OverviewPeriodId,
  start?: string | null,
  end?: string | null,
): OverviewRequestBody | null {
  if (!OVERVIEW_PERIODS.includes(period)) return null;
  if (period !== 'custom') return { action: 'overview', period };
  if (!isCalendarDay(start) || !isCalendarDay(end) || start > end) return null;
  return { action: 'overview', period: 'custom', start, end };
}

/**
 * Accept only the documented overview object.
 * A missing or non-integer total, or coverage that disagrees with the undated count, is rejected.
 */
export function parseOverviewPayload(body: unknown, expectedPeriod: OverviewPeriodId): OverviewPayload | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const overview = body.overview;
  if (!isRecord(overview)) return null;
  if (overview.time_zone !== 'America/Los_Angeles') return null;

  const period = overview.period;
  if (!isRecord(period)) return null;
  if (period.id !== expectedPeriod) return null;
  if (!isCalendarDay(period.end)) return null;

  let start: string | null;
  if (expectedPeriod === 'all_time') {
    if (period.start !== null) return null;
    start = null;
  } else {
    if (!isCalendarDay(period.start) || period.start > period.end) return null;
    start = period.start;
  }

  const current = readCurrent(overview.current);
  const selected = readSelected(overview.selected_period);
  const lessons = readLessons(overview.lesson_completion, expectedPeriod);
  if (!current || !selected || !lessons) return null;

  return {
    time_zone: 'America/Los_Angeles',
    period: { id: expectedPeriod, start, end: period.end },
    current,
    selected_period: selected,
    lesson_completion: lessons,
  };
}

export async function readOverviewInvoke(
  result: { data: unknown; error: unknown },
  expectedPeriod: OverviewPeriodId,
): Promise<OverviewOutcome> {
  const error = result.error;
  if (isNamedError(error, 'FunctionsFetchError')) return { status: 'network' };
  if (isNamedError(error, 'FunctionsRelayError')) return { status: 'unavailable', code: null };
  if (isNamedError(error, 'FunctionsHttpError')) {
    const http = await readHttpError(error);
    if (http.status === 401) return { status: 'denied', reason: 'invalid_session', code: http.code };
    if (http.status === 403) return { status: 'denied', reason: 'not_admin', code: http.code };
    if (http.status === 400 && http.code === 'invalid_body') return { status: 'invalid_period', code: 'invalid_body' };
    return { status: 'unavailable', code: http.code };
  }
  if (error) return { status: 'unavailable', code: null };

  const parsed = parseOverviewPayload(result.data, expectedPeriod);
  if (!parsed) return { status: 'unavailable', code: null };
  return { status: 'ok', overview: parsed };
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

function readCurrent(value: unknown): OverviewCurrent | null {
  if (!isRecord(value)) return null;
  const registered_accounts = whole(value.registered_accounts);
  const accounts_with_completed_lesson = whole(value.accounts_with_completed_lesson);
  const effective_premium_accounts = whole(value.effective_premium_accounts);
  const unowned_production_purchases = whole(value.unowned_production_purchases);
  if (
    registered_accounts === null ||
    accounts_with_completed_lesson === null ||
    effective_premium_accounts === null ||
    unowned_production_purchases === null
  ) {
    return null;
  }
  return {
    registered_accounts,
    accounts_with_completed_lesson,
    effective_premium_accounts,
    unowned_production_purchases,
  };
}

function readSelected(value: unknown): OverviewSelectedPeriod | null {
  if (!isRecord(value)) return null;
  const new_registrations = whole(value.new_registrations);
  const learners_with_completed_lesson = whole(value.learners_with_completed_lesson);
  const lessons_completed = whole(value.lessons_completed);
  if (new_registrations === null || learners_with_completed_lesson === null || lessons_completed === null) return null;
  return { new_registrations, learners_with_completed_lesson, lessons_completed };
}

function readLessons(value: unknown, period: OverviewPeriodId): OverviewLessonCompletion | null {
  if (!isRecord(value)) return null;
  if (value.basis !== 'stored_progress_row') return null;
  const undated = whole(value.undated_completed_lessons);
  if (undated === null) return null;
  const coverage = value.period_coverage;
  if (coverage !== 'complete' && coverage !== 'dated_records_only') return null;
  if (!coverageMatches(period, coverage, undated)) return null;
  return { basis: 'stored_progress_row', period_coverage: coverage, undated_completed_lessons: undated };
}

function coverageMatches(period: OverviewPeriodId, coverage: 'complete' | 'dated_records_only', undated: number): boolean {
  if (undated === 0) return coverage === 'complete';
  if (period === 'all_time') return coverage === 'complete';
  return coverage === 'dated_records_only';
}

function whole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const [year, month, date] = value.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, date));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNamedError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}
