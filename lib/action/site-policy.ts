/**
 * CortexShield — Site Policy Manager
 *
 * Manages per-site overrides: mode, category blocking, custom selectors.
 * Policies persist in chrome.storage via the persistence layer.
 */

import type { AICategory, ShieldMode, SitePolicy, GlobalSettings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { getEffectiveMode, decideBlockAction } from '../shared/utils';

/** In-memory policy cache — loaded from storage on init */
let policyCache = new Map<string, SitePolicy>();

/** Load policies from storage into the in-memory cache */
export async function loadPolicies(): Promise<void> {
  const result = await chrome.storage.local.get('cortex_shield_site_policies');
  if (result.cortex_shield_site_policies) {
    const policies: SitePolicy[] = JSON.parse(result.cortex_shield_site_policies);
    policyCache.clear();
    for (const policy of policies) {
      policyCache.set(policy.domain, policy);
    }
  }
}

/** Save all policies to storage */
async function savePolicies(): Promise<void> {
  const policies = Array.from(policyCache.values());
  await chrome.storage.local.set({
    cortex_shield_site_policies: JSON.stringify(policies),
  });
}

/** Get the policy for a domain (or create default) */
export function getSitePolicy(domain: string): SitePolicy {
  const existing = policyCache.get(domain);
  if (existing) return { ...existing };

  return {
    domain,
    mode: 'use-global',
    categoryOverrides: {},
    customBlockSelectors: [],
    customAllowSelectors: [],
    customBlockDomains: [],
    lastUpdated: Date.now(),
  };
}

/** Set the mode override for a specific site */
export async function setSiteMode(
  domain: string,
  mode: ShieldMode | 'use-global',
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  policy.mode = mode;
  policy.lastUpdated = Date.now();
  policyCache.set(domain, policy);
  await savePolicies();
  return policy;
}

/** Set a category override for a specific site */
export async function setSiteCategoryOverride(
  domain: string,
  category: AICategory,
  action: 'allow' | 'block' | 'default',
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  policy.categoryOverrides[category] = action;
  policy.lastUpdated = Date.now();
  policyCache.set(domain, policy);
  await savePolicies();
  return policy;
}

/** Add a custom block selector for a site */
export async function addCustomBlockSelector(
  domain: string,
  selector: string,
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  if (!policy.customBlockSelectors.includes(selector)) {
    policy.customBlockSelectors.push(selector);
    policy.lastUpdated = Date.now();
    policyCache.set(domain, policy);
    await savePolicies();
  }
  return policy;
}

/** Remove a custom block selector for a site */
export async function removeCustomBlockSelector(
  domain: string,
  selector: string,
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  policy.customBlockSelectors = policy.customBlockSelectors.filter(
    (s) => s !== selector,
  );
  policy.lastUpdated = Date.now();
  policyCache.set(domain, policy);
  await savePolicies();
  return policy;
}

/** Add a custom allow selector for a site */
export async function addCustomAllowSelector(
  domain: string,
  selector: string,
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  if (!policy.customAllowSelectors.includes(selector)) {
    policy.customAllowSelectors.push(selector);
    policy.lastUpdated = Date.now();
    policyCache.set(domain, policy);
    await savePolicies();
  }
  return policy;
}

/** Add a custom block domain for a site */
export async function addCustomBlockDomain(
  domain: string,
  blockDomain: string,
): Promise<SitePolicy> {
  const policy = getSitePolicy(domain);
  if (!policy.customBlockDomains.includes(blockDomain)) {
    policy.customBlockDomains.push(blockDomain);
    policy.lastUpdated = Date.now();
    policyCache.set(domain, policy);
    await savePolicies();
  }
  return policy;
}

/** Remove a site policy entirely */
export async function removeSitePolicy(domain: string): Promise<void> {
  policyCache.delete(domain);
  await savePolicies();
}

/** Get all site policies */
export function getAllPolicies(): SitePolicy[] {
  return Array.from(policyCache.values());
}

/** Check if a category should be allowed on a specific site, overriding global */
export function shouldAllowCategory(
  domain: string,
  category: AICategory,
  globalEnabled: boolean,
): boolean {
  const policy = policyCache.get(domain);
  if (!policy) return globalEnabled;

  const override = policy.categoryOverrides[category];
  if (override === 'allow') return true;
  if (override === 'block') return false;

  return globalEnabled;
}

/** Check if a CSS selector should be allowed on a specific site */
export function shouldAllowSelector(
  domain: string,
  selector: string,
): boolean {
  const policy = policyCache.get(domain);
  if (!policy) return false;

  return policy.customAllowSelectors.includes(selector);
}

/** Get the effective mode for a site */
export function getSiteEffectiveMode(
  domain: string,
  globalMode: ShieldMode,
): ShieldMode {
  const policy = policyCache.get(domain);
  if (!policy) return globalMode;
  return getEffectiveMode(globalMode, policy.mode);
}

/** Export all policies as JSON (for backup) */
export function exportPolicies(): string {
  return JSON.stringify(Array.from(policyCache.values()), null, 2);
}

/** Import policies from JSON (overwrites existing) */
export async function importPolicies(json: string): Promise<number> {
  const policies: SitePolicy[] = JSON.parse(json);
  policyCache.clear();
  for (const policy of policies) {
    policyCache.set(policy.domain, policy);
  }
  await savePolicies();
  return policies.length;
}
