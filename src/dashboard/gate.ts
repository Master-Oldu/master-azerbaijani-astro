export type DashboardScreen = 'overview' | 'learners' | 'learner' | 'purchases';

/**
 * Local `astro dev` keeps the approved synthetic preview.
 * A production build never takes this path, even if the demo flag is present.
 */
export function isLocalDemoPreview(): boolean {
  return import.meta.env.DEV && import.meta.env.PUBLIC_DASHBOARD_DEMO !== 'false';
}

export async function startDashboard(root: HTMLElement, screen: DashboardScreen): Promise<void> {
  if (isLocalDemoPreview()) {
    if (screen === 'overview') {
      const { mountOverview } = await import('./screens/overview');
      await mountOverview(root);
      return;
    }
    if (screen === 'learners') {
      const { mountLearners } = await import('./screens/learners');
      await mountLearners(root);
      return;
    }
    if (screen === 'learner') {
      const { mountLearner } = await import('./screens/learner');
      await mountLearner(root);
      return;
    }
    const { mountPurchases } = await import('./screens/purchases');
    await mountPurchases(root);
    return;
  }

  const { openAdministratorGate } = await import('./secure-gate');
  await openAdministratorGate(root, screen);
}
