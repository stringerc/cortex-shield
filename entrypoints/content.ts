/**
 * CortexShield — Content Script
 *
 * Runs inside every webpage. Scans DOM for AI elements, watches
 * for dynamic injections, hooks runtime APIs, and applies
 * block/flag actions based on the current mode.
 *
 * Design principles:
 * - Never throws — errors in content script must NOT break the host page
 * - Never leaks — no global pollution, all state is scoped
 * - Never blocks — all scanning is async, never freezes the page
 * - Never tracks — zero data leaves the page except detection results
 */

import { defineContentScript } from 'wxt/sandbox';
import type {
  DetectionResult,
  DetectionVector,
  BackgroundToContentMessage,
  ShieldMode,
  AICategory,
  GlobalSettings,
  SitePolicy,
} from '../lib/shared/types';
import { generateId, extractDomain, decideBlockAction } from '../lib/shared/utils';
import { ELEMENT_RESCAN_COOLDOWN } from '../lib/shared/constants';
import { blockElement, restoreElement, getBlockedCount } from '../lib/action/element-blocker';
import { flagElement, unflagElement, unflagAllElements, getFlaggedCount } from '../lib/action/flag-marker';
import { sendToBackground, onBackgroundMessage } from '../lib/shared/messaging';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    // ═════════════════════════════════════════════════════════
    // STATE
    // ═════════════════════════════════════════════════════════

    let currentSettings: GlobalSettings | null = null;
    let currentSitePolicy: SitePolicy | null = null;
    let currentDomain = '';
    let mutationObserver: MutationObserver | null = null;
    let isScanning = false;
    let scanThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    const scannedElements = new WeakSet<Element>();
    const detectionCache = new Map<Element, DetectionResult>();

    // ═════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═════════════════════════════════════════════════════════

    async function init(): Promise<void> {
      try {
        currentDomain = extractDomain(window.location.href);

        const [settingsRes, policyRes] = await Promise.all([
          sendToBackground<GlobalSettings>({ type: 'REQUEST_SETTINGS' }),
          sendToBackground<SitePolicy>({ type: 'REQUEST_SITE_POLICY', data: { domain: currentDomain } }),
        ]);

        currentSettings = settingsRes;
        currentSitePolicy = policyRes;

        if (!currentSettings?.enabled) return;

        await scanFullPage();
        startMutationObserver();
        hookRuntimeAPIs();

        onBackgroundMessage(handleBackgroundMessage);
        document.addEventListener('cortex-shield-allow', handleAllowEvent);
        document.addEventListener('cortex-shield-block', handleBlockEvent);

        sendToBackground({
          type: 'PAGE_SCANNED',
          data: {
            domain: currentDomain,
            detectionCount: detectionCache.size,
            blockedCount: getBlockedCount(),
            flaggedCount: getFlaggedCount(),
          },
        });
      } catch (err) {
        console.error('[CortexShield] Content script init error:', err);
      }
    }

    // ═════════════════════════════════════════════════════════
    // FULL PAGE SCAN
    // ═════════════════════════════════════════════════════════

    async function scanFullPage(): Promise<void> {
      if (isScanning || !currentSettings) return;
      isScanning = true;

      try {
        const { STATIC_RULES, matchStaticRules } = await import('../lib/detection/static-rules');
        const seenElements = new Set<Element>();

        for (const rule of STATIC_RULES) {
          try {
            const matches = document.querySelectorAll(rule.selector);
            for (const element of matches) {
              if (seenElements.has(element)) continue;
              seenElements.add(element);

              const ruleMatches = matchStaticRules(element);
              if (ruleMatches.length > 0) {
                const best = ruleMatches[0]!;
                const detection: DetectionResult = {
                  id: generateId(),
                  legitimacyScore: 1 - best.rule.confidence,
                  category: best.rule.category,
                  confidence: best.rule.confidence,
                  vectors: [{
                    source: 'static',
                    score: best.rule.confidence,
                    confidence: best.rule.confidence,
                    weight: 0.35,
                    evidence: [best.rule.description],
                    timestamp: Date.now(),
                  }],
                  evidence: ruleMatches.map((m) => m.rule.description),
                  element: element as Element,
                  timestamp: Date.now(),
                };

                if (!scannedElements.has(element)) {
                  scannedElements.add(element);
                  detectionCache.set(element, detection);
                  await processDetection(detection);
                }
              }
            }
          } catch { /* Invalid selector */ }
        }
      } catch (err) {
        console.error('[CortexShield] Scan error:', err);
      } finally {
        isScanning = false;
      }
    }

    // ═════════════════════════════════════════════════════════
    // MUTATION OBSERVER
    // ═════════════════════════════════════════════════════════

    function startMutationObserver(): void {
      if (mutationObserver) return;

      mutationObserver = new MutationObserver((mutations) => {
        if (scanThrottleTimer) return;

        let hasNewElements = false;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element && !scannedElements.has(node)) {
              hasNewElements = true;
              break;
            }
          }
          if (hasNewElements) break;
        }

        if (hasNewElements) {
          scanThrottleTimer = setTimeout(() => {
            scanThrottleTimer = null;
            scanFullPage();
          }, ELEMENT_RESCAN_COOLDOWN);
        }
      });

      mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopMutationObserver(): void {
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
    }

    // ═════════════════════════════════════════════════════════
    // RUNTIME API HOOKS
    // ═════════════════════════════════════════════════════════

    function hookRuntimeAPIs(): void {
      // Hook window.ai
      try {
        if ('ai' in window) {
          const originalAi = (window as any).ai;
          Object.defineProperty(window, 'ai', {
            get() {
              sendToBackground({
                type: 'ANOMALY_DETECTED',
                data: { description: 'window.ai accessed', anomalyScore: 0.9, likelyCategory: 'content_injector' as AICategory, signals: ['window.ai.accessed'], timestamp: Date.now() },
              });
              return originalAi;
            },
            configurable: true,
          });
        }
      } catch { /* Best effort */ }

      // Hook fetch for AI endpoints
      try {
        const originalFetch = window.fetch;
        window.fetch = function (...args: any[]) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] as any)?.url;
          if (url && isAIFetchEndpoint(url)) {
            sendToBackground({
              type: 'ANOMALY_DETECTED',
              data: { description: `AI fetch: ${url}`, anomalyScore: 0.7, likelyCategory: 'tracker' as AICategory, signals: [`fetch:${url}`], timestamp: Date.now() },
            });
          }
          return originalFetch.apply(this, args);
        };
      } catch { /* Best effort */ }

      // Hook WebSocket for AI streaming
      try {
        const OriginalWS = window.WebSocket;
        (window as any).WebSocket = function (url: string, protocols?: any) {
          if (isAIWebSocketURL(url)) {
            sendToBackground({
              type: 'ANOMALY_DETECTED',
              data: { description: `AI WebSocket: ${url}`, anomalyScore: 0.8, likelyCategory: 'chat_widget' as AICategory, signals: [`ws:${url}`], timestamp: Date.now() },
            });
          }
          return new OriginalWS(url, protocols);
        };
        Object.assign((window as any).WebSocket, OriginalWS);
        (window as any).WebSocket.prototype = OriginalWS.prototype;
      } catch { /* Best effort */ }
    }

    function isAIFetchEndpoint(url: string): boolean {
      const patterns = ['/v1/chat/completions', '/v1/completions', '/v1/generate', '/api/chat', '/api/ai', '/v1/messages', '/v1/responses'];
      try {
        const pathname = new URL(url, window.location.origin).pathname;
        return patterns.some((p) => pathname.includes(p));
      } catch { return false; }
    }

    function isAIWebSocketURL(url: string): boolean {
      const indicators = ['wss://api.openai.com', 'wss://cdn.mosaicagent.com', 'wss://embed.chatgpt.com', '/ws/chat', '/cable'];
      return indicators.some((ind) => url.includes(ind));
    }

    // ═════════════════════════════════════════════════════════
    // DETECTION PROCESSING
    // ═════════════════════════════════════════════════════════

    async function processDetection(detection: DetectionResult): Promise<void> {
      if (!currentSettings || !detection.element) return;

      const mode = getEffectiveMode();
      const categoryEnabled = isCategoryEnabled(detection.category);
      const action = decideBlockAction(mode, detection.legitimacyScore, currentSettings.sensitivity, detection.category, categoryEnabled);

      switch (action) {
        case 'hide': blockElement(detection); break;
        case 'flag': flagElement(detection); break;
        case 'ignore': break;
      }

      sendToBackground({ type: 'DETECTION_RESULT', data: detection });
      updateBadge();
    }

    function getEffectiveMode(): ShieldMode {
      if (!currentSettings) return 'sentry';
      if (currentSitePolicy && currentSitePolicy.mode !== 'use-global') return currentSitePolicy.mode;
      return currentSettings.mode;
    }

    function isCategoryEnabled(category: AICategory): boolean {
      if (!currentSettings) return true;
      if (currentSitePolicy?.categoryOverrides[category] === 'allow') return true;
      if (currentSitePolicy?.categoryOverrides[category] === 'block') return false;
      return currentSettings.enabledCategories[category] ?? true;
    }

    function updateBadge(): void {
      const blocked = getBlockedCount();
      const flagged = getFlaggedCount();
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', data: { count: blocked + flagged, blocked, flagged } }).catch(() => {});
    }

    // ═════════════════════════════════════════════════════════
    // BACKGROUND MESSAGE HANDLER
    // ═════════════════════════════════════════════════════════

    function handleBackgroundMessage(message: BackgroundToContentMessage): void {
      switch (message.type) {
        case 'SETTINGS_UPDATE':
          currentSettings = message.data;
          rescanWithNewSettings();
          break;
        case 'SITE_POLICY_UPDATE':
          if (message.data.domain === currentDomain) { currentSitePolicy = message.data; rescanWithNewSettings(); }
          break;
        case 'MODE_CHANGE':
          if (currentSettings) { currentSettings.mode = message.data.mode; rescanWithNewSettings(); }
          break;
        case 'CATEGORY_TOGGLE':
          if (currentSettings) { currentSettings.enabledCategories[message.data.category] = message.data.enabled; rescanWithNewSettings(); }
          break;
        case 'BLOCK_ELEMENT':
          for (const [, detection] of detectionCache.entries()) {
            if (detection.id === message.data.detectionId) {
              if (message.data.action === 'hide') blockElement(detection);
              else if (message.data.action === 'flag') flagElement(detection);
              break;
            }
          }
          updateBadge();
          break;
        case 'UNBLOCK_ELEMENT':
          restoreElement(message.data.detectionId);
          updateBadge();
          break;
      }
    }

    async function rescanWithNewSettings(): Promise<void> {
      unflagAllElements();
      for (const detection of detectionCache.values()) {
        if (detection.element) await processDetection(detection);
      }
    }

    // ═════════════════════════════════════════════════════════
    // CUSTOM EVENT HANDLERS
    // ═════════════════════════════════════════════════════════

    function handleAllowEvent(e: Event): void {
      const { detectionId } = (e as CustomEvent).detail;
      sendToBackground({ type: 'USER_ACTION', data: { detectionId, action: 'allow' } });
      restoreElement(detectionId);
      updateBadge();
    }

    function handleBlockEvent(e: Event): void {
      const { detectionId } = (e as CustomEvent).detail;
      unflagElement(detectionId);
      for (const [, detection] of detectionCache.entries()) {
        if (detection.id === detectionId) { blockElement(detection); break; }
      }
      sendToBackground({ type: 'USER_ACTION', data: { detectionId, action: 'block' } });
      updateBadge();
    }

    // ═════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

    window.addEventListener('unload', () => {
      stopMutationObserver();
      document.removeEventListener('cortex-shield-allow', handleAllowEvent);
      document.removeEventListener('cortex-shield-block', handleBlockEvent);
    });
  },
});
