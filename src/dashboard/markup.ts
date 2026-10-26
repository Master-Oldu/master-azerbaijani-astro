import { formatDate, formatDateTime } from './dates';
import {
  classificationLabel,
  entitlementLabel,
  ownershipLabel,
  planLabel,
  platformLabel,
} from './labels';
import type {
  EntitlementStatus,
  LearnerAccess,
  OwnershipState,
  PremiumAccess,
  PurchaseRecord,
} from './types';

export function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function learnerHref(id: string): string {
  return `/dashboard/learners/view/?id=${encodeURIComponent(id)}`;
}

export function emailText(email: string): string {
  const at = email.indexOf('@');
  if (at === -1) return esc(email);
  return `${esc(email.slice(0, at + 1))}<wbr>${esc(email.slice(at + 1))}`;
}

export function pill(tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info', label: string): string {
  return `<span class="pill pill-${tone}">${esc(label)}</span>`;
}

export function statusPill(status: PremiumAccess | EntitlementStatus): string {
  const tone =
    status === 'active' ? 'good' : status === 'grace' ? 'warn' : status === 'revoked' ? 'bad' : 'neutral';
  return pill(tone, status === 'none' ? 'None' : entitlementLabel(status));
}

export function accessPill(access: PremiumAccess): string {
  return statusPill(access);
}

/** Account premium access. Review state is separate and is never the access label. */
export function accessSummary(access: LearnerAccess): string {
  const review = access.purchaseReviewOpen
    ? '<span class="secondary">Purchase review open</span>'
    : '';
  return `<span class="access-stack">${accessPill(access.access)}<span class="secondary">${esc(access.sourceLabel)}</span>${review}</span>`;
}

export function ownershipPill(ownership: OwnershipState): string {
  if (ownership === 'owned') return pill('info', ownershipLabel(ownership));
  if (ownership === 'unowned') return pill('warn', ownershipLabel(ownership));
  return pill('bad', ownershipLabel(ownership));
}

export function expirationText(record: { expiresAt: string | null; expiresKnown: boolean }): string {
  if (!record.expiresKnown) return 'Unknown';
  if (!record.expiresAt) return 'Does not expire';
  return formatDate(record.expiresAt);
}

export function learnerCell(record: PurchaseRecord): string {
  if (!record.learnerId || !record.learnerName) {
    return '<span class="primary">Unowned</span><span class="secondary">No app account</span>';
  }
  return `<a href="${esc(learnerHref(record.learnerId))}">${esc(record.learnerName)}</a><span class="secondary">${emailText(record.learnerEmail ?? '')}</span>`;
}

export function planCell(record: PurchaseRecord): string {
  const product = record.productId ?? 'No store product';
  return `<span class="primary">${esc(planLabel(record.plan))}</span><span class="secondary">${esc(product)} · recorded ${esc(formatDate(record.recordedAt))}</span>`;
}

export function platformCell(record: PurchaseRecord): string {
  if (record.kind === 'grant' || record.platform === 'none') {
    return '<span class="primary nowrap">No store</span><span class="secondary">Grant</span>';
  }
  return `<span class="primary nowrap">${esc(platformLabel(record.platform))}</span>`;
}

export function classificationCell(record: PurchaseRecord): string {
  const note = record.note ? `<span class="secondary">${esc(record.note)}</span>` : '';
  return `<span class="primary">${esc(classificationLabel(record))}</span>${note}`;
}

export function pager(page: number, pageSize: number, total: number, label: string): string {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  const range = total === 0 ? '0' : start === end ? String(start) : `${start}–${end}`;
  return `
    <div class="pager">
      <p id="result-summary">Showing ${range} of ${total} ${esc(label)}</p>
      <div class="pager-buttons">
        <button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <span>Page ${page} of ${pages}</span>
        <button type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
      </div>
    </div>
  `;
}

export function signInText(iso: string | null): string {
  return iso ? formatDateTime(iso) : 'None recorded';
}

export function lessonText(title: string | null, iso: string | null): string {
  if (!title || !iso) return '<span class="muted">None recorded</span>';
  return `<span class="primary">${esc(title)}</span><span class="secondary">${esc(formatDate(iso))}</span>`;
}

export function failureMessage(): string {
  return `<div class="panel"><h2>Demonstration data could not be displayed</h2><p>The local sample source failed. Nothing was requested from Supabase.</p></div>`;
}

export function stat(label: string, value: number | string, hint: string): string {
  return `<article class="stat"><p class="stat-label">${esc(label)}</p><p class="stat-value">${esc(String(value))}</p><p class="stat-hint">${esc(hint)}</p></article>`;
}
