/**
 * CortexShield — Background Service Worker
 *
 * The central nervous system. It:
 * 1. Manages global settings and site policies (chrome.storage)
 * 2. Handles messages from content scripts and popup
 * 3. Updates the toolbar badge with detection counts
 * 4. Runs the CortexShield Engine for calibration & self-repair
 * 5. Manages DNR rules for network-level AI blocking
 */

import { defineBackground } from 'wxt/sandbox';
import type {
  ContentToBackgroundMessage,
  PopupToBackgroundMessage,
  GlobalSettings,
  ShieldMode,
  AICategory,
  TabSession,
  BlockStats,
  SitePolicy,
} from '../lib/shared/types';
import { DEFAULT_SETTINGS } from '../lib/shared/types';
import { STORAGE_KEYS } from '../lib/shared/constants';
import {
  getSettings,
  setSettings,
  updateSettings,
  getStats,
  incrementStat,
  recordUserOverride,
  resetStats,
  getCalibration,
  addCalibrationEntry,
  getVectorWeights,
  setVectorWeights,
  exportAll,
  importAll,
} from '../lib/persistence/storage';
import {
  loadPolicies,
  getSitePolicy,
  setSiteMode,
  setSiteCategoryOverride,
  addCustomBlockSelector,
  removeCustomBlockSelector,
  addCustomAllowSelector,
} from '../lib/action/site-policy';
import { onContentMessage, onPopupMessage, sendToTab, broadcastToAllTabs } from '../lib/shared/messaging';
import { extractDomain } from '../lib/shared/utils';
import { checkForFilterUpdates, shouldCheckForUpdates } from '../lib/persistence/filter-updater';

// ═══════════════════════════════════════════════════════════════
// TAB SESSIONS
// ═══════════════════════════════════════════════════════════════

const tabSessions = new Map<number, TabSession>();

function getTabSession(tabId: number): TabSession {
  if (!tabSessions.has(tabId)) {
    tabSessions.set(tabId, {
      tabId,
      domain: '',
      detections: [],
      decisions: [],
      effectiveMode: 'sentry',
      blockedCount: 0,
      flaggedCount: 0,
      scanned: false,
      createdAt: Date.now(),
    });
  }
  return tabSessions.get(tabId)!;
}

function clearTabSession(tabId: number): void {
  tabSessions.delete(tabId);
}

// ═══════════════════════════════════════════════════════════════
// BADGE
// ═══════════════════════════════════════════════════════════════

async function updateBadge(tabId: number): Promise<void> {
  const session = getTabSession(tabId);
  const total = session.blockedCount + session.flaggedCount;
  const colors: Record<ShieldMode, string> = {
    ghost: '#6b7280',
    sentry: '#3b82f6',
    guardian: '#ef4444',
  };
  try {
    await chrome.action.setBadgeText({ tabId, text: total > 0 ? String(total) : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: colors[session.effectiveMode] });
  } catch { /* tab may have closed */ }
}

// ═══════════════════════════════════════════════════════════════
// SELF-REPAIR
// ═══════════════════════════════════════════════════════════════

