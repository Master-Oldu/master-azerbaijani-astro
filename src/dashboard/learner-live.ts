/**
 * Production learner details.
 * Calls admin-dashboard with { action: "learner" } after the session check.
 * Does not import demonstration records and does not write them to storage.
 */

import { formatDate, formatDateTime } from './dates';
import {
  buildLearnerRequest,
  LEARNER_FUNCTION,
  readLearnerInvoke,
  type LearnerDetail,
  type LearnerGrant,
  type LearnerModule,
  type LearnerPurchase,
  type LearnerRequestBody,
  type PaymentClassification,
} from './learner-contract';
import { sourceLabel } from './learners-contract';
import { emailText, esc, pager, pill, signInText } from './markup';

const SAFE_CODE = /^[a-z0-9_]{1,80}$/;

export interface LearnerInvoker {
  invoke(name: typeof LEARNER_FUNCTION, body: LearnerRequestBody): Promise<{ data: unknown; error: unknown }>;
}

interface MountOptions {
  stillCurrent: () => boolean;
  onDenied: (reason: 'invalid_session' | 'not_admin') => void;
}

export function mountLiveLearner(root: HTMLElement, invoker: LearnerInvoker, options: MountOptions): { dispose: () => void } {
  let generation = 0;
  let disposed = false;
  let historyPage = 1;
  const rawId = new URLSearchParams(window.location.search).get('id')?.trim() ?? '';

  function dispose(): void {
    disposed = true;
    generation += 1;
  }

  function render(html: string, state: string): void {
    if (disposed || !options.stillCurrent()) return;
    root.innerHTML = html;
    root.dataset.learnerState = state;
    root.dataset.ready = 'true';
    bind();
  }

  function bind(): void {
    root.querySelector<HTMLButtonElement>('#learner-retry')?.addEventListener('click', () => {
      void refresh();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-history-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        const nextPage = Number(button.dataset.historyPage);
        if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage === historyPage) return;
        historyPage = nextPage;
        void refresh();
      });
    });
  }

  if (!rawId) {
    setBanner('Choose a learner from the directory. No record was requested.');
    render(messagePanel('Choose a learner', 'Open an account from the directory. This page did not request a learner record.', true), 'missing');
    return { dispose };
  }

  const learnerId = buildLearnerRequest(rawId, 1)?.learner_id ?? '';
  if (!learnerId) {
    setBanner('This address is not a valid learner id. The request was not sent.');
    render(
      messagePanel('Learner id was not accepted', 'The address id was not sent because it is not an account id. No learner record was requested.', true),
      'invalid',
    );
    return { dispose };
  }

  async function refresh(): Promise<void> {
    if (disposed || !options.stillCurrent()) return;
    const requestId = ++generation;
    const requestedPage = historyPage;
    const requestedId = learnerId;
    const body = buildLearnerRequest(requestedId, requestedPage);
    if (!body) {
      setBanner('That history page was not sent. No learner records are shown.');
      render(messagePanel('History page was not accepted', 'The history page was not sent. No learner record is shown.', true), 'error');
      return;
    }

    document.title = 'Learner details · Master Azerbaijani Admin';
    setBanner('Loading this learner from the administrator service.');
    render(messagePanel('Loading account', 'Loading this account. Records from a previous request are not shown.', true), 'loading');

    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(LEARNER_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readLearnerInvoke(result, { learnerId: requestedId, historyPage: requestedPage });
    if (disposed || requestId !== generation || requestedId !== learnerId || requestedPage !== historyPage || !options.stillCurrent()) return;

    if (outcome.status === 'denied') {
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status === 'not_found') {
      setBanner('No registered account uses this id.');
      render(
        messagePanel('Account not found', 'No registered account uses this id. This is not an account with zero completed lessons.', true),
        'not_found',
      );
      return;
    }
    if (outcome.status !== 'ok') {
      const message = failureMessage(outcome);
      setBanner('The learner request failed. No learner records are shown.');
      render(messagePanel('Learner details unavailable', message, true, retryButton()), 'error');
      return;
    }

    historyPage = outcome.learner.history.page;
    document.title = `${outcome.learner.display_name ?? 'Account'} · Master Azerbaijani Admin`;
    setBanner('Learner details from the administrator service. The Purchases directory is not included.');
    render(detailHtml(outcome.learner), 'ready');
  }

  void refresh();
  return { dispose };
}

