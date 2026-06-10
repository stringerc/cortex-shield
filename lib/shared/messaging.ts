/**
 * CortexShield — Message Protocol Utilities
 *
 * Type-safe messaging between content scripts, background service worker,
 * popup, and options page. No magic strings. No guesswork.
 */

import type {
  ContentToBackgroundMessage,
  BackgroundToContentMessage,
  PopupToBackgroundMessage,
} from './types';

// ═══════════════════════════════════════════════════════════════
// BACKGROUND ↔ CONTENT
// ═══════════════════════════════════════════════════════════════

/** Send a message from content script to background service worker */
export async function sendToBackground<T = unknown>(
  message: ContentToBackgroundMessage,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

/** Send a message from background to a specific content script tab */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: BackgroundToContentMessage,
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

/** Send a message from background to all tabs */
export async function broadcastToAllTabs(
  message: BackgroundToContentMessage,
): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const results = await Promise.allSettled(
    tabs
      .filter((tab) => tab.id != null && tab.url != null)
      .map((tab) => chrome.tabs.sendMessage(tab.id!, message)),
  );
  // Log failures in debug mode only
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0 && (globalThis as any).__CORTEX_SHIELD_DEBUG__) {
    console.warn('[CortexShield] Broadcast partial failure:', failed.length, 'tabs failed');
  }
}

// ═══════════════════════════════════════════════════════════════
// POPUP ↔ BACKGROUND
// ═══════════════════════════════════════════════════════════════

/** Send a message from popup to background service worker */
export async function sendFromPopup<T = unknown>(
  message: PopupToBackgroundMessage,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE LISTENERS (type-safe)
// ═══════════════════════════════════════════════════════════════

/** Listen for content script messages in the background service worker */
export function onContentMessage(
  handler: (
    message: ContentToBackgroundMessage,
    sender: chrome.runtime.MessageSender,
  ) => Promise<unknown> | unknown,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isContentMessage(message)) {
      const result = handler(message, sender);
      if (result instanceof Promise) {
        result.then(sendResponse).catch((err) => {
          console.error('[CortexShield] Message handler error:', err);
          sendResponse({ error: err.message });
        });
        return true; // Keep channel open for async response
      }
      sendResponse(result);
    }
  });
}

/** Listen for popup messages in the background service worker */
export function onPopupMessage(
  handler: (
    message: PopupToBackgroundMessage,
    sender: chrome.runtime.MessageSender,
  ) => Promise<unknown> | unknown,
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isPopupMessage(message)) {
      const result = handler(message, sender);
      if (result instanceof Promise) {
        result.then(sendResponse).catch((err) => {
          console.error('[CortexShield] Popup message handler error:', err);
          sendResponse({ error: err.message });
        });
        return true;
      }
      sendResponse(result);
    }
  });
}

/** Listen for background messages in the content script */
export function onBackgroundMessage(
  handler: (message: BackgroundToContentMessage) => void,
): void {
  chrome.runtime.onMessage.addListener((message) => {
    if (isBackgroundMessage(message)) {
      handler(message);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// TYPE GUARDS — Prevents cross-talk between message channels
// ═══════════════════════════════════════════════════════════════

const CONTENT_MESSAGE_TYPES = new Set([
  'DETECTION_RESULT',
  'REQUEST_SETTINGS',
  'REQUEST_SITE_POLICY',
  'USER_ACTION',
  'REQUEST_STATS',
  'PAGE_SCANNED',
  'ANOMALY_DETECTED',
]);

const POPUP_MESSAGE_TYPES = new Set([
  'GET_CURRENT_TAB_STATE',
  'SET_MODE',
  'SET_SITE_MODE',
  'TOGGLE_CATEGORY',
  'TOGGLE_SITE_CATEGORY',
  'USER_OVERRIDE',
  'GET_SETTINGS',
  'GET_STATS',
  'RESET_STATS',
  'TOGGLE_ENABLED',
  'ADD_CUSTOM_RULE',
  'REMOVE_CUSTOM_RULE',
  'EXPORT_SETTINGS',
  'IMPORT_SETTINGS',
]);

const BACKGROUND_MESSAGE_TYPES = new Set([
  'SETTINGS_UPDATE',
  'SITE_POLICY_UPDATE',
  'BLOCK_ELEMENT',
  'UNBLOCK_ELEMENT',
  'MODE_CHANGE',
  'CATEGORY_TOGGLE',
]);

function isContentMessage(msg: any): msg is ContentToBackgroundMessage {
  return msg && typeof msg.type === 'string' && CONTENT_MESSAGE_TYPES.has(msg.type);
}

function isPopupMessage(msg: any): msg is PopupToBackgroundMessage {
  return msg && typeof msg.type === 'string' && POPUP_MESSAGE_TYPES.has(msg.type);
}

function isBackgroundMessage(msg: any): msg is BackgroundToContentMessage {
  return msg && typeof msg.type === 'string' && BACKGROUND_MESSAGE_TYPES.has(msg.type);
}
