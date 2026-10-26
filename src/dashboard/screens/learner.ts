import { formatDate, formatDateTime } from '../dates';
import {
  accessPill,
  classificationCell,
  emailText,
  esc,
  expirationText,
  ownershipPill,
  planCell,
  platformCell,
  statusPill,
} from '../markup';
import { createDashboardSource } from '../source';
import { fillSourceNote, paint, showFailure } from '../view';
import type { LearnerDetail, ModuleProgress, PurchaseRecord } from '../types';

function facts(detail: LearnerDetail): string {
  const rows: [string, string][] = [
    ['Name', esc(detail.name)],
    ['Email', emailText(detail.email)],
    ['Account id', `<span class="code">${esc(detail.id)}</span>`],
    ['Signup', esc(formatDate(detail.signedUpAt))],
    ['Last sign-in', esc(detail.lastSignInAt ? formatDateTime(detail.lastSignInAt) : 'None recorded')],
    ['Premium source', esc(detail.access.sourceLabel)],
    ['Completed lessons', esc(String(detail.completedLessonCount))],
  ];
  return `<dl class="facts">${rows
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`)
    .join('')}</dl>`;
}

function lastCompletion(module: ModuleProgress): string | null {
  const dates = module.lessons.map((lesson) => lesson.completedAt).filter((value): value is string => Boolean(value));
  if (dates.length === 0) return null;
  return dates.reduce((latest, value) => (value > latest ? value : latest));
}

function progression(detail: LearnerDetail): string {
  const totalLessons = detail.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  const cards = detail.modules
    .map((module) => {
      const done = module.lessons.filter((lesson) => lesson.completedAt).length;
      const width = module.lessons.length === 0 ? 0 : Math.round((done / module.lessons.length) * 100);
      const latest = lastCompletion(module);
      const when = latest ? `Last completion ${formatDate(latest)}` : 'No completions recorded';
      const lessons = module.lessons
        .map((lesson) => {
          const state = lesson.completedAt ? 'is-done' : '';
          const lessonWhen = lesson.completedAt ? `Completed ${formatDate(lesson.completedAt)}` : 'Not completed';
          return `<li class="lesson ${state}"><span class="mark" aria-hidden="true"></span><span><span class="primary">${esc(lesson.lessonTitle)}</span><span class="secondary">${esc(lessonWhen)}</span></span></li>`;
        })
        .join('');
      return `<details class="disclosure">
        <summary>
          <span class="primary">${esc(module.moduleTitle)}</span>
          <span class="secondary">${done} of ${module.lessons.length} · ${esc(when)}</span>
        </summary>
        <div class="disclosure-body">
          <div class="meter" role="img" aria-label="${esc(module.moduleTitle)}, ${done} of ${module.lessons.length} lessons completed"><span style="width:${width}%"></span></div>
          <ul class="lesson-list">${lessons}</ul>
        </div>
      </details>`;
    })
    .join('');
  return `<p class="lede">${detail.completedLessonCount} of ${totalLessons} lessons completed in the ${esc(detail.curriculumLabel).toLowerCase()}. Dates are recorded completion days. This preview does not estimate time spent. Open a module to see its lessons.</p><div class="module-grid">${cards}</div>`;
}

function history(detail: LearnerDetail): string {
  if (detail.history.length === 0) return '<p class="empty">No completed lessons are recorded.</p>';
  const items = detail.history
    .map(
      (item) =>
        `<li><span class="primary">${esc(item.lessonTitle)}</span><span class="secondary">${esc(item.moduleTitle)} · ${esc(formatDate(item.completedAt))}</span></li>`,
    )
    .join('');
  return `<details class="disclosure">
    <summary>
      <span class="primary">Recorded completions</span>
      <span class="secondary">${detail.history.length} newest first</span>
    </summary>
    <div class="disclosure-body"><ol class="history">${items}</ol></div>
  </details>`;
}

function recordRows(records: PurchaseRecord[], includeOwnership: boolean): string {
  return records
    .map(
      (row) => `<tr>
        <td>${platformCell(row)}</td>
        <td>${planCell(row)}</td>
        <td>${classificationCell(row)}</td>
        <td>${statusPill(row.entitlementStatus)}</td>
        <td>${accessPill(row.effectiveAccess)}</td>
        <td>${esc(expirationText(row))}</td>
        ${includeOwnership ? `<td>${ownershipPill(row.ownership)}</td>` : ''}
      </tr>`,
    )
    .join('');
}

function entitlements(detail: LearnerDetail): string {
  if (detail.entitlements.length === 0) {
    return '<p class="empty">No owned entitlement is recorded. An unresolved purchase does not grant premium access.</p>';
  }
  return `<p class="lede">Owned records only. A separate unresolved purchase, if one is listed below, does not change this access.</p>
    <div class="table-wrap"><table>
      <caption>Owned entitlements for this account. Dates are Pacific Time.</caption>
      <thead><tr><th>Store</th><th>Product</th><th>Classification</th><th>Entitlement status</th><th>Effective access</th><th>Expiration</th></tr></thead>
      <tbody>${recordRows(detail.entitlements, false)}</tbody>
    </table></div>`;
}

function purchases(detail: LearnerDetail): string {
  if (detail.purchases.length === 0) {
    return '<p class="empty">No purchase or grant is recorded for this demonstration learner.</p>';
  }
  return `<p class="lede">Every associated record is listed. Store purchases and grants stay separate. A row without ownership is not an account-owned purchase.</p>
    <div class="table-wrap"><table>
      <caption>Purchases and grants associated with this account.</caption>
      <thead><tr><th>Store</th><th>Product</th><th>Classification</th><th>Entitlement status</th><th>Effective access</th><th>Expiration</th><th>Ownership</th></tr></thead>
      <tbody>${recordRows(detail.purchases, true)}</tbody>
    </table></div>`;
}

export async function mountLearner(root: HTMLElement): Promise<void> {
  fillSourceNote();
  const source = createDashboardSource();
  const id = new URLSearchParams(window.location.search).get('id')?.trim() ?? '';
  try {
    if (!id) {
      await paint(
        root,
        `<section class="panel"><h2>Choose a learner</h2><p class="lede">Open someone from the directory to see account, progress, and purchase records.</p><p class="panel-link"><a href="/dashboard/learners/">Go to learners</a></p></section>`,
        () => {},
      );
      return;
    }
    const detail = await source.getLearner(id);
    if (!detail) {
      await paint(
        root,
        `<section class="panel"><h2>Learner not in the demonstration set</h2><p class="lede">No synthetic learner uses the id <span class="code">${esc(id)}</span>.</p><p class="panel-link"><a href="/dashboard/learners/">Back to learners</a></p></section>`,
        () => {},
      );
      return;
    }
    document.title = `${detail.name} · Master Azerbaijani Admin`;
    const review = detail.access.purchaseReviewOpen
      ? '<p class="lede">A separate purchase is still unresolved. That review does not change this account’s premium access.</p>'
      : '';
    const html = `
      <p class="back-row"><a class="back" href="/dashboard/learners/">Back to learners</a></p>
      <section class="panel">
        <div class="detail-head">
          <div>
            <p class="eyebrow">Account</p>
            <h2>${esc(detail.name)}</h2>
            <p class="lede">${emailText(detail.email)}</p>
          </div>
          <div class="access-stack">
            ${accessPill(detail.access.access)}
            <span class="secondary">${esc(detail.access.sourceLabel)}</span>
          </div>
        </div>
        ${review}
        ${facts(detail)}
      </section>
      <section class="panel">
        <h2>Lesson and module progression</h2>
        ${progression(detail)}
      </section>
      <section class="panel">
        <h2>Recorded learning history</h2>
        ${history(detail)}
      </section>
      <section class="panel">
        <h2>Premium entitlements</h2>
        ${entitlements(detail)}
      </section>
      <section class="panel">
        <h2>Purchases and grants</h2>
        ${purchases(detail)}
      </section>
    `;
    await paint(root, html, () => {});
  } catch (error) {
    console.error(error);
    await showFailure(root);
  }
}
