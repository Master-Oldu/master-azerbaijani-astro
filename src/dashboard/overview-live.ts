/**
 * Production Overview screen.
 * Calls admin-dashboard with { action: "overview" } after the session check.
 * Does not import demonstration records and does not write them to storage.
 */

import { formatDay } from './dates';
import { esc } from './markup';
import {
  buildOverviewRequest,
  DEFAULT_OVERVIEW_PERIOD,
  OVERVIEW_FUNCTION,
  OVERVIEW_PERIOD_OPTIONS,
  readOverviewInvoke,
  type OverviewCurrent,
  type OverviewPayload,
  type OverviewPeriodId,
  type OverviewRequestBody,
} from './overview-contract';

const SAFE_CODE = /^[a-z0-9_]{1,80}$/;

export interface OverviewInvoker {
  invoke(name: typeof OVERVIEW_FUNCTION, body: OverviewRequestBody): Promise<{ data: unknown; error: unknown }>;
}

interface Selection {
  period: OverviewPeriodId;
  start: string;
  end: string;
}

interface MountOptions {
  stillCurrent: () => boolean;
  onDenied: (reason: 'invalid_session' | 'not_admin') => void;
}

export function mountLiveOverview(root: HTMLElement, invoker: OverviewInvoker, options: MountOptions): { dispose: () => void } {
  let generation = 0;
  let disposed = false;
  let selection: Selection = { period: DEFAULT_OVERVIEW_PERIOD, start: '', end: '' };
  let current: OverviewCurrent | null = null;

  function dispose(): void {
    disposed = true;
    generation += 1;
    current = null;
  }

  function render(html: string, state: string): void {
    if (disposed || !options.stillCurrent()) return;
    root.innerHTML = html;
    root.dataset.overviewState = state;
    root.dataset.ready = 'true';
    bind();
  }

  function bind(): void {
    root.querySelector<HTMLFormElement>('#period-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
    });
    const preset = root.querySelector<HTMLSelectElement>('#period-preset');
    const start = root.querySelector<HTMLInputElement>('#period-start');
    const end = root.querySelector<HTMLInputElement>('#period-end');
    preset?.addEventListener('change', () => {
      const period = preset.value as OverviewPeriodId;
      if (period === 'custom') {
        selection = { period, start: start?.value ?? '', end: end?.value ?? '' };
      } else {
        selection = { period, start: '', end: '' };
      }
      void refresh();
    });
    const useCustom = (): void => {
      selection = { period: 'custom', start: start?.value ?? '', end: end?.value ?? '' };
      void refresh();
    };
    start?.addEventListener('change', useCustom);
    end?.addEventListener('change', useCustom);
    root.querySelector<HTMLButtonElement>('#overview-retry')?.addEventListener('click', () => {
      void refresh();
    });
  }

  async function refresh(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++generation;
    const requested = selection;
    const body = buildOverviewRequest(requested.period, requested.start, requested.end);
    if (!body) {
      setBanner('Choose a start and end date before the overview request is sent. No figures were requested for this range.');
      render(shell(requested, current, rangeMessage(requested), null, ''), 'needs-dates');
      return;
    }

    setBanner('Loading overview figures from the administrator service.');
    render(shell(requested, current, 'Loading overview figures…', null, ''), 'loading');

    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(OVERVIEW_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readOverviewInvoke(result, requested.period);
    if (disposed || requestId !== generation || !options.stillCurrent()) return;

    if (outcome.status === 'denied') {
      current = null;
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      current = null;
      const message = failureMessage(outcome);
      setBanner('The overview request failed. No customer figures are shown.');
      render(shell(requested, null, message, null, retryButton()), 'error');
      return;
    }

    current = outcome.overview.current;
    selection = {
      period: outcome.overview.period.id,
      start: outcome.overview.period.start ?? '',
      end: outcome.overview.period.end,
    };
    setBanner('Overview counts from the administrator service. Signup lists and individual purchase records are not included in this response.');
    render(shell(selection, current, periodSentence(outcome.overview), outcome.overview, ''), 'ready');
  }

  void refresh();
  return { dispose };
}

function shell(
  selection: Selection,
  current: OverviewCurrent | null,
  lede: string,
  overview: OverviewPayload | null,
  extra: string,
): string {
  const currentBlock = current
    ? `<div class="stats stats-4">
        ${metric('registered_accounts', 'Registered accounts', current.registered_accounts, 'All registered accounts. Not a period count.')}
        ${metric('accounts_with_completed_lesson', 'Accounts with a completed lesson', current.accounts_with_completed_lesson, 'Accounts that currently have at least one stored completed lesson.')}
        ${metric('effective_premium_accounts', 'Effective premium accounts', current.effective_premium_accounts, 'Accounts with effective premium now. Each account is counted once.')}
        ${metric('unowned_production_purchases', 'Unowned production purchases', current.unowned_production_purchases, 'Production purchase records with no owner. Not a premium status.')}
      </div>`
    : '';

  const periodBlock = overview ? periodStats(overview) : '';
  const panels = disconnectedPanels();

  return `
    <section class="metric-group" aria-labelledby="current-heading">
      <h2 id="current-heading">Current state</h2>
      <p class="lede">${current ? 'These counts describe the database at the time of the request. Choosing another reporting period does not change what they mean.' : 'Current-state counts appear after a usable overview response. A failed request does not show zeroes.'}</p>
      ${currentBlock}
    </section>
    <section class="metric-group" aria-labelledby="period-heading">
      <h2 id="period-heading">Reporting period</h2>
      ${periodForm(selection)}
      <p class="lede">${esc(lede)}</p>
      ${periodBlock}
      ${extra}
    </section>
    ${panels}
  `;
}

