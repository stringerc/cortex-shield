/**
 * CortexShield — Filter List Auto-Updater
 *
 * Fetches updated filter lists from GitHub Pages every 24 hours.
 * Compares version hashes to avoid unnecessary downloads.
 * Falls back to built-in rules if fetch fails.
 *
 * URLs:
 * - versions.json → tiny manifest with hashes/counts
 * - ai-chat-widgets.txt, etc. → EasyList-format filter rules
 *
 * Base URL: https://stringerc.github.io/cortex-shield/filters/
 */

import type { AICategory } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';

const FILTER_BASE_URL = 'https://stringerc.github.io/cortex-shield/filters/';
const VERSIONS_URL = `${FILTER_BASE_URL}versions.json`;

const FILTER_CATEGORIES: AICategory[] = [
  'chat_widget',
  'search_overlay',
  'content_injector',
  'social_feature',
  'popup',
  'tracker',
];

// Map category to filename
const CATEGORY_FILE_MAP: Record<AICategory, string> = {
  chat_widget: 'ai-chat-widgets',
  search_overlay: 'ai-search-overlays',
  content_injector: 'ai-content-injectors',
  social_feature: 'ai-social-features',
  popup: 'ai-popups',
  tracker: 'ai-trackers',
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface FilterListMeta {
  url: string;
  version: string;
  count: number;
  updated: string;
}

interface VersionsManifest {
  lastUpdated: string;
  lists: Record<string, FilterListMeta>;
}

interface CachedFilterList {
  category: AICategory;
  version: string;
  rules: string[];
  fetchedAt: number;
}

interface UpdateResult {
  updated: AICategory[];
  unchanged: AICategory[];
  failed: AICategory[];
  lastChecked: number;
}

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

async function getCachedFilters(): Promise<Record<string, CachedFilterList>> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_CACHE);
  return (result[STORAGE_KEYS.FILTER_CACHE] as Record<string, CachedFilterList>) ?? {};
}

async function setCachedFilters(cache: Record<string, CachedFilterList>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.FILTER_CACHE]: cache });
}

async function getLastCheckTime(): Promise<number> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_LAST_CHECK);
  return (result[STORAGE_KEYS.FILTER_LAST_CHECK] as number) ?? 0;
}

async function setLastCheckTime(time: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.FILTER_LAST_CHECK]: time });
}

// ═══════════════════════════════════════════════════════════════
// FETCHING
// ═══════════════════════════════════════════════════════════════

async function fetchVersionsManifest(): Promise<VersionsManifest | null> {
  try {
    const response = await fetch(VERSIONS_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    return await response.json() as VersionsManifest;
  } catch {
    return null;
  }
}

async function fetchFilterList(fileName: string): Promise<string[] | null> {
  try {
    const url = `${FILTER_BASE_URL}${fileName}.txt`;
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return null;
    const text = await response.text();

    // Parse EasyList-format rules (skip comments)
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('!'));
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN UPDATE CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check for filter list updates and download any changed lists.
 *
 * Strategy:
 * 1. Fetch versions.json (tiny — ~500 bytes)
 * 2. Compare each list's version against cached version
 * 3. Only download full filter lists for categories that changed
 * 4. Store updated rules in chrome.storage
 * 5. Return summary of what changed
 */
export async function checkForFilterUpdates(): Promise<UpdateResult> {
  const result: UpdateResult = {
    updated: [],
    unchanged: [],
    failed: [],
    lastChecked: Date.now(),
  };

  // Fetch the versions manifest
  const manifest = await fetchVersionsManifest();
  if (!manifest) {
    // Can't reach GitHub — all categories fail
    result.failed = [...FILTER_CATEGORIES];
    result.lastChecked = Date.now();
    await setLastCheckTime(result.lastChecked);
    return result;
  }

  // Get currently cached filters
  const cached = await getCachedFilters();

  // Check each category
  for (const category of FILTER_CATEGORIES) {
    const fileKey = CATEGORY_FILE_MAP[category];
    const remoteMeta = manifest.lists[fileKey];

    if (!remoteMeta) {
      result.unchanged.push(category);
      continue;
    }

    const localCache = cached[fileKey];
    const localVersion = localCache?.version ?? '0.0.0';

    // Compare versions
    if (localVersion === remoteMeta.version) {
      result.unchanged.push(category);
      continue;
    }

    // Version changed — download the new rules
    const rules = await fetchFilterList(fileKey);
    if (rules) {
      cached[fileKey] = {
        category,
        version: remoteMeta.version,
        rules,
        fetchedAt: Date.now(),
      };
      result.updated.push(category);
    } else {
      result.failed.push(category);
    }
  }

  // Persist updated cache and check time
  await setCachedFilters(cached);
  await setLastCheckTime(result.lastChecked);

  return result;
}

/**
 * Get parsed filter rules for a category.
 * Returns the cached remote rules if available, otherwise null
 * (caller should fall back to built-in static rules).
 */
export async function getRemoteFilterRules(category: AICategory): Promise<string[] | null> {
  const cached = await getCachedFilters();
  const fileKey = CATEGORY_FILE_MAP[category];
  return cached[fileKey]?.rules ?? null;
}

/**
 * Check if enough time has passed since the last update check.
 * Returns true if 24+ hours have passed.
 */
export async function shouldCheckForUpdates(): Promise<boolean> {
  const lastCheck = await getLastCheckTime();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  return Date.now() - lastCheck >= TWENTY_FOUR_HOURS;
}

/**
 * Force an immediate update check regardless of timing.
 */
export async function forceUpdateCheck(): Promise<UpdateResult> {
  return checkForFilterUpdates();
}
