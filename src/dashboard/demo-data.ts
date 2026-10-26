/**
 * Synthetic records for the local dashboard preview.
 * Identifiers are prefixed with demo- and emails use example.com.
 * Do not replace this module with a production export.
 */

import type {
  EntitlementStatus,
  GrantType,
  LessonCompletion,
  OwnershipState,
  ProductPlan,
  RecordKind,
  StorePaymentClass,
  StorePlatform,
} from './types';

export const DEMO_AS_OF = '2026-10-25T19:00:00.000Z';

export const DEMO_CURRICULUM_LABEL = 'Demonstration curriculum';

export const CATALOG: { moduleTitle: string; lessons: string[] }[] = [
  {
    moduleTitle: 'First conversations',
    lessons: [
      'Saying hello',
      'Introducing yourself',
      'Please and thank you',
      'Asking how someone is',
    ],
  },
  {
    moduleTitle: 'Family and home',
    lessons: ['Family words', 'At home', 'Daily routines', 'Offering tea'],
  },
  {
    moduleTitle: 'Out in the city',
    lessons: [
      'Ordering tea',
      'Asking for directions',
      'At the market',
      'Numbers and prices',
    ],
  },
  {
    moduleTitle: 'Sound and practice',
    lessons: ['Vowel practice', 'Common suffixes'],
  },
];

const LESSONS = CATALOG.flatMap((module) =>
  module.lessons.map((lessonTitle) => ({
    lessonTitle,
    moduleTitle: module.moduleTitle,
  })),
);

export interface DemoLearner {
  id: string;
  name: string;
  email: string;
  signedUpAt: string;
  lastSignInAt: string | null;
  completions: LessonCompletion[];
}

export interface DemoPurchase {
  id: string;
  learnerId: string | null;
  kind: RecordKind;
  platform: StorePlatform;
  plan: ProductPlan | null;
  paymentClass: StorePaymentClass | null;
  grantType: GrantType | null;
  entitlementStatus: EntitlementStatus;
  expiresAt: string | null;
  expiresKnown: boolean;
  ownership: OwnershipState;
  recordedAt: string;
  note: string;
}