function periodStats(overview: OverviewPayload): string {
  const partial = overview.lesson_completion.period_coverage === 'dated_records_only';
  const undated = overview.lesson_completion.undated_completed_lessons;
  const learnerHint = partial
    ? 'Partial. Learners with a recorded completion date in this period. This is not every completion.'
    : 'Distinct accounts with a stored completion time in this period.';
  const lessonHint = partial
    ? 'Partial. Completed lessons with a recorded date in this period. This is not every completion.'
    : 'Stored completed-lesson rows with a completion time in this period.';
  return `
    ${coverageNote(overview)}
    <div class="stats stats-3">
      ${metric('new_registrations', 'New registrations', overview.selected_period.new_registrations, 'Accounts created in the selected period.')}
      ${metric('learners_with_completed_lesson', 'Learners with a completed lesson', overview.selected_period.learners_with_completed_lesson, learnerHint, partial)}
      ${metric('lessons_completed', 'Lessons completed', overview.selected_period.lessons_completed, lessonHint, partial)}
    </div>
    <p class="lede">Lesson figures count stored progress rows, not a history of every attempt. Undated completed lessons: ${esc(String(undated))}.</p>
  `;
}

function coverageNote(overview: OverviewPayload): string {
  const undated = overview.lesson_completion.undated_completed_lessons;
  if (overview.lesson_completion.period_coverage === 'dated_records_only') {
    return `<div class="notice" id="overview-partial" role="status">
      <p><strong>Partial lesson counts.</strong> Some completed lessons have no saved date, so the two lesson figures count only rows with a date in this period. They are not the full period total.</p>
      <p id="overview-undated">Undated completed lessons: ${esc(String(undated))}. These rows are not included in this period.</p>
    </div>`;
  }
  if (overview.period.id === 'all_time' && undated > 0) {
    return `<div class="notice" id="overview-undated-note" role="status">
      <p>All time includes completed lessons that have no saved date. Undated completed lessons: ${esc(String(undated))}. Those rows are included in the lesson figures.</p>
    </div>`;
  }
  return '';
}

function disconnectedPanels(): string {
  return `
    <div class="split">
      <section class="panel">
        <h2>Registrations in this period</h2>
        <p class="empty">Individual signup records are not returned by the overview action. The Learners page will provide them in a later phase. No signup rows are shown here.</p>
      </section>
      <section class="panel">
        <h2>Unresolved purchases</h2>
        <p class="empty">Individual purchase records are not returned by the overview action. The Purchases page will provide them in a later phase. No purchase rows are shown here.</p>
      </section>
    </div>
  `;
}

function periodForm(selection: Selection): string {
  const options = OVERVIEW_PERIOD_OPTIONS.map((item) => {
    const selected = item.id === selection.period ? ' selected' : '';
    return `<option value="${item.id}"${selected}>${esc(item.label)}</option>`;
  }).join('');
  const locked = selection.period === 'all_time';
  return `
    <form class="filters" id="period-form">
      <label for="period-preset">Reporting period
        <select id="period-preset" name="period">
          ${options}
        </select>
      </label>
      <label for="period-start">Start
        <input id="period-start" name="start" type="date" value="${esc(selection.start)}" ${locked ? 'disabled' : ''} />
      </label>
      <label for="period-end">End
        <input id="period-end" name="end" type="date" value="${esc(selection.end)}" ${locked ? 'disabled' : ''} />
      </label>
    </form>
  `;
}

function periodSentence(overview: OverviewPayload): string {
  const end = formatDay(overview.period.end);
  if (overview.period.start === null) {
    return `All time through ${end} (Pacific Time). The server returned no start date for this period.`;
  }
  return `${formatDay(overview.period.start)} – ${end} (Pacific Time). These dates were returned by the server.`;
}

function rangeMessage(selection: Selection): string {
  if (!selection.start || !selection.end) {
    return 'Enter a start date and an end date. Both dates are sent only for a custom period. Period figures are not shown until that request succeeds.';
  }
  return 'The end date is included and cannot be earlier than the start. This range was not sent. Period figures are not shown.';
}

function failureMessage(outcome: { status: string; code?: string | null }): string {
  if (outcome.status === 'network') return 'The overview request did not reach the server. No figures are shown.';
  if (outcome.status === 'invalid_period') return 'The reporting period was rejected (invalid_body). No figures are shown.';
  const code = outcome.code && SAFE_CODE.test(outcome.code) ? outcome.code : '';
  if (code === 'overview_unavailable') return 'The overview could not be read (overview_unavailable). No figures are shown.';
  if (code === 'authorization_unavailable') return 'The administrator check could not be completed (authorization_unavailable). No figures are shown.';
  if (code === 'unknown_action') return 'The server did not accept this overview request (unknown_action). No figures are shown.';
  if (code) return `The overview response could not be used (${code}). No figures are shown.`;
  return 'The overview response could not be used. No figures are shown.';
}

function retryButton(): string {
  return '<div class="signin-actions"><button type="button" id="overview-retry">Try again</button></div>';
}

function metric(id: string, label: string, value: number, hint: string, partial = false): string {
  const partialClass = partial ? ' stat-partial' : '';
  return `<article class="stat${partialClass}" data-metric="${esc(id)}"><p class="stat-label">${esc(label)}</p><p class="stat-value">${esc(String(value))}</p><p class="stat-hint">${esc(hint)}</p></article>`;
}

function setBanner(message: string): void {
  const banner = document.getElementById('dashboard-banner');
  if (!banner) return;
  banner.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  banner.append(paragraph);
}
