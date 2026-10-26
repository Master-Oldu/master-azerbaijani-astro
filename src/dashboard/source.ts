/**
 * Phase 1 returns the demonstration source only.
 * `edge-source.ts` is the replacement point. It is intentionally not imported
 * here, so the preview cannot call a live function and the stub is not bundled.
 */

import { DEMO_AS_OF } from './demo-data';
import { createDemoSource } from './demo-source';
import type { DashboardDataSource } from './types';

export const PAGE_SIZE = 8;

export function getDataSourceMeta(): { kind: 'demonstration'; label: string; asOf: string } {
  return {
    kind: 'demonstration',
    label: 'Synthetic demonstration data',
    asOf: DEMO_AS_OF,
  };
}

export function createDashboardSource(): DashboardDataSource {
  if (!import.meta.env.DEV || import.meta.env.PUBLIC_DASHBOARD_DEMO === 'false') {
    throw new Error('Synthetic dashboard records are available only in the local demonstration preview.');
  }
  return createDemoSource();
}
