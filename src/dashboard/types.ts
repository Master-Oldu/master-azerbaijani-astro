/**
 * Administrative read models for the dashboard.
 *
 * Phase 1 fills these from synthetic records. A later Edge Function should
 * return the same shapes after it verifies an administrator on that request.
 * The browser must never receive a Supabase service-role key.
 *
 * Dates in queries are Pacific Time calendar days (YYYY-MM-DD). The demo
 * source resolves periods from a fixed sample clock. Production should
 * resolve them from the real current time, still displayed in Pacific Time.
 */

export type ProductPlan = 'monthly' | 'annual' | 'lifetime';

export type StorePlatform = 'apple' | 'google' | 'none';

export type RecordKind = 'store_purchase' | 'grant';

/** Store-payment classification stored by the premium backend. */
export type StorePaymentClass = 'offer_code' | 'unknown' | 'paid_purchase';

export type GrantType = 'complimentary_lifetime' | 'temporary_migration';

/** Status recorded on the purchase or grant row itself. */
export type EntitlementStatus = 'active' | 'grace' | 'expired' | 'revoked' | 'none';

export type OwnershipState = 'owned' | 'unowned' | 'unresolved';

/** Effective premium access for an account. Never "unresolved". */
export type PremiumAccess = 'active' | 'grace' | 'expired' | 'revoked' | 'none';

export type AccessSource =
  | 'none'
  | 'apple_store'
  | 'google_store'
  | 'complimentary_lifetime'
  | 'temporary_migration';

export interface LearnerAccess {
  access: PremiumAccess;
  source: AccessSource;
  sourceLabel: string;
  /** An associated purchase is still unresolved. This is not the access status. */
  purchaseReviewOpen: boolean;
}

export type DatePreset = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

export interface ReportingQuery {
  preset: DatePreset;
  /** Inclusive Pacific calendar day. Used when preset is custom. */
  startDay?: string | null;
  /** Inclusive Pacific calendar day. Used when preset is custom. */
  endDay?: string | null;
}

export interface ResolvedRange {
  preset: DatePreset;
  /** Null means all recorded history through endDay. */
  startDay: string | null;
  endDay: string;
  label: string;
  asOf: string;
  timeZone: 'America/Los_Angeles';
}

export interface LessonCompletion {
  lessonTitle: string;
  moduleTitle: string;
  completedAt: string;
}

export interface ModuleLessonProgress {
  lessonTitle: string;
  completedAt: string | null;
}

export interface ModuleProgress {
  moduleTitle: string;
  lessons: ModuleLessonProgress[];
}

export interface LearnerSummary {
  id: string;
  name: string;
  email: string;
  signedUpAt: string;
  lastSignInAt: string | null;
  completedLessonCount: number;
  lastCompletedLessonTitle: string | null;
  lastCompletedLessonAt: string | null;
  access: LearnerAccess;
}

export interface PurchaseRecord {
  id: string;
  learnerId: string | null;
  learnerName: string | null;
  learnerEmail: string | null;
  kind: RecordKind;
  platform: StorePlatform;
  plan: ProductPlan | null;
  productId: string | null;
  paymentClass: StorePaymentClass | null;
  grantType: GrantType | null;
  entitlementStatus: EntitlementStatus;
  /** None unless this owned record is what the account actually receives. */
  effectiveAccess: PremiumAccess;
  expiresAt: string | null;
  expiresKnown: boolean;
  ownership: OwnershipState;
  recordedAt: string;
  note: string;
}

export interface LearnerDetail extends LearnerSummary {
  curriculumLabel: string;
  modules: ModuleProgress[];
  history: LessonCompletion[];
  /** Owned records that can affect this account's access. */
  entitlements: PurchaseRecord[];
  /** Every purchase or grant associated with this account, including unresolved rows. */
  purchases: PurchaseRecord[];
}

export interface Overview {
  asOf: string;
  range: ResolvedRange;
  totalLearners: number;
  learnersWithAnyCompletion: number;
  premiumAccounts: number;
  unresolvedPurchases: number;
  unownedPurchases: number;
  periodRegistrations: number;
  periodRegistrationList: LearnerSummary[];
  periodLearnersWithCompletions: number;
  periodLessonsCompleted: number;
}

export interface LearnerQuery {
  search: string;
  page: number;
  pageSize: number;
}

export interface LearnerPage {
  total: number;
  page: number;
  pageSize: number;
  learners: LearnerSummary[];
}

export type StoreFilter = 'all' | 'apple' | 'google' | 'grant';

export type ClassificationFilter =
  | 'all'
  | StorePaymentClass
  | GrantType;

export interface PurchaseQuery {
  search: string;
  page: number;
  pageSize: number;
  plan: ProductPlan | 'all';
  store: StoreFilter;
  classification: ClassificationFilter;
  ownership: OwnershipState | 'all';
}

export interface PurchaseCounts {
  appleTransactions: number;
  googleTransactions: number;
  offerCodeTransactions: number;
  unknownPaymentTransactions: number;
  unverifiedLegacyTransactions: number;
  complimentaryLifetimeGrants: number;
  temporaryMigrationGrants: number;
  unowned: number;
  unresolved: number;
}

export interface PurchasePage {
  total: number;
  page: number;
  pageSize: number;
  purchases: PurchaseRecord[];
  counts: PurchaseCounts;
}

export interface DashboardDataSource {
  getOverview(query: ReportingQuery): Promise<Overview>;
  listLearners(query: LearnerQuery): Promise<LearnerPage>;
  getLearner(id: string): Promise<LearnerDetail | null>;
  listPurchases(query: PurchaseQuery): Promise<PurchasePage>;
}

/**
 * Body a future `admin-dashboard` Edge Function should accept.
 * Authorization is the function's job: verify the caller's JWT and an
 * administrator allow-list on every action. Do not send this in phase 1.
 */
export interface AdminDashboardRequest {
  action: 'session' | 'overview' | 'learners' | 'learner' | 'purchases';
  learnerId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  plan?: ProductPlan | 'all';
  store?: StoreFilter;
  classification?: ClassificationFilter;
  ownership?: OwnershipState | 'all';
  preset?: DatePreset;
  startDay?: string | null;
  endDay?: string | null;
}