function detailHtml(learner: LearnerDetail): string {
  return `
    <p class="back-row"><a class="back" href="/dashboard/learners/">Back to learners</a></p>
    <section class="panel" data-learner-id="${esc(learner.user_id)}">
      <div class="detail-head">
        <div>
          <p class="eyebrow">Account</p>
          <h2>${esc(learner.display_name ?? 'No name saved')}</h2>
          <p class="lede">${learner.email ? emailText(learner.email) : esc('No email saved')}</p>
        </div>
        <div class="access-stack">
          ${learner.premium.effective ? pill('good', 'Production premium') : pill('neutral', 'No production premium')}
          ${premiumSources(learner)}
        </div>
      </div>
      <p class="lede">Production premium is the access the server reports now. It is not inferred from the presence of a store record. Last sign-in is the last account sign-in, not lesson activity or time in the app.</p>
      ${facts(learner)}
    </section>
    <section class="panel">
      <h2>Lesson and module progression</h2>
      <p class="lede">Completed and unfinished curriculum lessons are listed inside each module. Counts and percentages come from the server. A missing completion date is not an unfinished lesson, and this page does not estimate time spent.</p>
      <div class="module-grid">${learner.modules.length ? learner.modules.map(moduleCard).join('') : '<p class="empty">No modules were returned for this account.</p>'}</div>
    </section>
    <section class="panel">
      <h2>Recorded learning history</h2>
      <p class="lede">This is the current stored progress row for each completed lesson, newest dated completion first. Completing a lesson again replaces the stored time. It is not a log of every attempt and it is not time spent in the app.</p>
      ${datedHistory(learner)}
      ${undatedHistory(learner)}
    </section>
    ${entitlements(learner)}
  `;
}

