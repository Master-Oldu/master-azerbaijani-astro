import type { DatePreset, ReportingQuery, ResolvedRange } from './types';

export const PACIFIC = 'America/Los_Angeles';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(iso: string | null): string {
  if (!iso) return 'None recorded';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'None recorded';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** Calendar day in America/Los_Angeles, as YYYY-MM-DD. */
export function pacificDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

/** Format a Pacific calendar day (YYYY-MM-DD) without shifting it across midnight. */
export function formatDay(day: string | null): string {
  if (!day || !DAY.test(day)) return 'Earliest recorded day';
  const [year, month, date] = day.split('-').map((part) => Number(part));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function isDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && DAY.test(value);
}

export function inRange(iso: string, range: Pick<ResolvedRange, 'startDay' | 'endDay'>): boolean {
  const day = pacificDay(iso);
  if (day > range.endDay) return false;
  if (range.startDay && day < range.startDay) return false;
  return true;
}

/**
 * Resolve a reporting period from an as-of instant.
 * Demo mode passes the fixed sample clock. Production should pass the real
 * current time. The resulting days are Pacific Time calendar days.
 */
export function resolveRange(query: ReportingQuery, asOfIso: string): ResolvedRange {
  const endDefault = pacificDay(asOfIso);
  const base = {
    asOf: asOfIso,
    timeZone: 'America/Los_Angeles' as const,
  };

  if (query.preset === 'all') {
    return { ...base, preset: 'all', startDay: null, endDay: endDefault, label: 'All recorded history' };
  }
  if (query.preset === 'ytd') {
    return {
      ...base,
      preset: 'ytd',
      startDay: `${endDefault.slice(0, 4)}-01-01`,
      endDay: endDefault,
      label: 'Year to date',
    };
  }
  if (query.preset === 'custom') {
    const start = isDay(query.startDay) ? query.startDay : endDefault;
    const end = isDay(query.endDay) ? query.endDay : endDefault;
    const startDay = start <= end ? start : end;
    const endDay = start <= end ? end : start;
    return { ...base, preset: 'custom', startDay, endDay, label: 'Custom' };
  }

  const days = query.preset === '7d' ? 7 : query.preset === '90d' ? 90 : 30;
  const preset: DatePreset = query.preset === '7d' || query.preset === '90d' ? query.preset : '30d';
  return {
    ...base,
    preset,
    startDay: shiftDay(endDefault, -(days - 1)),
    endDay: endDefault,
    label: `Last ${days} days`,
  };
}

export function reportingQueryFromSearch(params: URLSearchParams): ReportingQuery {
  const preset = params.get('period');
  const known: DatePreset[] = ['7d', '30d', '90d', 'ytd', 'all', 'custom'];
  if (!preset || !known.includes(preset as DatePreset)) return { preset: '30d' };
  if (preset !== 'custom') return { preset: preset as DatePreset };
  return {
    preset: 'custom',
    startDay: params.get('start'),
    endDay: params.get('end'),
  };
}
