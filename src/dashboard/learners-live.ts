/**
 * Production Learners directory.
 * Calls admin-dashboard with { action: "learners" } after the session check.
 * Does not import demonstration records and does not write them to storage.
 */

import { formatDate } from './dates';
import {
  buildLearnersRequest,
  LEARNERS_FUNCTION,
  LEARNERS_PAGE_SIZE,
  readLearnersInvoke,
  sourceLabel,
  type LearnerDirectoryRow,
  type LearnersPayload,
  type LearnersRequestBody,
} from './learners-contract';
import { emailText, esc, learnerHref, pager, pill, signInText } from './markup';

const SEARCH_WAIT_MS = 400;
const SAFE_CODE = /^[a-z0-9_]{1,80}$/;

export interface LearnersInvoker {
  invoke(name: typeof LEARNERS_FUNCTION, body: LearnersRequestBody): Promise<{ data: unknown; error: unknown }>;
}

interface MountOptions {
  stillCurrent: () => boolean;
  onDenied: (reason: 'invalid_session' | 'not_admin') => void;
}

export function mountLiveLearners(root: HTMLElement, invoker: LearnersInvoker, options: MountOptions): { dispose: () => void } {
  let generation = 0;
  let disposed = false;
  let draft = '';
  let appliedSearch = '';
  let page = 1;
  let timer = 0;

  function dispose(): void {
    disposed = true;
    generation += 1;
    window.clearTimeout(timer);
  }

  function render(html: string, state: string): void {
    if (disposed || !options.stillCurrent()) return;
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement ? active.id : '';
    const range = active instanceof HTMLInputElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
    root.innerHTML = html;
    root.dataset.learnersState = state;
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
    const form = root.querySelector<HTMLFormElement>('#learner-search-form');
    const input = root.querySelector<HTMLInputElement>('#learner-search');
    input?.addEventListener('input', () => {
      draft = input.value;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        appliedSearch = draft.trim();
        page = 1;
        void refresh();
      }, SEARCH_WAIT_MS);
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      draft = input?.value ?? '';
      appliedSearch = draft.trim();
      page = 1;
      void refresh();
    });
    root.querySelector<HTMLButtonElement>('#learners-retry')?.addEventListener('click', () => {
      void refresh();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const nextPage = Number(button.dataset.page);
        if (!Number.isInteger(nextPage) || nextPage < 1) return;
        window.clearTimeout(timer);
        draft = appliedSearch;
        page = nextPage;
        void refresh();
      });
    });
  }

  async function refresh(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++generation;
    const requestedPage = page;
    const requestedSearch = appliedSearch;
    const body = buildLearnersRequest(requestedSearch, requestedPage);
    if (!body) {
      setBanner('That search was not sent. No learner records are shown.');
      render(shell(draft, 'A search longer than 200 characters was not sent. No accounts are shown.', '', true), 'error');
      return;
    }

    setBanner('Loading the learner directory from the administrator service.');
    render(shell(draft, 'Loading learner records…', '', false), 'loading');

    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(LEARNERS_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readLearnersInvoke(result, { search: requestedSearch ? requestedSearch : null, page: requestedPage });
    if (disposed || requestId !== generation || !options.stillCurrent()) return;

    if (outcome.status === 'denied') {
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      const message = failureMessage(outcome);
      setBanner('The learners request failed. No learner records are shown.');
      render(shell(draft, message, retryButton(), true), 'error');
      return;
    }

    page = outcome.learners.page;
    setBanner('Learner directory from the administrator service. Lesson history and purchase records are not included.');
    render(shell(draft, directoryCopy(outcome.learners), table(outcome.learners), false), 'ready');
  }

  void refresh();
  return { dispose };
}

function shell(draft: string, lede: string, body: string, failed: boolean): string {
  return `
    <section class="panel" data-learners-panel="${failed ? 'error' : 'directory'}">
      <div class="panel-head">
        <h2>Learner directory</h2>
        <p class="lede">Production premium is the account's effective access now. Sandbox test permission is separate and is not a purchase review. Last sign-in is the last account sign-in, not lesson activity or time in the app. Newest registrations are listed first.</p>
        <p class="lede">${esc(lede)}</p>
      </div>
      <form class="filters" id="learner-search-form" role="search">
        <label for="learner-search">Search name or email
          <input id="learner-search" type="search" name="q" maxlength="200" value="${esc(draft)}" autocomplete="off" spellcheck="false" placeholder="Name or email" />
        </label>
      </form>
      ${body}
    </section>
  `;
}

