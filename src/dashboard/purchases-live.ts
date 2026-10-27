/**
 * Production Purchases directory.
 * Calls admin-dashboard with { action: "purchases" } after the session check.
 * Does not import demonstration records and does not write them to storage.
 */

import { formatDateTime } from './dates';
import { emailText, esc, learnerHref, pager, pill, stat } from './markup';
import {
  buildPurchasesRequest,
  DEFAULT_PURCHASE_FILTERS,
  PURCHASES_FUNCTION,
  readPurchasesInvoke,
  type CatalogSummary,
  type PurchaseFilters,
  type PurchaseRow,
  type PurchasesPayload,
  type PurchasesRequestBody,
} from './purchases-contract';

const SEARCH_WAIT_MS = 400;
const SAFE_CODE = /^[a-z0-9_]{1,80}$/;

export interface PurchasesInvoker {
  invoke(name: typeof PURCHASES_FUNCTION, body: PurchasesRequestBody): Promise<{ data: unknown; error: unknown }>;
}

interface MountOptions {
  stillCurrent: () => boolean;
  onDenied: (reason: 'invalid_session' | 'not_admin') => void;
}

export function mountLivePurchases(root: HTMLElement, invoker: PurchasesInvoker, options: MountOptions): { dispose: () => void } {
  let generation = 0;
  let disposed = false;
  let draft = '';
  let appliedSearch = '';
  let page = 1;
  let filters: PurchaseFilters = { ...DEFAULT_PURCHASE_FILTERS };
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
    root.dataset.purchasesState = state;
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
    const form = root.querySelector<HTMLFormElement>('#purchase-filters');
    const input = root.querySelector<HTMLInputElement>('#purchase-search');
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
    root.querySelectorAll<HTMLSelectElement>('[data-filter]').forEach((select) => {
      select.addEventListener('change', () => {
        const key = select.dataset.filter as keyof PurchaseFilters | undefined;
        if (!key || !isFilterValue(key, select.value)) return;
        filters = { ...filters, [key]: select.value };
        window.clearTimeout(timer);
        draft = appliedSearch;
        page = 1;
        void refresh();
      });
    });
    root.querySelector<HTMLButtonElement>('#purchases-retry')?.addEventListener('click', () => {
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
    const requestedFilters = { ...filters };
    const body = buildPurchasesRequest(requestedSearch, requestedPage, requestedFilters);
    if (!body) {
      setBanner('That search was not sent. No purchase records are shown.');
      render(shell(draft, requestedFilters, 'A search longer than 200 characters was not sent. No records are shown.', '', true), 'error');
      return;
    }

    setBanner('Loading purchase records from the administrator service.');
    render(shell(draft, requestedFilters, 'Loading purchase records…', '', false), 'loading');

    let result: { data: unknown; error: unknown };
    try {
      result = await invoker.invoke(PURCHASES_FUNCTION, body);
    } catch {
      result = { data: null, error: { name: 'FunctionsFetchError' } };
    }
    const outcome = await readPurchasesInvoke(result, {
      search: requestedSearch ? requestedSearch : null,
      page: requestedPage,
      filters: requestedFilters,
    });
    if (disposed || requestId !== generation || !sameRequest(requestedSearch, requestedPage, requestedFilters) || !options.stillCurrent()) return;

    if (outcome.status === 'denied') {
      options.onDenied(outcome.reason);
      return;
    }
    if (outcome.status !== 'ok') {
      const message = failureMessage(outcome);
      setBanner('The purchases request failed. No purchase records are shown.');
      render(shell(draft, requestedFilters, message, retryButton(), true), 'error');
      return;
    }

    page = outcome.purchases.page;
    setBanner('Purchase records from the administrator service. A store row is one entitlement lineage, not each payment.');
    render(shell(draft, requestedFilters, directoryCopy(outcome.purchases), readyBody(outcome.purchases), false, summary(outcome.purchases)), 'ready');
  }

  function sameRequest(search: string, requestedPage: number, requestedFilters: PurchaseFilters): boolean {
    return search === appliedSearch && requestedPage === page && sameFilters(requestedFilters, filters);
  }

  void refresh();
  return { dispose };
}

function shell(draft: string, filters: PurchaseFilters, lede: string, body: string, failed: boolean, summaryHtml = ''): string {
  return `
    ${summaryHtml}
    <section class="panel" data-purchases-panel="${failed ? 'error' : 'directory'}">
      <div class="panel-head">
        <h2>Entitlement and grant records</h2>
        <p class="lede">A store row is one stored entitlement lineage. A renewal or a later verification updates that same row. This directory does not count payments, sales, or revenue. Grants are account access, not Apple or Google Play purchases. Several records for one account stay separate.</p>
        <p class="lede">${esc(lede)}</p>
      </div>
      ${filterForm(draft, filters)}
      ${body}
    </section>
  `;
}

function readyBody(directory: PurchasesPayload): string {
  return table(directory);
}

function summary(directory: PurchasesPayload): string {
  const filtered = directory.summary.filtered;
  const catalog = directory.summary.production_catalog;
  return `
    <section aria-label="Record counts">
      <h2>Record counts</h2>
      <p class="lede">Counts are entitlement lineages and grants, not customer accounts. Promotional-code records are already inside the Apple or Google Play counts and are not added again.</p>
      <p class="eyebrow">Records matching current filters</p>
      <div class="stats">
        ${stat('Matching records', filtered.matching_records, 'Every matching page, not only the rows below.')}
        ${stat('Production store records', filtered.production_store_records, 'Production lineages in this filtered set.')}
        ${stat('Apple store records', filtered.apple_records, 'Apple lineages in the selected environment.')}
        ${stat('Google Play store records', filtered.google_records, 'Google Play lineages in the selected environment.')}
        ${stat('Promotional-code records', filtered.promotional_code_records, 'A subset of the store records. No redemption code is stored.')}
        ${stat('Grant records', filtered.grant_records, 'Not store payments.')}
        ${stat('Unowned production store records', filtered.unowned_production_store_records, 'Production lineages with no stored owner.')}
        ${stat('Explicitly requiring review', filtered.explicitly_requiring_review, 'Unowned legacy lineages with a pending legacy link request.')}
        ${stat('Sandbox store records', filtered.sandbox_store_records, 'Sandbox or license-test lineages in this filtered set. Grants are not included here.')}
      </div>
      <p class="eyebrow">Overall production catalog</p>
      <p class="lede">These counts ignore the current filters and search. Sandbox lineages sit beside the catalog and are not included in its Apple, Google Play, promotional-code, unowned, or review totals.</p>
      <div class="stats">
        ${catalogStats(catalog)}
      </div>
      <details class="disclosure">
        <summary><span class="primary">Figures this directory does not count</span></summary>
        <div class="disclosure-body">
          <ul class="history">
            <li>${esc(directory.summary.unavailable.revenue)}</li>
            <li>${esc(directory.summary.unavailable.payment_amounts)}</li>
            <li>${esc(directory.summary.unavailable.verified_payments)}</li>
            <li>${esc(directory.summary.unavailable.renewal_events)}</li>
            <li>${esc(directory.summary.unavailable.redemption_codes)}</li>
            <li>${esc(directory.summary.unavailable.unresolved_without_link_request)}</li>
          </ul>
        </div>
      </details>
    </section>
  `;
}

function catalogStats(catalog: CatalogSummary): string {
  return [
    stat('Production store records', catalog.production_store_records, 'Production lineages only.'),
    stat('Apple store records', catalog.apple_records, 'Production Apple lineages. Sandbox Apple lineages are not included.'),
    stat('Google Play store records', catalog.google_records, 'Production Google Play lineages. Sandbox Google Play lineages are not included.'),
    stat('Promotional-code records', catalog.promotional_code_records, 'A subset of the production store records, not an additional count.'),
    stat('Grant records', catalog.grant_records, 'Every grant. A grant is not a sandbox purchase.'),
    stat('Unowned production store records', catalog.unowned_production_store_records, 'Production lineages with no stored owner.'),
    stat('Explicitly requiring review', catalog.explicitly_requiring_review, 'Production lineages only.'),
    stat('Sandbox store records', catalog.sandbox_store_records, 'Counted beside the production catalog, not inside the other catalog totals.'),
  ].join('');
}

function table(directory: PurchasesPayload): string {
  const rows = directory.rows.length === 0 ? emptyRow(directory) : directory.rows.map(rowHtml).join('');
  return `
    <div class="table-wrap">
      <table class="records">
        <caption>Dates are Pacific Time. Access deadline is not a renewal date. No amounts or redemption codes are shown.</caption>
        <thead>
          <tr>
            <th>Account</th>
            <th>Record</th>
            <th>Product</th>
            <th>Payment</th>
            <th>Entitlement status</th>
            <th>Production premium</th>
            <th>Deadline</th>
            <th>Ownership</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pager(directory.page, directory.page_size, directory.total, 'matching records')}
  `;
}

function emptyRow(directory: PurchasesPayload): string {
  const message = directory.total === 0
    ? directory.search
      ? 'No records match this search. An unowned record has no account, so a name or email search does not find it.'
      : 'No records match these filters.'
    : 'This page has no records. The matching total is still shown below.';
  return `<tr><td colspan="8" class="empty">${esc(message)}</td></tr>`;
}

function rowHtml(row: PurchaseRow): string {
  return `<tr data-record-kind="${esc(row.record_kind)}" data-record-id="${esc(row.id)}" data-environment="${esc(row.environment ?? 'grant')}" data-contributes="${row.contributes_access ? 'true' : 'false'}" data-review="${row.explicitly_requiring_review ? 'true' : 'false'}">
    <td>${accountCell(row)}</td>
    <td>${recordCell(row)}</td>
    <td>${productCell(row)}</td>
    <td>${paymentCell(row)}</td>
    <td>${statusCell(row)}</td>
    <td>${row.contributes_access ? esc('Counted in production premium reporting') : esc('Not counted in production premium reporting')}</td>
    <td>${deadlineCell(row)}</td>
    <td>${ownershipCell(row)}</td>
  </tr>`;
}

function accountCell(row: PurchaseRow): string {
  const account = row.account;
  if (!account) return '<span class="primary">Unowned</span><span class="secondary">No stored owner</span>';
  const name = account.display_name ?? 'No name saved';
  const email = account.email ? emailText(account.email) : esc('No email saved');
  const sandbox = account.sandbox_purchase_test_allowed
    ? `${pill('info', 'Sandbox test permission')}<span class="secondary">May hold a sandbox or license-test purchase. Not a purchase review.</span>`
    : '';
  return `<a href="${esc(learnerHref(account.user_id))}">${esc(name)}</a><span class="secondary">${email}</span>${sandbox}`;
}

function recordCell(row: PurchaseRow): string {
  if (row.record_kind === 'grant') {
    return '<span class="primary">Grant</span><span class="secondary">No store environment</span>';
  }
  const platform = row.platform === 'apple' ? 'Apple' : 'Google Play';
  const environment = row.environment === 'production' ? 'Production store entitlement' : 'Sandbox or license-test entitlement';
  return `<span class="primary">${esc(platform)}</span><span class="secondary">${esc(environment)}</span>`;
}

function productCell(row: PurchaseRow): string {
  if (row.record_kind === 'grant') {
    const label = row.grant_kind === 'lifetime' ? 'Complimentary lifetime grant' : 'Temporary migration grant';
    return `<span class="primary">${esc(label)}</span><span class="secondary">Recorded ${esc(formatDateTime(row.recorded_at))}</span>`;
  }
  const product = row.product === 'lifetime' ? 'Lifetime' : row.product === 'monthly' ? 'Monthly' : row.product === 'annual' ? 'Annual' : 'Unrecognized product';
  const original = row.original_purchase_at ? `<span class="secondary">Original purchase ${esc(formatDateTime(row.original_purchase_at))}</span>` : '';
  return `<span class="primary">${esc(product)}</span><span class="secondary">${esc(row.product_id)}</span>${original}`;
}

function paymentCell(row: PurchaseRow): string {
  if (row.record_kind === 'grant') return '<span class="primary">Not a store payment</span>';
  return `<span class="primary">${esc(paymentLabel(row.payment_classification))}</span>`;
}

function statusCell(row: PurchaseRow): string {
  const label = statusLabel(row.entitlement_status);
  if (row.record_kind === 'grant' && row.expiration_lapsed) {
    return `<span class="primary">${esc(label)}</span><span class="secondary">The stored status is still active, but the expiry time has passed, so this grant is not current production premium.</span>`;
  }
  if (row.record_kind === 'store' && (row.entitlement_status === 'expired' || row.entitlement_status === 'revoked')) {
    return `<span class="primary">${esc(label)}</span><span class="secondary">Stored status is inactive.</span>`;
  }
  if (row.record_kind === 'store' && row.entitlement_status === 'inactive' && row.inactive_reason) {
    return `<span class="primary">${esc(label)}</span><span class="secondary">${esc(reasonLabel(row.inactive_reason))}</span>`;
  }
  return `<span class="primary">${esc(label)}</span>`;
}

function deadlineCell(row: PurchaseRow): string {
  if (row.record_kind === 'grant') {
    return `<span class="primary">${esc(row.grant_expires_at ? formatDateTime(row.grant_expires_at) : 'No expiry time')}</span><span class="secondary">Grant expiry, not a renewal date</span>`;
  }
  return `<span class="primary">${esc(row.access_deadline ? formatDateTime(row.access_deadline) : 'None recorded')}</span><span class="secondary">Access deadline</span>`;
}

function ownershipCell(row: PurchaseRow): string {
  const owned = row.ownership === 'owned' ? pill('info', 'Owned') : pill('neutral', 'Unowned');
  if (row.explicitly_requiring_review) {
    return `${owned}${pill('warn', 'Explicitly requiring review')}<span class="secondary">Pending legacy link request</span>`;
  }
  if (row.ownership === 'unowned') return `${owned}<span class="secondary">Not explicitly requiring review</span>`;
  return owned;
}

function filterForm(draft: string, filters: PurchaseFilters): string {
  return `
    <form class="filters" id="purchase-filters" role="search">
      <label for="purchase-search">Search owning account
        <input id="purchase-search" type="search" name="q" maxlength="200" value="${esc(draft)}" autocomplete="off" spellcheck="false" placeholder="Name, email, or exact account id" />
      </label>
      ${select('environment', 'Environment', filters.environment, [
        ['production', 'Production'],
        ['sandbox', 'Sandbox'],
        ['all', 'Production, sandbox, and grants'],
      ])}
      ${select('platform', 'Record', filters.platform, [
        ['all', 'Stores and grants'],
        ['apple', 'Apple'],
        ['google', 'Google Play'],
        ['grant', 'Grants only'],
      ])}
      ${select('product', 'Product', filters.product, [
        ['all', 'All products'],
        ['monthly', 'Monthly'],
        ['annual', 'Annual'],
        ['lifetime', 'Lifetime'],
      ])}
      ${select('payment_classification', 'Payment', filters.payment_classification, [
        ['all', 'All payment classifications'],
        ['promotional_code_indicated', 'Promotional code indicated'],
        ['unknown', 'Payment type unknown'],
        ['legacy_unverified', 'Payment type unverified (legacy)'],
      ])}
      ${select('entitlement', 'Entitlement', filters.entitlement, [
        ['all', 'All statuses'],
        ['active', 'Active'],
        ['grace', 'Grace'],
        ['pending', 'Pending'],
        ['expired', 'Expired'],
        ['revoked', 'Revoked'],
        ['inactive', 'Inactive'],
        ['provisioned', 'Provisioned'],
      ])}
      ${select('ownership', 'Ownership', filters.ownership, [
        ['all', 'All ownership'],
        ['owned', 'Owned'],
        ['unowned', 'Unowned'],
      ])}
      ${select('resolution', 'Review', filters.resolution, [
        ['all', 'All review states'],
        ['required', 'Explicitly requiring review'],
        ['not_required', 'Not explicitly requiring review'],
      ])}
    </form>
  `;
}

function select(key: keyof PurchaseFilters, label: string, selected: string, options: Array<[string, string]>): string {
  const id = `filter-${key.replaceAll('_', '-')}`;
  const choices = options
    .map(([value, text]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`)
    .join('');
  return `<label for="${id}">${esc(label)}<select id="${id}" data-filter="${esc(key)}">${choices}</select></label>`;
}

function directoryCopy(directory: PurchasesPayload): string {
  const filter = directory.search ? `Search "${directory.search}". ` : '';
  const environment = directory.filters.environment === 'production'
    ? 'Production store lineages and grants. '
    : directory.filters.environment === 'sandbox'
      ? 'Sandbox store lineages only. Grants are not listed here. '
      : 'Production lineages, sandbox lineages, and grants, each once. ';
  return `${filter}${environment}${directory.total} matching record${directory.total === 1 ? '' : 's'}.`;
}

function paymentLabel(classification: 'promotional_code_indicated' | 'unknown' | 'legacy_unverified'): string {
  if (classification === 'promotional_code_indicated') return 'Promotional code indicated';
  if (classification === 'unknown') return 'Payment type unknown';
  return 'Payment type unverified (legacy)';
}

function statusLabel(status: PurchaseRow['entitlement_status']): string {
  if (status === 'active') return 'Active';
  if (status === 'grace') return 'Grace';
  if (status === 'pending') return 'Pending';
  if (status === 'expired') return 'Expired';
  if (status === 'revoked') return 'Revoked';
  if (status === 'inactive') return 'Inactive';
  return 'Provisioned';
}

function reasonLabel(reason: string): string {
  if (reason === 'refunded') return 'Refunded. Still inactive, not revoked.';
  if (reason === 'canceled') return 'Canceled';
  if (reason === 'paused') return 'Paused';
  if (reason === 'hold') return 'Hold';
  if (reason === 'unknown') return 'Reason unknown';
  if (reason === 'unrecognized') return 'Reason not recognized';
  return 'Stored inactive reason';
}

function failureMessage(outcome: { status: string; code?: string | null }): string {
  if (outcome.status === 'network') return 'The purchases request did not reach the server. No records are shown.';
  if (outcome.status === 'invalid_body') return 'The purchases request was rejected (invalid_body). No records are shown.';
  const code = outcome.code && SAFE_CODE.test(outcome.code) ? outcome.code : '';
  if (code === 'purchases_unavailable') return 'The purchase directory could not be read (purchases_unavailable). No records are shown.';
  if (code === 'authorization_unavailable') return 'The administrator check could not be completed (authorization_unavailable). No records are shown.';
  if (code) return `The purchases response could not be used (${code}). No records are shown.`;
  return 'The purchases response could not be used. No records are shown.';
}

function retryButton(): string {
  return '<div class="signin-actions"><button type="button" id="purchases-retry">Try again</button></div>';
}

function isFilterValue(key: keyof PurchaseFilters, value: string): boolean {
  const allowed: Record<keyof PurchaseFilters, readonly string[]> = {
    platform: ['all', 'apple', 'google', 'grant'],
    product: ['all', 'monthly', 'annual', 'lifetime'],
    payment_classification: ['all', 'promotional_code_indicated', 'unknown', 'legacy_unverified'],
    entitlement: ['all', 'active', 'grace', 'expired', 'revoked', 'inactive', 'pending', 'provisioned'],
    ownership: ['all', 'owned', 'unowned'],
    environment: ['production', 'sandbox', 'all'],
    resolution: ['all', 'required', 'not_required'],
  };
  return allowed[key].includes(value);
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

function setBanner(message: string): void {
  const banner = document.getElementById('dashboard-banner');
  if (!banner) return;
  banner.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  banner.append(paragraph);
}
