import { inRange, resolveRange } from './dates';
import { CATALOG, DEMO_AS_OF, DEMO_CURRICULUM_LABEL, demoDataset } from './demo-data';
import type { DemoLearner, DemoPurchase } from './demo-data';
import { classificationLabel, planLabel, platformLabel, productId, sourceLabel } from './labels';
import type {
  AccessSource,
  DashboardDataSource,
  EntitlementStatus,
  LearnerAccess,
  LearnerDetail,
  LearnerPage,
  LearnerQuery,
  LearnerSummary,
  Overview,
  PremiumAccess,
  PurchaseCounts,
  PurchasePage,
  PurchaseQuery,
  PurchaseRecord,
  ReportingQuery,
} from './types';

function compareIsoDesc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function grantsCurrentAccess(status: EntitlementStatus): boolean {
  return status === 'active' || status === 'grace';
}

function effectiveAccess(record: DemoPurchase): PremiumAccess {
  if (record.ownership !== 'owned') return 'none';
  if (record.entitlementStatus === 'none') return 'none';
  return record.entitlementStatus;
}

function sourceFor(record: DemoPurchase): AccessSource {
  if (record.grantType === 'complimentary_lifetime') return 'complimentary_lifetime';
  if (record.grantType === 'temporary_migration') return 'temporary_migration';
  if (record.platform === 'apple') return 'apple_store';
  if (record.platform === 'google') return 'google_store';
  return 'none';
}

function rollup(records: DemoPurchase[]): LearnerAccess {
  const owned = records.filter((record) => record.ownership === 'owned');
  const purchaseReviewOpen = records.some((record) => record.ownership === 'unresolved');
  const ranked = [
    owned.find((record) => record.grantType === 'complimentary_lifetime' && record.entitlementStatus === 'active'),
    owned.find((record) => record.grantType === 'temporary_migration' && grantsCurrentAccess(record.entitlementStatus)),
    owned.find((record) => record.kind === 'store_purchase' && record.entitlementStatus === 'active'),
    owned.find((record) => record.kind === 'store_purchase' && record.entitlementStatus === 'grace'),
    owned.find((record) => record.entitlementStatus === 'grace'),
    owned.find((record) => record.entitlementStatus === 'expired'),
    owned.find((record) => record.entitlementStatus === 'revoked'),
  ].find((record) => record);

  if (!ranked) {
    return {
      access: 'none',
      source: 'none',
      sourceLabel: sourceLabel('none'),
      purchaseReviewOpen,
    };
  }

  const source = sourceFor(ranked);
  return {
    access: effectiveAccess(ranked),
    source,
    sourceLabel: sourceLabel(source, ranked.plan),
    purchaseReviewOpen,
  };
}

function toSummary(learner: DemoLearner, purchases: DemoPurchase[]): LearnerSummary {
  const history = [...learner.completions].sort((a, b) => compareIsoDesc(a.completedAt, b.completedAt));
  const last = history[0] ?? null;
  return {
    id: learner.id,
    name: learner.name,
    email: learner.email,
    signedUpAt: learner.signedUpAt,
    lastSignInAt: learner.lastSignInAt,
    completedLessonCount: learner.completions.length,
    lastCompletedLessonTitle: last?.lessonTitle ?? null,
    lastCompletedLessonAt: last?.completedAt ?? null,
    access: rollup(purchases),
  };
}

function toPurchase(purchase: DemoPurchase, learners: DemoLearner[]): PurchaseRecord {
  const learner = learners.find((item) => item.id === purchase.learnerId) ?? null;
  return {
    id: purchase.id,
    learnerId: learner?.id ?? null,
    learnerName: learner?.name ?? null,
    learnerEmail: learner?.email ?? null,
    kind: purchase.kind,
    platform: purchase.platform,
    plan: purchase.plan,
    productId: purchase.plan ? productId(purchase.plan) : null,
    paymentClass: purchase.paymentClass,
    grantType: purchase.grantType,
    entitlementStatus: purchase.entitlementStatus,
    effectiveAccess: effectiveAccess(purchase),
    expiresAt: purchase.expiresAt,
    expiresKnown: purchase.expiresKnown,
    ownership: purchase.ownership,
    recordedAt: purchase.recordedAt,
    note: purchase.note,
  };
}

function paginate<T>(items: T[], page: number, pageSize: number): { page: number; pageSize: number; total: number; items: T[] } {
  const size = Math.min(50, Math.max(1, Math.floor(pageSize)));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * size;
  return { page: current, pageSize: size, total, items: items.slice(start, start + size) };
}

function countsFor(purchases: DemoPurchase[]): PurchaseCounts {
  const storeRows = purchases.filter((item) => item.kind === 'store_purchase');
  return {
    appleTransactions: storeRows.filter((item) => item.platform === 'apple').length,
    googleTransactions: storeRows.filter((item) => item.platform === 'google').length,
    offerCodeTransactions: storeRows.filter((item) => item.paymentClass === 'offer_code').length,
    unknownPaymentTransactions: storeRows.filter((item) => item.paymentClass === 'unknown').length,
    unverifiedLegacyTransactions: storeRows.filter((item) => item.paymentClass === 'paid_purchase').length,
    complimentaryLifetimeGrants: purchases.filter((item) => item.grantType === 'complimentary_lifetime').length,
    temporaryMigrationGrants: purchases.filter((item) => item.grantType === 'temporary_migration').length,
    unowned: purchases.filter((item) => item.ownership === 'unowned').length,
    unresolved: purchases.filter((item) => item.ownership === 'unresolved').length,
  };
}

