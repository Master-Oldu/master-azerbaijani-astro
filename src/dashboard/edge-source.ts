/**
 * Replacement point for live administrative data. Not imported by the pages,
 * so this phase cannot call Supabase and this file is not shipped to the browser.
 *
 * When a later phase connects data:
 * 1. Add an Edge Function, for example `admin-dashboard`.
 * 2. On every action, verify the caller JWT and an administrator allow-list.
 *    Reject everyone else. A secret URL is not authorization.
 * 3. Use the service-role key only inside that function. Never put it in
 *    browser code, `PUBLIC_` variables, or this module.
 * 4. Return the same objects as `DashboardDataSource`. Map auth users,
 *    profiles, and lesson progress into learners. Map purchase and grant
 *    rows into purchases. Do not query private tables from the browser.
 * 5. Switch `createDashboardSource()` to this source and stop importing
 *    `demo-data` from client pages. Delete the synthetic records from the
 *    bundle before any real response is shown.
 *
 * Proposed request body: `AdminDashboardRequest` in `types.ts`.
 * Proposed responses: `Overview`, `LearnerPage`, `LearnerDetail`, `PurchasePage`.
 */

import type {
  AdminDashboardRequest,
  DashboardDataSource,
  LearnerDetail,
  LearnerPage,
  LearnerQuery,
  Overview,
  PurchasePage,
  PurchaseQuery,
  ReportingQuery,
} from './types';

export const ADMIN_DASHBOARD_FUNCTION = 'admin-dashboard';

const NOT_CONNECTED =
  'Live administrative data is not connected. This phase serves synthetic demonstration data only.';

function unavailable(): Promise<never> {
  return Promise.reject(new Error(NOT_CONNECTED));
}

export function createEdgeSource(): DashboardDataSource {
  return {
    getOverview(_query: ReportingQuery): Promise<Overview> {
      return unavailable();
    },
    listLearners(_query: LearnerQuery): Promise<LearnerPage> {
      return unavailable();
    },
    getLearner(_id: string): Promise<LearnerDetail | null> {
      return unavailable();
    },
    listPurchases(_query: PurchaseQuery): Promise<PurchasePage> {
      return unavailable();
    },
  };
}

/** Documents the future call. It does not perform a request. */
export function describeAdminRequest(request: AdminDashboardRequest): string {
  return `${ADMIN_DASHBOARD_FUNCTION}:${request.action}`;
}
