/**
 * CortexShield — Shared Utilities
 *
 * Pure functions only. No side effects. No global state.
 * Every function here is tested by reasoning about its contract.
 */

import type { AICategory, ShieldMode } from './types';

/** Generate a unique ID for detection events */
export function generateId(): string {
  return `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Extract the registered domain from a full URL */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Strip www. prefix for consistent site policy matching
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return '';
  }
}

/** Clamp a number to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Compute weighted average of an array of scored values */
export function weightedAverage(
  items: Array<{ score: number; weight: number }>,
): number {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = items.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  );
  return weightedSum / totalWeight;
}

/** Count how many items in an array have score above threshold */
export function countAboveThreshold(
  items: Array<{ score: number }>,
  threshold: number,
): number {
  return items.filter((item) => item.score >= threshold).length;
}

/** Format a large number for display (1200 → "1.2K") */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Cycle through modes: ghost → sentry → guardian → ghost */
export function cycleMode(current: ShieldMode): ShieldMode {
  const modes: ShieldMode[] = ['ghost', 'sentry', 'guardian'];
  const idx = modes.indexOf(current);
  return modes[(idx + 1) % modes.length];
}

/** Get the effective mode for a site (site override or global default) */
export function getEffectiveMode(
  globalMode: ShieldMode,
  siteMode: ShieldMode | 'use-global',
): ShieldMode {
  return siteMode === 'use-global' ? globalMode : siteMode;
}

/** Determine the block action based on mode and legitimacy score */
export function decideBlockAction(
  mode: ShieldMode,
  legitimacyScore: number,
  sensitivity: number,
  category: AICategory,
  categoryEnabled: boolean,
): 'hide' | 'flag' | 'ignore' {
  if (!categoryEnabled) return 'ignore';

  // Adjust thresholds based on sensitivity (higher = more aggressive)
  const adjustedCritical = 0.25 + (1 - sensitivity) * 0.25; // 0.25-0.50
  const adjustedWarning = 0.40 + (1 - sensitivity) * 0.20; // 0.40-0.60

  switch (mode) {
    case 'ghost':
      // Ghost mode: never show UI changes, just log
      return 'ignore';

    case 'sentry':
      // Sentry mode: flag AI elements, don't block
      if (legitimacyScore < adjustedWarning) return 'flag';
      return 'ignore';

    case 'guardian':
      // Guardian mode: auto-block high-risk, flag medium-risk
      if (legitimacyScore < adjustedCritical) return 'hide';
      if (legitimacyScore < adjustedWarning) return 'flag';
      return 'ignore';
  }
}

/** Calculate detection accuracy from calibration entries */
export function calculateAccuracy(
  entries: Array<{ userAgreed: boolean }>,
): number {
  if (entries.length === 0) return 1;
  const agreed = entries.filter((e) => e.userAgreed).length;
  return agreed / entries.length;
}

/** Truncate a string for display */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/** Check if an element is visible in the viewport */
export function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  return true;
}

/** Get a stable CSS selector path for an element */
export function getElementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}