function isCurrentPremium(access: LearnerAccess): boolean {
  return access.access === 'active' || access.access === 'grace';
}

export function createDemoSource(): DashboardDataSource {
  const { learners, purchases } = demoDataset;
  const purchasesFor = (learnerId: string) => purchases.filter((item) => item.learnerId === learnerId);
  const summaries = () =>
    learners
      .map((learner) => toSummary(learner, purchasesFor(learner.id)))
      .sort((a, b) => compareIsoDesc(a.signedUpAt, b.signedUpAt) || a.name.localeCompare(b.name));

  return {
    async getOverview(query: ReportingQuery): Promise<Overview> {
      const range = resolveRange(query, DEMO_AS_OF);
      const rows = summaries();
      const periodRegistrations = rows.filter((row) => inRange(row.signedUpAt, range));
      const completions = learners.flatMap((learner) =>
        learner.completions.filter((item) => inRange(item.completedAt, range)).map(() => learner.id),
      );
      const learnersInPeriod = new Set(completions);

      return {
        asOf: DEMO_AS_OF,
        range,
        totalLearners: rows.length,
        learnersWithAnyCompletion: rows.filter((row) => row.completedLessonCount > 0).length,
        premiumAccounts: rows.filter((row) => isCurrentPremium(row.access)).length,
        unresolvedPurchases: purchases.filter((item) => item.ownership === 'unresolved').length,
        unownedPurchases: purchases.filter((item) => item.ownership === 'unowned').length,
        periodRegistrations: periodRegistrations.length,
        periodRegistrationList: periodRegistrations,
        periodLearnersWithCompletions: learnersInPeriod.size,
        periodLessonsCompleted: completions.length,
      };
    },

    async listLearners(query: LearnerQuery): Promise<LearnerPage> {
      const needle = query.search.trim().toLowerCase();
      const filtered = summaries().filter((row) => {
        if (!needle) return true;
        return (
          row.name.toLowerCase().includes(needle) ||
          row.email.toLowerCase().includes(needle) ||
          row.access.sourceLabel.toLowerCase().includes(needle)
        );
      });
      const page = paginate(filtered, query.page, query.pageSize);
      return { total: page.total, page: page.page, pageSize: page.pageSize, learners: page.items };
    },

    async getLearner(id: string): Promise<LearnerDetail | null> {
      const learner = learners.find((item) => item.id === id);
      if (!learner) return null;
      const related = purchasesFor(learner.id)
        .map((item) => toPurchase(item, learners))
        .sort((a, b) => compareIsoDesc(a.recordedAt, b.recordedAt));
      const history = [...learner.completions].sort((a, b) => compareIsoDesc(a.completedAt, b.completedAt));
      const done = new Map(learner.completions.map((item) => [item.lessonTitle, item.completedAt]));

      return {
        ...toSummary(learner, purchasesFor(learner.id)),
        curriculumLabel: DEMO_CURRICULUM_LABEL,
        modules: CATALOG.map((module) => ({
          moduleTitle: module.moduleTitle,
          lessons: module.lessons.map((lessonTitle) => ({
            lessonTitle,
            completedAt: done.get(lessonTitle) ?? null,
          })),
        })),
        history,
        entitlements: related.filter((item) => item.ownership === 'owned'),
        purchases: related,
      };
    },

    async listPurchases(query: PurchaseQuery): Promise<PurchasePage> {
      const needle = query.search.trim().toLowerCase();
      const filtered = purchases.filter((item) => {
        if (query.plan !== 'all' && item.plan !== query.plan) return false;
        if (query.store === 'grant' && item.kind !== 'grant') return false;
        if ((query.store === 'apple' || query.store === 'google') && item.platform !== query.store) return false;
        if (query.classification !== 'all') {
          const matches =
            item.paymentClass === query.classification || item.grantType === query.classification;
          if (!matches) return false;
        }
        if (query.ownership !== 'all' && item.ownership !== query.ownership) return false;
        if (!needle) return true;
        const learner = learners.find((row) => row.id === item.learnerId);
        const haystack = [
          learner?.name,
          learner?.email,
          item.note,
          item.plan ? planLabel(item.plan) : 'grant',
          platformLabel(item.platform),
          item.plan ? productId(item.plan) : '',
          classificationLabel(item),
          item.ownership,
          item.entitlementStatus,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      });
      const ordered = filtered
        .map((item) => toPurchase(item, learners))
        .sort((a, b) => compareIsoDesc(a.recordedAt, b.recordedAt));
      const page = paginate(ordered, query.page, query.pageSize);
      return {
        total: page.total,
        page: page.page,
        pageSize: page.pageSize,
        purchases: page.items,
        counts: countsFor(purchases),
      };
    },
  };
}