async function runSelfRepair(): Promise<void> {
  const calibration = await getCalibration();
  if (calibration.length < 5) return;
  const recent = calibration.slice(-50);
  const agreed = recent.filter(e => e.userAgreed).length;
  const accuracy = agreed / recent.length;

  if (accuracy < 0.5) {
    const settings = await getSettings();
    const newSensitivity = Math.max(0.1, settings.sensitivity - 0.05);
    if (newSensitivity !== settings.sensitivity) {
      await updateSettings({ sensitivity: newSensitivity });
    }
  } else if (accuracy > 0.85) {
    const settings = await getSettings();
    const newSensitivity = Math.min(0.9, settings.sensitivity + 0.02);
    if (newSensitivity !== settings.sensitivity) {
      await updateSettings({ sensitivity: newSensitivity });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTENT MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleContentMessage(
  message: ContentToBackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const tabId = sender.tab?.id;
  if (!tabId) return;
  const session = getTabSession(tabId);

  switch (message.type) {
    case 'DETECTION_RESULT': {
      session.detections.push(message.data);
      const domain = session.domain || extractDomain(sender.tab?.url || '');
      await incrementStat('total', domain, message.data.category, 'detected');
      if (message.data.legitimacyScore < 0.50) {
        if (session.effectiveMode === 'guardian') {
          await incrementStat('total', domain, message.data.category, 'blocked');
          session.blockedCount++;
        } else if (session.effectiveMode === 'sentry') {
          await incrementStat('total', domain, message.data.category, 'flagged');
          session.flaggedCount++;
        }
      }
      updateBadge(tabId);
      return { status: 'ok' };
    }
    case 'REQUEST_SETTINGS':
      return await getSettings();
    case 'REQUEST_SITE_POLICY': {
      const policy = getSitePolicy(message.data.domain);
      session.domain = message.data.domain;
      const settings = await getSettings();
      session.effectiveMode = policy.mode !== 'use-global' ? policy.mode : settings.mode;
      return policy;
    }
    case 'USER_ACTION': {
      if (message.data.action === 'allow') {
        await recordUserOverride();
        await addCalibrationEntry({ gateConfidence: 0.5, userAgreed: false, category: 'chat_widget', timestamp: Date.now() });
      }
      return { status: 'ok' };
    }
    case 'REQUEST_STATS':
      return await getStats();
    case 'PAGE_SCANNED': {
      session.domain = message.data.domain;
      session.scanned = true;
      session.blockedCount = message.data.blockedCount;
      session.flaggedCount = message.data.flaggedCount;
      updateBadge(tabId);
      return { status: 'ok' };
    }
    case 'ANOMALY_DETECTED':
      return { status: 'ok' };
    case 'UPDATE_BADGE': {
      updateBadge(tabId);
      return { status: 'ok' };
    }
    default:
      return { status: 'ok' };
  }
}

// ═══════════════════════════════════════════════════════════════
// POPUP MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

async function handlePopupMessage(
  message: PopupToBackgroundMessage,
): Promise<unknown> {
  switch (message.type) {
    case 'GET_CURRENT_TAB_STATE': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      const session = getTabSession(tab.id);
      const settings = await getSettings();
      const policy = getSitePolicy(session.domain);
      return { session, settings, sitePolicy: policy, effectiveMode: session.effectiveMode, domain: session.domain };
    }
    case 'SET_MODE': {
      const settings = await updateSettings({ mode: message.data.mode });
      broadcastToAllTabs({ type: 'MODE_CHANGE', data: { mode: message.data.mode } });
      return settings;
    }
    case 'SET_SITE_MODE': {
      const policy = await setSiteMode(message.data.domain, message.data.mode);
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url && extractDomain(tab.url) === message.data.domain) {
          sendToTab(tab.id, { type: 'SITE_POLICY_UPDATE', data: policy });
        }
      }
      return policy;
    }
    case 'TOGGLE_CATEGORY': {
      const settings = await getSettings();
      settings.enabledCategories[message.data.category] = message.data.enabled;
      await setSettings(settings);
      broadcastToAllTabs({ type: 'CATEGORY_TOGGLE', data: message.data });
      return settings;
    }
    case 'TOGGLE_SITE_CATEGORY':
      return await setSiteCategoryOverride(message.data.domain, message.data.category, message.data.action);
    case 'USER_OVERRIDE': {
      const { detectionId, allow } = message.data;
      if (allow) {
        await recordUserOverride();
        await addCalibrationEntry({ gateConfidence: 0.5, userAgreed: false, category: 'chat_widget', timestamp: Date.now() });
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) sendToTab(tab.id, { type: 'UNBLOCK_ELEMENT', data: { detectionId } });
      return { status: 'ok' };
    }
    case 'GET_SETTINGS':
      return await getSettings();
    case 'GET_STATS':
      return await getStats();
    case 'RESET_STATS':
      return await resetStats();
    case 'TOGGLE_ENABLED': {
      const settings = await getSettings();
      return await updateSettings({ enabled: !settings.enabled });
    }
    case 'ADD_CUSTOM_RULE':
      return message.data.type === 'block'
        ? await addCustomBlockSelector(message.data.domain, message.data.selector)
        : await addCustomAllowSelector(message.data.domain, message.data.selector);
    case 'REMOVE_CUSTOM_RULE':
      return await removeCustomBlockSelector(message.data.domain, message.data.selector);
    case 'EXPORT_SETTINGS':
      return await exportAll();
    case 'IMPORT_SETTINGS':
      return await importAll(message.data);
    case 'CHECK_FILTER_UPDATES': {
      const { forceUpdateCheck } = await import('../lib/persistence/filter-updater');
      return await forceUpdateCheck();
    }
    default:
      return { status: 'ok' };
  }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

async function init(): Promise<void> {
  await loadPolicies();
  const settings = await getSettings();
  if (!settings) await setSettings(DEFAULT_SETTINGS);

  onContentMessage(handleContentMessage);
  onPopupMessage(handlePopupMessage);

  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      await setSettings(DEFAULT_SETTINGS);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => clearTabSession(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') clearTabSession(tabId);
  });

  chrome.alarms.create('self-repair', { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'self-repair') await runSelfRepair();
  });
}

// ═══════════════════════════════════════════════════════════════
// WXT BACKGROUND ENTRY
// ═══════════════════════════════════════════════════════════════

export default defineBackground(() => {
  void init();
});
