import type {
  AccessSource,
  EntitlementStatus,
  GrantType,
  OwnershipState,
  PremiumAccess,
  ProductPlan,
  StorePaymentClass,
  StorePlatform,
} from './types';

export function productId(plan: ProductPlan): string {
  if (plan === 'monthly') return 'master_monthly';
  if (plan === 'annual') return 'master_annual';
  return 'lifetime_access';
}

export function planLabel(plan: ProductPlan | null): string {
  if (plan === 'monthly') return 'Monthly';
  if (plan === 'annual') return 'Annual';
  if (plan === 'lifetime') return 'Lifetime';
  return 'No store product';
}

export function platformLabel(platform: StorePlatform): string {
  if (platform === 'apple') return 'Apple';
  if (platform === 'google') return 'Google Play';
  return '—';
}

export function paymentClassLabel(paymentClass: StorePaymentClass): string {
  if (paymentClass === 'offer_code') return 'Promotional code indicated';
  if (paymentClass === 'unknown') return 'Payment type unknown';
  return 'Payment type unverified (legacy)';
}

export function grantTypeLabel(grantType: GrantType): string {
  if (grantType === 'complimentary_lifetime') return 'Complimentary lifetime grant';
  return 'Temporary migration grant';
}

export function classificationLabel(record: {
  paymentClass: StorePaymentClass | null;
  grantType: GrantType | null;
}): string {
  if (record.grantType) return grantTypeLabel(record.grantType);
  if (record.paymentClass) return paymentClassLabel(record.paymentClass);
  return 'Unclassified';
}

export function ownershipLabel(ownership: OwnershipState): string {
  if (ownership === 'owned') return 'Owned';
  if (ownership === 'unowned') return 'Unowned';
  return 'Unresolved';
}

export function entitlementLabel(status: EntitlementStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'grace') return 'Grace';
  if (status === 'expired') return 'Expired';
  if (status === 'revoked') return 'Revoked';
  return 'None';
}

export function accessLabel(access: PremiumAccess): string {
  return entitlementLabel(access);
}

export function sourceLabel(source: AccessSource, plan: ProductPlan | null = null): string {
  if (source === 'complimentary_lifetime') return 'Complimentary lifetime grant';
  if (source === 'temporary_migration') return 'Temporary migration grant';
  if (source === 'apple_store') return plan ? `Apple ${planLabel(plan).toLowerCase()}` : 'Apple store entitlement';
  if (source === 'google_store') return plan ? `Google Play ${planLabel(plan).toLowerCase()}` : 'Google Play entitlement';
  return 'No premium source';
}
