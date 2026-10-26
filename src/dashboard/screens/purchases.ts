import {
  accessPill,
  classificationCell,
  esc,
  expirationText,
  learnerCell,
  ownershipPill,
  pager,
  planCell,
  platformCell,
  stat,
  statusPill,
} from '../markup';
import { createDashboardSource, PAGE_SIZE } from '../source';
import type { ClassificationFilter, OwnershipState, ProductPlan, StoreFilter } from '../types';
import { fillSourceNote, paint, showFailure } from '../view';

function option(value: string, label: string, selected: string): string {
  const current = value === selected ? ' selected' : '';
  return `<option value="${esc(value)}"${current}>${esc(label)}</option>`;
}

function isPlan(value: string | null): value is ProductPlan | 'all' {
  return value === 'all' || value === 'monthly' || value === 'annual' || value === 'lifetime';
}

function isStore(value: string | null): value is StoreFilter {
  return value === 'all' || value === 'apple' || value === 'google' || value === 'grant';
}

function isClassification(value: string | null): value is ClassificationFilter {
  return (
    value === 'all' ||
    value === 'offer_code' ||
    value === 'unknown' ||
    value === 'paid_purchase' ||
    value === 'complimentary_lifetime' ||
    value === 'temporary_migration'
  );
}

function isOwnership(value: string | null): value is OwnershipState | 'all' {
  return value === 'all' || value === 'owned' || value === 'unowned' || value === 'unresolved';
}