function at(day: string, hours = 18, minutes = 0): string {
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${day}T${hh}:${mm}:00.000Z`;
}

function completions(count: number, lastDay: string | null): LessonCompletion[] {
  if (count === 0) return [];
  if (!lastDay) throw new Error('A completion count needs a last day.');
  if (count > LESSONS.length) throw new Error('Completion count exceeds the demonstration curriculum.');
  const last = new Date(at(lastDay));
  return LESSONS.slice(0, count).map((lesson, index) => {
    const completed = new Date(last.getTime() - (count - 1 - index) * 24 * 60 * 60 * 1000);
    return { ...lesson, completedAt: completed.toISOString() };
  });
}

function learner(
  id: string,
  name: string,
  signedUpAt: string,
  lastSignInAt: string | null,
  completedCount: number,
  lastCompletedDay: string | null,
): DemoLearner {
  const slug = name.toLowerCase().split(' ')[0];
  return {
    id,
    name,
    email: `${slug}.demo@example.com`,
    signedUpAt,
    lastSignInAt,
    completions: completions(completedCount, lastCompletedDay),
  };
}

function buildLearners(): DemoLearner[] {
  return [
    learner('demo-learner-samir', 'Samir Qureshi', at('2026-10-25', 16, 5), at('2026-10-25', 16, 20), 0, null),
    learner('demo-learner-elena', 'Elena Varga', at('2026-10-24', 15, 40), null, 0, null),
    learner('demo-learner-nora', 'Nora Ellison', at('2026-10-22', 17, 10), at('2026-10-25', 15, 5), 6, '2026-10-24'),
    learner('demo-learner-jonas', 'Jonas Keller', at('2026-10-18', 19, 25), at('2026-10-20', 18, 15), 2, '2026-10-20'),
    learner('demo-learner-owen', 'Owen Blake', at('2026-10-12', 14, 0), at('2026-10-12', 14, 30), 1, '2026-10-12'),
    learner('demo-learner-chloe', 'Chloe Nguyen', at('2026-10-08', 21, 10), at('2026-10-21', 16, 45), 0, null),
    learner('demo-learner-felix', 'Felix Moreau', at('2026-09-28', 13, 20), at('2026-10-02', 17, 5), 5, '2026-10-02'),
    learner('demo-learner-amira', 'Amira Haddad', at('2026-09-02', 12, 0), at('2026-10-19', 20, 10), 11, '2026-10-19'),
    learner('demo-learner-priya', 'Priya Raman', at('2026-08-14', 18, 30), at('2026-09-01', 15, 0), 4, '2026-08-30'),
    learner('demo-learner-mateo', 'Mateo Cruz', at('2026-07-03', 16, 15), at('2026-10-25', 17, 40), 14, '2026-10-24'),
    learner('demo-learner-hana', 'Hana Sato', at('2026-06-11', 11, 5), at('2026-08-02', 19, 0), 3, '2026-08-01'),
    learner('demo-learner-sofia', 'Sofia Berg', at('2026-05-20', 18, 45), at('2026-10-23', 14, 25), 9, '2026-10-22'),
    learner('demo-learner-yusuf', 'Yusuf Demir', at('2026-04-02', 10, 10), at('2026-07-18', 16, 0), 7, '2026-07-16'),
    learner('demo-learner-ingrid', 'Ingrid Solberg', at('2026-03-15', 15, 55), at('2026-10-11', 18, 35), 12, '2026-10-11'),
    learner('demo-learner-rita', 'Rita Okonkwo', at('2026-02-09', 20, 20), at('2026-02-11', 13, 10), 1, '2026-02-10'),
    learner('demo-learner-beatrice', 'Beatrice Cole', at('2026-01-19', 17, 0), at('2026-10-19', 21, 15), 8, '2026-10-19'),
  ];
}

function store(input: DemoPurchase): DemoPurchase {
  return input;
}

function buildPurchases(): DemoPurchase[] {
  return [
    store({
      id: 'demo-purchase-nora-monthly',
      learnerId: 'demo-learner-nora',
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'monthly',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: at('2026-11-22'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-10-22', 17, 12),
      note: 'Apple transaction. Payment type was not recorded.',
    }),
    store({
      id: 'demo-purchase-amira-annual',
      learnerId: 'demo-learner-amira',
      kind: 'store_purchase',
      platform: 'google',
      plan: 'annual',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: at('2027-09-02'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-09-02', 12, 8),
      note: 'Google Play transaction. Payment type was not recorded.',
    }),
    store({
      id: 'demo-purchase-priya-monthly',
      learnerId: 'demo-learner-priya',
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'monthly',
      paymentClass: 'paid_purchase',
      grantType: null,
      entitlementStatus: 'expired',
      expiresAt: at('2026-09-14'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-08-14', 18, 36),
      note: 'Legacy Apple record. Payment was not verified.',
    }),
    store({
      id: 'demo-purchase-mateo-lifetime',
      learnerId: 'demo-learner-mateo',
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'lifetime',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: null,
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-07-03', 16, 20),
      note: 'Apple lifetime transaction. Payment type was not recorded.',
    }),
    store({
      id: 'demo-purchase-hana-grant',
      learnerId: 'demo-learner-hana',
      kind: 'grant',
      platform: 'none',
      plan: null,
      paymentClass: null,
      grantType: 'complimentary_lifetime',
      entitlementStatus: 'active',
      expiresAt: null,
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-06-12', 15, 0),
      note: 'Manually provisioned complimentary lifetime grant. It does not claim a store redemption for this account.',
    }),
    store({
      id: 'demo-purchase-hana-unresolved',
      learnerId: 'demo-learner-hana',
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'monthly',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'none',
      expiresAt: null,
      expiresKnown: false,
      ownership: 'unresolved',
      recordedAt: at('2026-10-01', 16, 0),
      note: 'Associated with this account for review. It is not owned and does not grant premium.',
    }),
    store({
      id: 'demo-purchase-owen-unresolved',
      learnerId: 'demo-learner-owen',
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'monthly',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'none',
      expiresAt: null,
      expiresKnown: false,
      ownership: 'unresolved',
      recordedAt: at('2026-10-12', 14, 40),
      note: 'Apple transaction still in review. No premium access is granted.',
    }),
    store({
      id: 'demo-purchase-sofia-grace',
      learnerId: 'demo-learner-sofia',
      kind: 'store_purchase',
      platform: 'google',
      plan: 'annual',
      paymentClass: 'paid_purchase',
      grantType: null,
      entitlementStatus: 'grace',
      expiresAt: at('2026-10-28'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2025-10-28', 16, 0),
      note: 'Legacy Google Play record. Payment was not verified.',
    }),
    store({
      id: 'demo-purchase-yusuf-revoked',
      learnerId: 'demo-learner-yusuf',
      kind: 'store_purchase',
      platform: 'google',
      plan: 'monthly',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'revoked',
      expiresAt: at('2026-08-02'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-04-04', 11, 30),
      note: 'Google Play transaction. Payment type was not recorded.',
    }),
    store({
      id: 'demo-purchase-ingrid-grant',
      learnerId: 'demo-learner-ingrid',
      kind: 'grant',
      platform: 'none',
      plan: null,
      paymentClass: null,
      grantType: 'temporary_migration',
      entitlementStatus: 'active',
      expiresAt: at('2027-03-15'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-03-15', 16, 5),
      note: 'Temporary migration grant. This is not a store purchase.',
    }),
    store({
      id: 'demo-purchase-felix-unknown-expiry',
      learnerId: 'demo-learner-felix',
      kind: 'store_purchase',
      platform: 'google',
      plan: 'annual',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: null,
      expiresKnown: false,
      ownership: 'owned',
      recordedAt: at('2026-09-28', 13, 30),
      note: 'Google Play transaction. Payment type and renewal date were not recorded.',
    }),
    store({
      id: 'demo-purchase-beatrice-offer',
      learnerId: 'demo-learner-beatrice',
      kind: 'store_purchase',
      platform: 'google',
      plan: 'monthly',
      paymentClass: 'offer_code',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: at('2026-11-19'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-10-19', 21, 20),
      note: 'Google Play transaction. A promotional code is indicated. The redemption code is not stored.',
    }),
    store({
      id: 'demo-purchase-beatrice-migration',
      learnerId: 'demo-learner-beatrice',
      kind: 'grant',
      platform: 'none',
      plan: null,
      paymentClass: null,
      grantType: 'temporary_migration',
      entitlementStatus: 'expired',
      expiresAt: at('2026-08-01'),
      expiresKnown: true,
      ownership: 'owned',
      recordedAt: at('2026-01-20', 17, 0),
      note: 'Earlier temporary migration grant. It is expired and is separate from the store transaction.',
    }),
    store({
      id: 'demo-purchase-unowned-apple-offer',
      learnerId: null,
      kind: 'store_purchase',
      platform: 'apple',
      plan: 'monthly',
      paymentClass: 'offer_code',
      grantType: null,
      entitlementStatus: 'active',
      expiresAt: at('2026-12-01'),
      expiresKnown: true,
      ownership: 'unowned',
      recordedAt: at('2026-09-15', 18, 0),
      note: 'Apple transaction. A promotional code is indicated. No app-account owner is recorded, and the redemption code is not stored.',
    }),
    store({
      id: 'demo-purchase-unmatched',
      learnerId: null,
      kind: 'store_purchase',
      platform: 'google',
      plan: 'annual',
      paymentClass: 'unknown',
      grantType: null,
      entitlementStatus: 'none',
      expiresAt: null,
      expiresKnown: false,
      ownership: 'unresolved',
      recordedAt: at('2026-10-09', 19, 45),
      note: 'Google Play transaction could not be matched to a learner. Payment type was not recorded.',
    }),
  ];
}

export function createDemoDataset(): { learners: DemoLearner[]; purchases: DemoPurchase[] } {
  const learners = buildLearners();
  const purchases = buildPurchases();
  const ids = new Set(learners.map((item) => item.id));

  for (const item of purchases) {
    if (item.learnerId && !ids.has(item.learnerId)) {
      throw new Error(`Demonstration purchase ${item.id} points at an unknown learner.`);
    }
    if (item.ownership === 'unowned' && item.learnerId) {
      throw new Error(`Unowned record ${item.id} must not name an account.`);
    }
    if (item.ownership === 'owned' && !item.learnerId) {
      throw new Error(`Owned record ${item.id} needs an account.`);
    }
    if (item.kind === 'store_purchase') {
      if (item.platform === 'none' || !item.plan || !item.paymentClass || item.grantType) {
        throw new Error(`Store purchase ${item.id} is missing store classification.`);
      }
    }
    if (item.kind === 'grant') {
      if (item.platform !== 'none' || item.plan || item.paymentClass || !item.grantType) {
        throw new Error(`Grant ${item.id} must stay separate from store purchases.`);
      }
    }
    if (item.paymentClass === 'offer_code' && item.platform === 'none') {
      throw new Error(`Promotional-code record ${item.id} needs Apple or Google Play.`);
    }
    if (item.grantType === 'complimentary_lifetime' && item.expiresAt) {
      throw new Error(`Complimentary lifetime grant ${item.id} should not expire.`);
    }
    if (JSON.stringify(item).includes('DEMO')) {
      throw new Error(`Record ${item.id} must not invent a redemption code.`);
    }
  }

  return { learners, purchases };
}

export const demoDataset = createDemoDataset();
