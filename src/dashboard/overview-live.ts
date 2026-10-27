/**
 * Production Overview screen.
 * Calls admin-dashboard with { action: "overview" } after the session check.
 * Does not import demonstration records and does not write them to storage.
 */

import { formatDate, formatDay } from './dates';
import { emailText, esc, learnerHref, pill } from './markup';
import { buildLearnersRequest, readLearnersInvoke, type LearnersPayload, type LearnersRequestBody } from './learners-contract';
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
import {
  buildPurchasesRequest,
  DEFAULT_PURCHASE_FILTERS,
  readPurchasesInvoke,
  type PurchasesPayload,
  type PurchasesRequestBody,
} from './purchases-contract';

const SAFE_CODE = /^[a-z0-9_]{1,80}$/;
const PANEL_PAGE_SIZE = 5;

export interface OverviewInvoker {
  invoke(
    name: typeof OVERVIEW_FUNCTION,
    body: OverviewRequestBody | LearnersRequestBody | PurchasesRequestBody,
  ): Promise<{ data: unknown; error: unknown }>;
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

type PanelState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

export function mountLiveOverview(root: HTMLElement, invoker: OverviewInvoker, options: MountOptions): { dispose: () => void } {
  let generation = 0;
  let registrationGeneration = 0;
  let reviewGeneration = 0;
  let disposed = false;
  let selection: Selection = { period: DEFAULT_OVERVIEW_PERIOD, start: '', end: '' };
  let current: OverviewCurrent | null = null;
  let overviewState = 'loading';
  let lede = 'Loading overview figures…';
  let overview: OverviewPayload | null = null;
  let extra = '';
  let registrations: PanelState<LearnersPayload> = { status: 'loading' };
  let reviews: PanelState<PurchasesPayload> = { status: 'loading' };

  function dispose(): void {
    disposed = true;
    generation += 1;
    registrationGeneration += 1;
    reviewGeneration += 1;
    current = null;
    overview = null;
    registrations = { status: 'loading' };
    reviews = { status: 'loading' };
  }

  function paint(): void {
    if (disposed || !options.stillCurrent()) return;
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement ? active.id : '';
    const range = active instanceof HTMLInputElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
    root.innerHTML = shell(selection, current, lede, overview, extra, registrations, reviews);
    root.dataset.overviewState = overviewState;
    root.dataset.ready = 'true';
    if (focusId) {
      const next = document.getElementById(focusId);
      if (next instanceof HTMLInputElement && range?.[0] != null && range[1] != null) {
        next.focus();
        next.setSelectionRange(range[0], range[1]);
      } else if (next instanceof HTMLElement) {
        next.focus({ preventScroll: true });
      }
    }
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
    root.querySelector<HTMLButtonElement>('#registrations-retry')?.addEventListener('click', () => {
      void loadRegistrations();
    });
    root.querySelector<HTMLButtonElement>('#reviews-retry')?.addEventListener('click', () => {
      void loadReviews();
    });
  }

  async function refresh(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++generation;
    const requested = selection;
    const body = buildOverviewRequest(requested.period, requested.start, requested.end);
    if (!body) {
      setBanner('Choose a start and end date before the overview request is sent. No figures were requested for this range.');
      lede = rangeMessage(requested);
      overview = null;
      extra = '';
      overviewState = 'needs-dates';
      paint();
      return;
    }

    setBanner('Loading overview figures from the administrator service.');
    lede = 'Loading overview figures…';
    overview = null;
    extra = '';
    overviewState = 'loading';
    paint();

    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(OVERVIEW_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readOverviewInvoke(result, requested.period);
    if (disposed || requestId !== generation || !sameSelection(requested, selection) || !options.stillCurrent()) return;

    if (outcome.status === 'denied') {
      current = null;
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      current = null;
      lede = failureMessage(outcome);
      overview = null;
      extra = retryButton();
      overviewState = 'error';
      setBanner('The overview request failed. No customer figures are shown.');
      paint();
      return;
    }

    current = outcome.overview.current;
    selection = {
      period: outcome.overview.period.id,
      start: outcome.overview.period.start ?? '',
      end: outcome.overview.period.end,
    };
    lede = periodSentence(outcome.overview);
    overview = outcome.overview;
    extra = '';
    overviewState = 'ready';
    setBanner('Overview counts come from the overview action. The lists below are separate learners and purchases requests.');
    paint();
  }

  async function loadRegistrations(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++registrationGeneration;
    const body = buildLearnersRequest('', 1, PANEL_PAGE_SIZE);
    registrations = { status: 'loading' };
    paint();
    if (!body) {
      registrations = { status: 'error', message: 'The registrations request was not sent. No accounts are shown.' };
      paint();
      return;
    }
    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(OVERVIEW_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readLearnersInvoke(result, { search: null, page: 1, page_size: PANEL_PAGE_SIZE });
    if (disposed || requestId !== registrationGeneration || !options.stillCurrent()) return;
    if (outcome.status === 'denied') {
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      registrations = { status: 'error', message: panelFailure('registrations', outcome) };
      paint();
      return;
    }
    if (!newestFirst(outcome.learners.rows)) {
      registrations = { status: 'error', message: 'The registrations response could not be used. No accounts are shown.' };
      paint();
      return;
    }
    registrations = { status: 'ready', data: outcome.learners };
    paint();
  }

  async function loadReviews(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++reviewGeneration;
    const filters = { ...DEFAULT_PURCHASE_FILTERS, resolution: 'required' as const };
    const body = buildPurchasesRequest('', 1, filters, PANEL_PAGE_SIZE);
    reviews = { status: 'loading' };
    paint();
    if (!body) {
      reviews = { status: 'error', message: 'The review request was not sent. No purchase records are shown.' };
      paint();
      return;
    }
    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(OVERVIEW_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readPurchasesInvoke(result, { search: null, page: 1, page_size: PANEL_PAGE_SIZE, filters });
    if (disposed || requestId !== reviewGeneration || !options.stillCurrent()) return;
    if (outcome.status === 'denied') {
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      reviews = { status: 'error', message: panelFailure('reviews', outcome) };
      paint();
      return;
    }
    reviews = { status: 'ready', data: outcome.purchases };
    paint();
  }

  void refresh();
  void loadRegistrations();
  void loadReviews();
  return { dispose };
}

function sameSelection(left: Selection, right: Selection): boolean {
  return left.period === right.period && left.start === right.start && left.end === right.end;
}

function shell(
  selection: Selection,
  current: OverviewCurrent | null,
  lede: string,
  overview: OverviewPayload | null,
  extra: string,
  registrations: PanelState<LearnersPayload>,
  reviews: PanelState<PurchasesPayload>,
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
  const panels = informationPanels(registrations, reviews);

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

function informationPanels(registrations: PanelState<LearnersPayload>, reviews: PanelState<PurchasesPayload>): string {
  return `
    <div class="split">
      <section class="panel" id="latest-registrations" data-registrations-state="${esc(registrations.status)}">
        <h2>Latest registrations</h2>
        <p class="lede">These are the newest registered accounts. This list is not limited to the reporting period above. The New registrations figure is the count for that period.</p>
        ${registrationBody(registrations)}
        <p class="panel-link"><a href="/dashboard/learners/">Open the Learners directory</a></p>
      </section>
      <section class="panel" id="purchases-requiring-review" data-reviews-state="${esc(reviews.status)}">
        <h2>Purchases requiring review</h2>
        <p class="lede">These production records are explicitly marked for review because a pending legacy link request is stored. An unowned purchase without that evidence is not listed. Sandbox test permission is not a review.</p>
        ${reviewBody(reviews)}
        <p class="panel-link"><a href="/dashboard/purchases/?resolution=required">Open purchases requiring review</a></p>
      </section>
    </div>
  `;
}

function registrationBody(panel: PanelState<LearnersPayload>): string {
  if (panel.status === 'loading') return `<p class="empty">Loading latest registrations…</p>${panelRetry('registrations-retry')}`;
  if (panel.status === 'error') return `<p class="empty">${esc(panel.message)}</p>${panelRetry('registrations-retry')}`;
  if (panel.data.rows.length === 0) return '<p class="empty">No registered accounts were returned.</p>';
  const rows = panel.data.rows
    .map((row) => {
      const name = row.display_name ?? 'No name saved';
      const email = row.email ? emailText(row.email) : esc('No email saved');
      return `<tr data-user-id="${esc(row.user_id)}">
        <td><a href="${esc(learnerHref(row.user_id))}">${esc(name)}</a><span class="secondary">${email}</span></td>
        <td class="nowrap">${esc(formatDate(row.created_at))}</td>
      </tr>`;
    })
    .join('');
  const shown = panel.data.total > panel.data.rows.length ? `Showing ${panel.data.rows.length} of ${panel.data.total} registered accounts, newest first.` : 'Newest registered accounts first.';
  return `<p class="lede">${esc(shown)}</p><div class="table-wrap"><table class="fit">
    <caption>Registration dates are Pacific Time.</caption>
    <thead><tr><th>Account</th><th>Registered</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function reviewBody(panel: PanelState<PurchasesPayload>): string {
  if (panel.status === 'loading') return `<p class="empty">Loading purchases requiring review…</p>${panelRetry('reviews-retry')}`;
  if (panel.status === 'error') return `<p class="empty">${esc(panel.message)}</p>${panelRetry('reviews-retry')}`;
  if (panel.data.rows.length === 0) return '<p class="empty">No production records are explicitly requiring review.</p>';
  const rows = panel.data.rows
    .map((row) => {
      if (row.record_kind !== 'store' || row.account) return '';
      const platform = row.platform === 'apple' ? 'Apple' : 'Google Play';
      const product = row.product === 'monthly' ? 'Monthly' : row.product === 'annual' ? 'Annual' : row.product === 'lifetime' ? 'Lifetime' : 'Unrecognized product';
      const basis = row.review_basis === 'pending_legacy_link_request' ? 'Pending legacy ownership review' : 'Explicitly requiring review';
      return `<article data-record-id="${esc(row.id)}">
        <p><span class="primary">${esc(platform)}</span><span class="secondary">${esc(product)} · Recorded ${esc(formatDate(row.recorded_at))}</span></p>
        <p>${pill('neutral', 'Unowned')}${pill('warn', basis)}</p>
      </article>`;
    })
    .join('');
  const shown = panel.data.total > panel.data.rows.length ? `Showing ${panel.data.rows.length} of ${panel.data.total} records explicitly requiring review.` : 'Records explicitly requiring review.';
  return `<p class="lede">${esc(shown)}</p>${rows}<p class="secondary">Recorded dates are Pacific Time. No owner is invented for these records.</p>`;
}

function panelRetry(id: string): string {
  return `<div class="signin-actions"><button type="button" id="${esc(id)}">Try again</button></div>`;
}

function newestFirst(rows: LearnersPayload['rows']): boolean {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Date.parse(rows[index - 1].created_at);
    const next = Date.parse(rows[index].created_at);
    if (next > previous) return false;
    if (next === previous && rows[index - 1].user_id.toLowerCase() > rows[index].user_id.toLowerCase()) return false;
  }
  return true;
}

function panelFailure(kind: 'registrations' | 'reviews', outcome: { status: string; code?: string | null }): string {
  const subject = kind === 'registrations' ? 'registrations' : 'review';
  const unavailable = kind === 'registrations' ? 'learners_unavailable' : 'purchases_unavailable';
  if (outcome.status === 'network') return `The ${subject} request did not reach the server. No records are shown.`;
  if (outcome.status === 'invalid_body') return `The ${subject} request was rejected (invalid_body). No records are shown.`;
  const code = outcome.code && SAFE_CODE.test(outcome.code) ? outcome.code : '';
  if (code === unavailable) return `The ${subject} list could not be read (${code}). No records are shown.`;
  if (code === 'authorization_unavailable') return 'The administrator check could not be completed (authorization_unavailable). No records are shown.';
  if (code) return `The ${subject} response could not be used (${code}). No records are shown.`;
  return `The ${subject} response could not be used. No records are shown.`;
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