export async function mountPurchases(root: HTMLElement): Promise<void> {
  fillSourceNote();
  const source = createDashboardSource();
  const params = new URLSearchParams(window.location.search);
  let search = '';
  let page = 1;
  let plan: ProductPlan | 'all' = isPlan(params.get('plan')) ? (params.get('plan') as ProductPlan | 'all') : 'all';
  let store: StoreFilter = isStore(params.get('store')) ? (params.get('store') as StoreFilter) : 'all';
  let classification: ClassificationFilter = isClassification(params.get('classification'))
    ? (params.get('classification') as ClassificationFilter)
    : 'all';
  let ownership: OwnershipState | 'all' = isOwnership(params.get('ownership'))
    ? (params.get('ownership') as OwnershipState | 'all')
    : 'all';
  let timer = 0;
  let requestId = 0;

  function syncUrl(): void {
    const url = new URL(window.location.href);
    const set = (key: string, value: string) => {
      if (value === 'all') url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    };
    url.searchParams.delete('kind');
    set('plan', plan);
    set('store', store);
    set('classification', classification);
    set('ownership', ownership);
    window.history.replaceState(null, '', url);
  }

  async function draw(): Promise<void> {
    const current = ++requestId;
    try {
      const result = await source.listPurchases({
        search,
        page,
        pageSize: PAGE_SIZE,
        plan,
        store,
        classification,
        ownership,
      });
      if (current !== requestId) return;
      page = result.page;
      syncUrl();
      const counts = result.counts;
      const rows =
        result.purchases.length === 0
          ? '<tr><td colspan="8" class="empty">No demonstration purchases match those filters.</td></tr>'
          : result.purchases
              .map(
                (row) => `<tr>
                  <td>${learnerCell(row)}</td>
                  <td>${platformCell(row)}</td>
                  <td>${planCell(row)}</td>
                  <td>${classificationCell(row)}</td>
                  <td>${statusPill(row.entitlementStatus)}</td>
                  <td>${accessPill(row.effectiveAccess)}</td>
                  <td>${esc(expirationText(row))}</td>
                  <td>${ownershipPill(row.ownership)}</td>
                </tr>`,
              )
              .join('');
      const html = `
        <section aria-label="Record counts">
          <h2>Record counts</h2>
          <p class="lede">These totals count records in the demonstration set, not customer accounts, and they do not follow the Overview reporting period. Promotional-code rows are already included in the Apple or Google transaction counts. Grants are not store transactions. Of the store transactions, ${counts.unknownPaymentTransactions} have payment type unknown and ${counts.unverifiedLegacyTransactions} are payment type unverified (legacy). A verified store row is not treated as a confirmed paid purchase.</p>
          <div class="stats">
            ${stat('Apple store transactions', counts.appleTransactions, 'Store rows. Not customer accounts.')}
            ${stat('Google Play transactions', counts.googleTransactions, 'Store rows. Not customer accounts.')}
            ${stat('Promotional code indicated', counts.offerCodeTransactions, 'Subset of the store counts. No redemption code is stored.')}
            ${stat('Complimentary lifetime grants', counts.complimentaryLifetimeGrants, 'Not store transactions.')}
            ${stat('Temporary migration grants', counts.temporaryMigrationGrants, 'Not store transactions.')}
          </div>
          <div class="stats stats-2">
            ${stat('Unowned records', counts.unowned, 'No app-account owner. Not an account-owned purchase.')}
            ${stat('Unresolved records', counts.unresolved, 'Ownership still open. Not a learner’s premium status.')}
          </div>
        </section>
        <section class="panel">
          <div class="panel-head">
            <h2>Purchase and grant records</h2>
            <p class="lede">Store, classification, entitlement status, and effective access are separate. An active store entitlement does not unlock an account unless the record is owned. The table follows the filters. Newest records are listed first.</p>
          </div>
          <form class="filters" id="purchase-filters">
            <label for="purchase-search">Search
              <input id="purchase-search" type="search" value="${esc(search)}" autocomplete="off" spellcheck="false" placeholder="Learner, product, or note" />
            </label>
            <label for="filter-plan">Product
              <select id="filter-plan">
                ${option('all', 'All products', plan)}
                ${option('monthly', 'Monthly', plan)}
                ${option('annual', 'Annual', plan)}
                ${option('lifetime', 'Lifetime', plan)}
              </select>
            </label>
            <label for="filter-store">Store
              <select id="filter-store">
                ${option('all', 'Stores and grants', store)}
                ${option('apple', 'Apple', store)}
                ${option('google', 'Google Play', store)}
                ${option('grant', 'Grants only', store)}
              </select>
            </label>
            <label for="filter-classification">Classification
              <select id="filter-classification">
                ${option('all', 'All classifications', classification)}
                ${option('offer_code', 'Promotional code indicated', classification)}
                ${option('unknown', 'Payment type unknown', classification)}
                ${option('paid_purchase', 'Payment type unverified (legacy)', classification)}
                ${option('complimentary_lifetime', 'Complimentary lifetime grant', classification)}
                ${option('temporary_migration', 'Temporary migration grant', classification)}
              </select>
            </label>
            <label for="filter-ownership">Ownership
              <select id="filter-ownership">
                ${option('all', 'All ownership', ownership)}
                ${option('owned', 'Owned', ownership)}
                ${option('unowned', 'Unowned', ownership)}
                ${option('unresolved', 'Unresolved', ownership)}
              </select>
            </label>
          </form>
          <div class="table-wrap">
            <table class="records">
              <caption>Dates are Pacific Time. No prices or redemption codes are stored in this preview.</caption>
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Store</th>
                  <th>Product</th>
                  <th>Classification</th>
                  <th>Entitlement status</th>
                  <th>Effective access</th>
                  <th>Expiration</th>
                  <th>Ownership</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${pager(result.page, result.pageSize, result.total, 'records')}
        </section>
      `;
      await paint(root, html, bind);
    } catch (error) {
      console.error(error);
      if (current !== requestId) return;
      await showFailure(root);
    }
  }

  function bind(): void {
    const form = root.querySelector<HTMLFormElement>('#purchase-filters');
    const input = root.querySelector<HTMLInputElement>('#purchase-search');
    const planSelect = root.querySelector<HTMLSelectElement>('#filter-plan');
    const storeSelect = root.querySelector<HTMLSelectElement>('#filter-store');
    const classificationSelect = root.querySelector<HTMLSelectElement>('#filter-classification');
    const ownershipSelect = root.querySelector<HTMLSelectElement>('#filter-ownership');
    input?.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        search = input.value;
        page = 1;
        void draw();
      }, 200);
    });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(timer);
      search = input?.value ?? '';
      page = 1;
      void draw();
    });
    planSelect?.addEventListener('change', () => {
      if (isPlan(planSelect.value)) plan = planSelect.value;
      page = 1;
      void draw();
    });
    storeSelect?.addEventListener('change', () => {
      if (isStore(storeSelect.value)) store = storeSelect.value;
      page = 1;
      void draw();
    });
    classificationSelect?.addEventListener('change', () => {
      if (isClassification(classificationSelect.value)) classification = classificationSelect.value;
      page = 1;
      void draw();
    });
    ownershipSelect?.addEventListener('change', () => {
      if (isOwnership(ownershipSelect.value)) ownership = ownershipSelect.value;
      page = 1;
      void draw();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        page = Number(button.dataset.page);
        void draw();
      });
    });
  }

  await draw();
}
