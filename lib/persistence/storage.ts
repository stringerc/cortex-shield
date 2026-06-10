/**
 * CortexShield — Storage Abstraction
 *
 * All chrome.storage access goes through this layer.
 * Provides typed get/set with defaults, change listeners, and migration.
 */

import { STORAGE_KEYS } from '../shared/constants';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { GlobalSettings, BlockStats, CalibrationEntry, SitePolicy } from '../shared/types';
import { DEFAULT_STATS } from '../shared/types';

// ═══════════════════════════════════════════════════════════════
// GENERIC GET/SET
// ═══════════════════════════════════════════════════════════════

/** Get a value from storage with type safety */
async function get<T>(key: string, defaultValue: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  if (result[key] === undefined) return defaultValue;
  try {
    return JSON.parse(result[key]) as T;
  } catch {
    return defaultValue;
  }
}

/** Set a value in storage */
async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: JSON.stringify(value) });
}

/** Remove a key from storage */
async function remove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

export async function getSettings(): Promise<GlobalSettings> {
  return get<GlobalSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
}

export async function setSettings(settings: GlobalSettings): Promise<void> {
  return set(STORAGE_KEYS.settings, settings);
}

export async function updateSettings(
  partial: Partial<GlobalSettings>,
): Promise<GlobalSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await setSettings(updated);
  return updated;
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

export async function getStats(): Promise<BlockStats> {
  return get<BlockStats>(STORAGE_KEYS.stats, DEFAULT_STATS);
}

export async function setStats(stats: BlockStats): Promise<void> {
  return set(STORAGE_KEYS.stats, stats);
}

/** Increment a stats counter atomically */
export async function incrementStat(
  path: string,
  domain: string,
  category: string,
  type: 'detected' | 'blocked' | 'flagged',
): Promise<BlockStats> {
  const stats = await getStats();
  stats.totalDetected += type === 'detected' ? 1 : 0;
  stats.totalBlocked += type === 'blocked' ? 1 : 0;
  stats.totalFlagged += type === 'flagged' ? 1 : 0;

  // Increment per-category stats
  const cat = category as keyof typeof stats.byCategory;
  if (stats.byCategory[cat]) {
    stats.byCategory[cat].detected += type === 'detected' ? 1 : 0;
    stats.byCategory[cat].blocked += type === 'blocked' ? 1 : 0;
    stats.byCategory[cat].flagged += type === 'flagged' ? 1 : 0;
  }

  // Increment per-site stats
  if (!stats.bySite[domain]) {
    stats.bySite[domain] = { detected: 0, blocked: 0, flagged: 0 };
  }
  stats.bySite[domain].detected += type === 'detected' ? 1 : 0;
  stats.bySite[domain].blocked += type === 'blocked' ? 1 : 0;
  stats.bySite[domain].flagged += type === 'flagged' ? 1 : 0;

  await setStats(stats);
  return stats;
}

/** Record a user override (user allowed a blocked element) */
export async function recordUserOverride(): Promise<BlockStats> {
  const stats = await getStats();
  stats.userOverrides += 1;
  await setStats(stats);
  return stats;
}

/** Reset all stats */
export async function resetStats(): Promise<BlockStats> {
  const fresh: BlockStats = {
    ...DEFAULT_STATS,
    lastReset: Date.now(),
  };
  await setStats(fresh);
  return fresh;
}

// ═══════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════

export async function getCalibration(): Promise<CalibrationEntry[]> {
  return get<CalibrationEntry[]>(STORAGE_KEYS.calibration, []);
}

export async function addCalibrationEntry(entry: CalibrationEntry): Promise<void> {
  const entries = await getCalibration();
  entries.push(entry);
  // Keep rolling window
  if (entries.length > 200) {
    entries.splice(0, entries.length - 200);
  }
  await set(STORAGE_KEYS.calibration, entries);
}

// ═══════════════════════════════════════════════════════════════
// VECTOR WEIGHTS (for adaptive detection)
// ═══════════════════════════════════════════════════════════════

export async function getVectorWeights(): Promise<Record<string, number>> {
  const { DEFAULT_VECTOR_WEIGHTS } = await import('../shared/constants');
  return get<Record<string, number>>(STORAGE_KEYS.vectorWeights, DEFAULT_VECTOR_WEIGHTS);
}

export async function setVectorWeights(weights: Record<string, number>): Promise<void> {
  return set(STORAGE_KEYS.vectorWeights, weights);
}

// ═══════════════════════════════════════════════════════════════
// ONBOARDING STATE
// ═══════════════════════════════════════════════════════════════

export async function isOnboardingComplete(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.onboardingComplete);
  return result[STORAGE_KEYS.onboardingComplete] === true;
}

export async function setOnboardingComplete(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.onboardingComplete]: true });
}

// ═══════════════════════════════════════════════════════════════
// EXPORT / IMPORT (full backup)
// ═══════════════════════════════════════════════════════════════

export interface FullBackup {
  version: 1;
  settings: GlobalSettings;
  sitePolicies: SitePolicy[];
  stats: BlockStats;
  calibration: CalibrationEntry[];
  vectorWeights: Record<string, number>;
  exportDate: number;
}

export async function exportAll(): Promise<string> {
  const [settings, calibration, vectorWeights] = await Promise.all([
    getSettings(),
    getCalibration(),
    getVectorWeights(),
  ]);

  const { getAllPolicies } = await import('../action/site-policy');
  const stats = await getStats();

  const backup: FullBackup = {
    version: 1,
    settings,
    sitePolicies: getAllPolicies(),
    stats,
    calibration,
    vectorWeights,
    exportDate: Date.now(),
  };

  return JSON.stringify(backup, null, 2);
}

export async function importAll(json: string): Promise<number> {
  const backup: FullBackup = JSON.parse(json);
  if (backup.version !== 1) throw new Error('Unsupported backup version');

  await Promise.all([
    setSettings(backup.settings),
    setStats(backup.stats),
    set(STORAGE_KEYS.calibration, backup.calibration),
    setVectorWeights(backup.vectorWeights),
  ]);

  return 1; // Success count
}

// ═══════════════════════════════════════════════════════════════
// CHANGE LISTENER
// ═══════════════════════════════════════════════════════════════

type StorageChangeListener = (changes: { [key: string]: chrome.storage.StorageChange }) => void;

const listeners = new Set<StorageChangeListener>();

/** Listen for storage changes (e.g., settings updated from popup) */
export function onStorageChange(listener: StorageChangeListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Wire up chrome.storage.onChanged to our listeners
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      for (const listener of Array.from(listeners)) {
        try { listener(changes); } catch { /* swallow */ }
      }
    }
  });
}
