import { formatDate, formatDateTime, formatDay, reportingQueryFromSearch } from '../dates';
import { classificationLabel, platformLabel } from '../labels';
import { accessSummary, emailText, esc, learnerHref, stat } from '../markup';
import { createDashboardSource } from '../source';
import type { DatePreset, Overview, ReportingQuery } from '../types';
import { fillSourceNote, paint, showFailure } from '../view';

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

function rangeSentence(overview: Overview): string {
  const { range } = overview;
  const clock = formatDateTime(overview.asOf);
  if (!range.startDay) {
    return `All recorded history through ${formatDay(range.endDay)} (Pacific Time). The demonstration clock is fixed at ${clock}. All time does not add events this preview never collected.`;
  }
  return `${formatDay(range.startDay)} – ${formatDay(range.endDay)} (Pacific Time). The demonstration clock is fixed at ${clock}. Only recorded events inside this range are counted.`;
}

function signupRows(overview: Overview): string {
  const shown = overview.periodRegistrationList.slice(0, 10);
  if (shown.length === 0) {
    return '<p class="empty">No demonstration learners registered in this period.</p>';
  }
  const hidden = overview.periodRegistrations - shown.length;
  const caption = hidden > 0
    ? `Latest 10 of ${overview.periodRegistrations} registrations in this period. Dates are Pacific Time.`
    : 'Registrations in the selected period. Dates are Pacific Time.';
  const body = shown
    .map(
      (row) => `<tr>
        <td><a href="${esc(learnerHref(row.id))}">${esc(row.name)}</a><span class="secondary">${emailText(row.email)}</span></td>
        <td>${esc(formatDate(row.signedUpAt))}</td>
        <td>${accessSummary(row.access)}</td>
      </tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table class="fit">
    <caption>${esc(caption)}</caption>
    <thead><tr><th>Learner</th><th>Signup</th><th>Premium access</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function periodForm(overview: Overview): string {
  const options = PRESETS.map((item) => {
    const selected = item.value === overview.range.preset ? ' selected' : '';
    return `<option value="${item.value}"${selected}>${esc(item.label)}</option>`;
  }).join('');
  const custom = overview.range.preset === 'custom';
  const locked = overview.range.preset === 'all';
  const dateHint = custom || locked ? '' : ' Edit a date to use a custom range.';
  const start = overview.range.startDay ?? '';
  const end = overview.range.endDay;
  return `
    <form class="filters" id="period-form">
      <label for="period-preset">Reporting period
        <select id="period-preset" name="period">
          ${options}
        </select>
      </label>
      <label for="period-start">Start
        <input id="period-start" name="start" type="date" value="${esc(start)}" ${locked ? 'disabled' : ''} />
      </label>
      <label for="period-end">End
        <input id="period-end" name="end" type="date" value="${esc(end)}" ${locked ? 'disabled' : ''} />
      </label>
    </form>
    <p class="lede">${esc(rangeSentence(overview))}${dateHint}</p>
  `;
}

export async function mountOverview(root: HTMLElement): Promise<void> {
  fillSourceNote();
  const source = createDashboardSource();
  let query = reportingQueryFromSearch(new URLSearchParams(window.location.search));

  function syncUrl(resolvedPreset: DatePreset, startDay: string | null, endDay: string): void {
    const url = new URL(window.location.href);
    if (resolvedPreset === '30d') url.searchParams.delete('period');
    else url.searchParams.set('period', resolvedPreset);
    if (resolvedPreset === 'custom' && startDay) {
      url.searchParams.set('start', startDay);
      url.searchParams.set('end', endDay);
    } else {
      url.searchParams.delete('start');
      url.searchParams.delete('end');
    }
    window.history.replaceState(null, '', url);
  }

  async function draw(): Promise<void> {
    try {
      const overview = await source.getOverview(query);
      query = { preset: overview.range.preset, startDay: overview.range.startDay, endDay: overview.range.endDay };
      syncUrl(overview.range.preset, overview.range.startDay, overview.range.endDay);
      const unresolved = await source.listPurchases({
        search: '',
        page: 1,
        pageSize: 20,
        plan: 'all',
        store: 'all',
        classification: 'all',
        ownership: 'unresolved',
      });
      const unresolvedRows =
        unresolved.purchases.length === 0
          ? '<p class="empty">No unresolved demonstration purchases.</p>'
          : `<div class="table-wrap"><table class="fit">
              <caption>Current purchase-review records. This list does not follow the reporting period.</caption>
              <thead><tr><th>Store</th><th>Classification</th><th>Learner</th></tr></thead>
              <tbody>
                ${unresolved.purchases
                  .map((row) => {
                    const learner = row.learnerId
                      ? `<a href="${esc(learnerHref(row.learnerId))}">${esc(row.learnerName ?? 'Learner')}</a>`
                      : 'No app account';
                    const store = row.platform === 'none' ? 'No store' : platformLabel(row.platform);
                    return `<tr>
                      <td class="nowrap">${esc(store)}</td>
                      <td><span class="primary">${esc(classificationLabel(row))}</span><span class="secondary">${esc(row.note)}</span></td>
                      <td>${learner}</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table></div>`;

      const html = `
        <section class="metric-group" aria-labelledby="current-heading">
          <h2 id="current-heading">Current state</h2>
          <p class="lede">These counts describe the demonstration set as of the sample clock. Choosing another reporting period does not change them.</p>
          <div class="stats stats-4">
            ${stat('Total registered learners', overview.totalLearners, 'All demonstration accounts. Not a period count.')}
            ${stat('Completed at least one lesson', overview.learnersWithAnyCompletion, 'Ever recorded. This is not last sign-in.')}
            ${stat('Current premium accounts', overview.premiumAccounts, 'Effective access now. Each learner is counted once.')}
            ${stat('Unresolved purchase records', overview.unresolvedPurchases, 'Records still in review. Not a premium-access status.')}
          </div>
        </section>
        <section class="metric-group" aria-labelledby="period-heading">
          <h2 id="period-heading">Reporting period</h2>
          ${periodForm(overview)}
          <div class="stats stats-3">
            ${stat('Registrations', overview.periodRegistrations, 'Accounts created in the selected period.')}
            ${stat('Learners with completions', overview.periodLearnersWithCompletions, 'Unique learners with a recorded completion in the period.')}
            ${stat('Lessons completed', overview.periodLessonsCompleted, 'Completion records in the period. Learners are not counted again for each lesson.')}
          </div>
        </section>
        <div class="split">
          <section class="panel">
            <h2>Registrations in this period</h2>
            ${signupRows(overview)}
          </section>
          <section class="panel">
            <h2>Unresolved purchases</h2>
            ${unresolvedRows}
            <p class="panel-link"><a href="/dashboard/purchases/?ownership=unresolved">Review unresolved records</a> · <a href="/dashboard/purchases/?ownership=unowned">${overview.unownedPurchases} unowned record${overview.unownedPurchases === 1 ? '' : 's'}</a></p>
          </section>
        </div>
      `;
      await paint(root, html, bind);
    } catch (error) {
      console.error(error);
      await showFailure(root);
    }
  }

  function bind(): void {
    const preset = root.querySelector<HTMLSelectElement>('#period-preset');
    const start = root.querySelector<HTMLInputElement>('#period-start');
    const end = root.querySelector<HTMLInputElement>('#period-end');
    preset?.addEventListener('change', () => {
      const value = preset.value as DatePreset;
      if (value === 'custom') {
        query = { preset: 'custom', startDay: start?.value, endDay: end?.value };
      } else {
        query = { preset: value };
      }
      void draw();
    });
    const useCustom = () => {
      query = { preset: 'custom', startDay: start?.value, endDay: end?.value };
      void draw();
    };
    start?.addEventListener('change', useCustom);
    end?.addEventListener('change', useCustom);
  }

  await draw();
}