function facts(learner: LearnerDetail): string {
  const sandbox = learner.sandbox_purchase_test_allowed
    ? `${pill('info', 'Allowed')}<span class="secondary">This login may hold a sandbox or license-test purchase. It is not a purchase review, and it does not remove production premium.</span>`
    : esc('Not allowed');
  const rows: [string, string][] = [
    ['Name', esc(learner.display_name ?? 'No name saved')],
    ['Email', learner.email ? emailText(learner.email) : esc('No email saved')],
    ['Account id', `<span class="code">${esc(learner.user_id)}</span>`],
    ['Signup', esc(formatDate(learner.created_at))],
    ['Last sign-in', esc(signInText(learner.last_sign_in_at))],
    ['Sandbox test permission', sandbox],
  ];
  return `<dl class="facts">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function premiumSources(learner: LearnerDetail): string {
  if (learner.premium.sources.length === 0) {
    return '<span class="secondary">No contributing production source.</span>';
  }
  return learner.premium.sources.map((source) => `<span class="secondary">${esc(sourceLabel(source))}</span>`).join('');
}

function moduleCard(module: LearnerModule): string {
  const title = module.title ?? 'No module title recorded';
  const publication = module.is_published ? pill('neutral', 'Published') : pill('warn', 'Unpublished');
  const percent = module.completion_percent === null ? 'Completion percentage unavailable' : `${formatPercent(module.completion_percent)} complete`;
  const summary = `${module.completed_lesson_count} of ${module.lesson_count} curriculum lessons · ${percent}`;
  const meter =
    module.completion_percent === null
      ? ''
      : `<div class="meter" role="img" aria-label="${esc(title)}, ${esc(percent)}"><span style="width:${module.completion_percent}%"></span></div>`;
  const lessons = module.lessons.map(lessonItem).join('');
  return `<details class="disclosure" data-module-id="${esc(module.id)}" data-published="${module.is_published ? 'true' : 'false'}" data-basis="${esc(module.latest_completed_basis)}">
    <summary>
      <span class="primary">${esc(title)} ${publication}</span>
      <span class="secondary">${esc(summary)}</span>
      <span class="secondary">${esc(latestText(module))}</span>
    </summary>
    <div class="disclosure-body">
      ${meter}
      ${module.lessons.length ? `<ul class="lesson-list">${lessons}</ul>` : '<p class="empty">This module has no curriculum lessons.</p>'}
    </div>
  </details>`;
}

function latestText(module: LearnerModule): string {
  if (module.latest_completed_basis === 'no_curriculum_lessons') return 'No curriculum lessons';
  if (module.latest_completed_basis === 'none') return 'No completed curriculum lessons';
  if (module.latest_completed_basis === 'undated_completion') {
    return 'Latest completion date unavailable. Another dated lesson is not shown as the latest.';
  }
  return module.latest_completed_at ? `Latest completion ${formatDate(module.latest_completed_at)}` : 'Latest completion date unavailable';
}

function lessonItem(lesson: LearnerModule['lessons'][number]): string {
  const title = lesson.title ?? 'No lesson title recorded';
  const engine = lesson.lesson_engine_id ? `<span class="secondary">Lesson key ${esc(lesson.lesson_engine_id)}</span>` : '';
  let when = 'Not completed';
  if (lesson.completed && lesson.completed_at) when = `Completed ${formatDate(lesson.completed_at)}`;
  if (lesson.completed && !lesson.completed_at) when = 'Completed. Date unavailable.';
  return `<li class="lesson${lesson.completed ? ' is-done' : ''}" data-lesson-id="${esc(lesson.lesson_id)}" data-completed="${lesson.completed ? 'true' : 'false'}">
    <span class="mark" aria-hidden="true"></span>
    <span><span class="primary">${esc(title)}</span><span class="secondary">${esc(when)}</span>${engine}</span>
  </li>`;
}

function datedHistory(learner: LearnerDetail): string {
  const history = learner.history;
  const items = history.rows.length
    ? history.rows
        .map((row) => {
          const title = row.title ?? 'No lesson title recorded';
          const moduleTitle = row.module_title ?? 'No module title recorded';
          const engine = row.lesson_engine_id ? `<span class="secondary">Lesson key ${esc(row.lesson_engine_id)}</span>` : '';
          return `<li data-history-lesson="${esc(row.lesson_id)}"><span class="primary">${esc(title)}</span><span class="secondary">${esc(moduleTitle)} · ${esc(formatDate(row.completed_at))}</span>${engine}</li>`;
        })
        .join('')
    : '<li class="empty">No dated completions are stored on this page.</li>';
  const pagerHtml = historyPager(history.page, history.page_size, history.total, history.page_count);
  return `<details class="disclosure" data-history="dated" data-current-page="${history.page}">
    <summary>
      <span class="primary">Dated stored completions</span>
      <span class="secondary">${history.total} newest first</span>
    </summary>
    <div class="disclosure-body">
      <ol class="history">${items}</ol>
      ${pagerHtml}
    </div>
  </details>`;
}

function historyPager(page: number, pageSize: number, total: number, pageCount: number): string {
  const html = pager(page, pageSize, total, 'dated completions');
  const pages = pageCount === 0 ? 0 : pageCount;
  const label = pages === 0 ? 'Page 1 of 0' : `Page ${page} of ${pages}`;
  return html
    .replaceAll('data-page=', 'data-history-page=')
    .replace(`Page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`, label);
}

function undatedHistory(learner: LearnerDetail): string {
  const history = learner.history;
  const truncated = history.undated_total > history.undated.length;
  const note = truncated
    ? `Showing ${history.undated.length} of ${history.undated_total} completed lessons with no stored time. This list is incomplete.`
    : history.undated_total === 0
      ? 'No completed lessons are missing a stored time.'
      : `${history.undated_total} completed lesson${history.undated_total === 1 ? '' : 's'} with no stored time.`;
  const items = history.undated
    .map((row) => {
      const title = row.title ?? 'No lesson title recorded';
      const moduleTitle = row.module_title ?? 'No module title recorded';
      return `<li data-undated-lesson="${esc(row.lesson_id)}"><span class="primary">${esc(title)}</span><span class="secondary">${esc(moduleTitle)} · Date unavailable</span></li>`;
    })
    .join('');
  return `<details class="disclosure" data-history="undated">
    <summary>
      <span class="primary">Completions with no stored time</span>
      <span class="secondary">${esc(note)}</span>
    </summary>
    <div class="disclosure-body">
      <p class="lede">${esc(note)} These lessons are not placed on a date, and a missing date does not make them unfinished.</p>
      ${items ? `<ol class="history">${items}</ol>` : '<p class="empty">None on this response.</p>'}
    </div>
  </details>`;
}

function entitlements(learner: LearnerDetail): string {
  return `
    <section class="panel" data-entitlements="purchases">
      <h2>Store records</h2>
      <p class="lede">Records owned by this account. An unowned purchase is not listed. A verified store record is not a confirmed paid purchase. Access deadline is not a next billing date. Sandbox records stay visible and are not production premium. A record that is not counted does not mean this login has no sandbox testing access.</p>
      ${purchaseTable(learner.entitlements.purchases)}
    </section>
    <section class="panel" data-entitlements="grants">
      <h2>Account grants</h2>
      <p class="lede">Grants are not Apple or Google Play purchases. Expired and revoked grants stay visible as history and do not count as active production premium.</p>
      ${grantTable(learner.entitlements.grants)}
    </section>
  `;
}

function purchaseTable(purchases: LearnerPurchase[]): string {
  if (purchases.length === 0) return '<p class="empty">No store records are owned by this account.</p>';
  const rows = purchases
    .map(
      (purchase) => `<tr data-purchase-id="${esc(purchase.id)}" data-environment="${esc(purchase.environment)}" data-contributes="${purchase.contributes_access ? 'true' : 'false'}">
        <td>${esc(purchase.platform === 'apple' ? 'Apple' : 'Google Play')}</td>
        <td>${esc(purchase.environment === 'production' ? 'Production' : 'Sandbox')}</td>
        <td><span class="primary">${esc(productLabel(purchase.product))}</span><span class="secondary">${esc(purchase.product_id)}</span></td>
        <td>${esc(purchase.lineage_class === 'legacy' ? 'Legacy' : 'Standard')}</td>
        <td>${esc(paymentLabel(purchase.payment_classification))}</td>
        <td>${esc(purchaseStatus(purchase.grant_status))}</td>
        <td>${purchase.contributes_access ? esc('Counted in production premium') : esc('Not counted in production premium')}</td>
        <td>${esc(purchase.access_deadline ? formatDateTime(purchase.access_deadline) : 'None recorded')}</td>
        <td>${esc(purchase.original_purchase_at ? formatDateTime(purchase.original_purchase_at) : 'None recorded')}</td>
        <td>${esc(formatDateTime(purchase.recorded_at))}</td>
      </tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table>
    <caption>Owned Apple and Google Play records. Dates are Pacific Time.</caption>
    <thead><tr><th>Store</th><th>Environment</th><th>Product</th><th>Lineage</th><th>Payment</th><th>Status</th><th>Production premium</th><th>Access deadline</th><th>Original purchase</th><th>Recorded</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function grantTable(grants: LearnerGrant[]): string {
  if (grants.length === 0) return '<p class="empty">No grants are recorded for this account.</p>';
  const rows = grants
    .map(
      (grant) => `<tr data-grant-id="${esc(grant.id)}" data-grant-status="${esc(grant.status)}" data-contributes="${grant.contributes_access ? 'true' : 'false'}">
        <td>${esc(grant.grant_kind === 'lifetime' ? 'Complimentary lifetime grant' : 'Temporary migration grant')}</td>
        <td>${esc(grantStatus(grant.status))}</td>
        <td>${esc(grant.expires_at ? formatDateTime(grant.expires_at) : 'No expiry time')}</td>
        <td>${esc(formatDateTime(grant.recorded_at))}</td>
        <td>${grant.contributes_access ? esc('Counted in production premium') : esc('Not counted in production premium')}</td>
      </tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table>
    <caption>Grants recorded for this account. An expiry time is not a renewal date. Dates are Pacific Time.</caption>
    <thead><tr><th>Grant</th><th>Status</th><th>Expiry</th><th>Recorded</th><th>Production premium</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function productLabel(product: LearnerPurchase['product']): string {
  if (product === 'lifetime') return 'Lifetime';
  if (product === 'monthly') return 'Monthly';
  if (product === 'annual') return 'Annual';
  return 'Unrecognized product';
}

function paymentLabel(classification: PaymentClassification): string {
  if (classification === 'promotional_code_indicated') return 'Promotional code indicated';
  if (classification === 'unknown') return 'Payment type unknown';
  if (classification === 'legacy_unverified') return 'Payment type unverified (legacy)';
  return 'Payment classification unavailable';
}

function purchaseStatus(status: LearnerPurchase['grant_status']): string {
  if (status === 'active') return 'Active';
  if (status === 'grace') return 'Grace';
  if (status === 'inactive') return 'Inactive';
  return 'Pending';
}

function grantStatus(status: LearnerGrant['status']): string {
  if (status === 'provisioned') return 'Provisioned';
  if (status === 'active') return 'Active';
  if (status === 'expired') return 'Expired';
  return 'Revoked';
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function messagePanel(title: string, lede: string, back: boolean, extra = ''): string {
  const link = back ? '<p class="panel-link"><a href="/dashboard/learners/">Back to learners</a></p>' : '';
  return `<section class="panel"><h2>${esc(title)}</h2><p class="lede">${esc(lede)}</p>${extra}${link}</section>`;
}

function failureMessage(outcome: { status: string; code?: string | null }): string {
  if (outcome.status === 'network') return 'The learner request did not reach the server. No learner records are shown.';
  if (outcome.status === 'invalid_body') return 'The learner request was rejected (invalid_body). No learner records are shown.';
  const code = outcome.code && SAFE_CODE.test(outcome.code) ? outcome.code : '';
  if (code === 'learner_unavailable') return 'The learner record could not be read (learner_unavailable). No learner records are shown.';
  if (code === 'authorization_unavailable') return 'The administrator check could not be completed (authorization_unavailable). No learner records are shown.';
  if (code) return `The learner response could not be used (${code}). No learner records are shown.`;
  return 'The learner response could not be used. No learner records are shown.';
}

function retryButton(): string {
  return '<div class="signin-actions"><button type="button" id="learner-retry">Try again</button></div>';
}

function setBanner(message: string): void {
  const banner = document.getElementById('dashboard-banner');
  if (!banner) return;
  banner.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  banner.append(paragraph);
}