function table(directory: LearnersPayload): string {
  const rows = directory.rows.length === 0 ? emptyRow(directory) : directory.rows.map(rowHtml).join('');
  return `
    <div class="table-wrap">
      <table class="directory">
        <caption>Dates are Pacific Time. Completed-lesson counts use stored progress rows, not a history of every attempt.</caption>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Signup date</th>
            <th>Last sign-in</th>
            <th class="num">Completed lessons</th>
            <th>Last completed lesson</th>
            <th>Premium access</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pager(directory.page, directory.page_size, directory.total, 'matching accounts')}
  `;
}

function emptyRow(directory: LearnersPayload): string {
  const message = directory.total === 0
    ? directory.search
      ? 'No accounts match this search.'
      : 'No registered accounts were returned.'
    : 'This page has no accounts. The matching total is still shown below.';
  return `<tr><td colspan="7" class="empty">${esc(message)}</td></tr>`;
}

function rowHtml(row: LearnerDirectoryRow): string {
  const name = row.display_name ?? 'No name saved';
  return `<tr data-learner-id="${esc(row.user_id)}">
    <td><a href="${esc(learnerHref(row.user_id))}">${esc(name)}</a></td>
    <td>${row.email ? emailText(row.email) : esc('No email saved')}</td>
    <td>${esc(formatDate(row.created_at))}</td>
    <td>${esc(signInText(row.last_sign_in_at))}</td>
    <td class="num" data-completed="${row.completed_lessons}">${esc(String(row.completed_lessons))}</td>
    <td>${completionCell(row)}</td>
    <td>${premiumCell(row)}</td>
  </tr>`;
}

function completionCell(row: LearnerDirectoryRow): string {
  if (row.latest_completion_basis === 'none') {
    return '<span class="muted">No completed lessons</span>';
  }
  if (row.latest_completion_basis === 'undated_completion') {
    return '<span class="primary">Most recent lesson cannot be identified</span><span class="secondary">At least one completed lesson has no saved date, so another dated lesson is not shown as the latest.</span>';
  }
  const latest = row.latest_completion;
  if (!latest) return '<span class="muted">No lesson title recorded</span>';
  const title = latest.title ? esc(latest.title) : 'No lesson title recorded';
  const engine = latest.lesson_engine_id ? `<span class="secondary">Lesson key ${esc(latest.lesson_engine_id)}</span>` : '';
  return `<span class="primary">${title}</span><span class="secondary">${esc(formatDate(latest.completed_at))}</span>${engine}`;
}

function premiumCell(row: LearnerDirectoryRow): string {
  const status = row.premium.effective ? pill('good', 'Production premium') : pill('neutral', 'No production premium');
  const sources = row.premium.sources.map((source) => `<span class="secondary">${esc(sourceLabel(source))}</span>`).join('');
  const sandbox = row.sandbox_purchase_test_allowed
    ? `${pill('info', 'Sandbox test permission')}<span class="secondary">May hold a sandbox or license-test purchase. Not a purchase review.</span>`
    : '';
  return `<span class="access-stack">${status}${sources}${sandbox}</span>`;
}

function directoryCopy(directory: LearnersPayload): string {
  const filter = directory.search ? `Search "${directory.search}". ` : 'Every registered account, one page at a time. ';
  return `${filter}${directory.total} matching account${directory.total === 1 ? '' : 's'}.`;
}

function failureMessage(outcome: { status: string; code?: string | null }): string {
  if (outcome.status === 'network') return 'The learners request did not reach the server. No accounts are shown.';
  if (outcome.status === 'invalid_body') return 'The learners request was rejected (invalid_body). No accounts are shown.';
  const code = outcome.code && SAFE_CODE.test(outcome.code) ? outcome.code : '';
  if (code === 'learners_unavailable') return 'The learner directory could not be read (learners_unavailable). No accounts are shown.';
  if (code === 'authorization_unavailable') return 'The administrator check could not be completed (authorization_unavailable). No accounts are shown.';
  if (code) return `The learners response could not be used (${code}). No accounts are shown.`;
  return 'The learners response could not be used. No accounts are shown.';
}

function retryButton(): string {
  return '<div class="signin-actions"><button type="button" id="learners-retry">Try again</button></div>';
}

function setBanner(message: string): void {
  const banner = document.getElementById('dashboard-banner');
  if (!banner) return;
  banner.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  banner.append(paragraph);
}
