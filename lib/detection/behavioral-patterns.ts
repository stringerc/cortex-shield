/**
 * CortexShield — Behavioral Patterns
 *
 * Detects AI by its behavioral signatures rather than static patterns.
 * Catches things that look, move, and act like AI even if we have
 * no explicit rule for them.
 *
 * Signals: streaming text timing, WebSocket message patterns,
 * DOM mutation bursts, script loading sequences, and AI-typical
 * user interaction patterns (auto-scroll, typing indicators, etc).
 */

import type { AICategory, DetectionVector } from '../shared/types';
import {
  DEFAULT_VECTOR_WEIGHTS,
  AI_STREAM_INTERVAL_MIN,
  AI_STREAM_INTERVAL_MAX,
  AI_STREAM_PATTERN_MIN_LENGTH,
  AI_WEBSOCKET_MESSAGE_SIZE_MIN,
  AI_WEBSOCKET_MESSAGE_SIZE_MAX,
  AI_WIDGET_MUTATION_BURST,
} from '../shared/constants';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** A single behavioral signal observed on a page */
export interface BehavioralSignal {
  /** The type of signal observed */
  type: 'streaming_text' | 'websocket_pattern' | 'mutation_burst' | 'script_loading' | 'interaction';
  /** When this signal was observed */
  timestamp: number;
  /** The score (0-1) indicating how AI-like this signal is */
  score: number;
  /** Human-readable description of what was observed */
  description: string;
  /** The AI category this signal most likely belongs to */
  likelyCategory: AICategory;
  /** Additional data specific to the signal type */
  data?: Record<string, unknown>;
}

/** Streaming text timing observation */
export interface StreamingTextSignal extends BehavioralSignal {
  type: 'streaming_text';
  data: {
    /** The DOM element whose text was streaming */
    elementSelector: string;
    /** Intervals between text updates (ms) */
    intervals: number[];
    /** Average interval between updates */
    averageInterval: number;
    /** Number of text chunks observed */
    chunkCount: number;
  };
}

/** WebSocket message pattern observation */
export interface WebSocketPatternSignal extends BehavioralSignal {
  type: 'websocket_pattern';
  data: {
    /** The WebSocket URL */
    url: string;
    /** Number of messages observed */
    messageCount: number;
    /** Average message size (bytes) */
    averageSize: number;
    /** Whether the pattern matches AI chat API shapes */
    matchesChatAPI: boolean;
  };
}

/** DOM mutation burst observation */
export interface MutationBurstSignal extends BehavioralSignal {
  type: 'mutation_burst';
  data: {
    /** Number of mutations in the burst */
    mutationCount: number;
    /** Duration of the burst (ms) */
    burstDuration: number;
    /** The parent element where mutations occurred */
    parentSelector: string;
    /** Types of mutations (childList, attributes, characterData) */
    mutationTypes: string[];
  };
}

/** Script loading pattern observation */
export interface ScriptLoadingSignal extends BehavioralSignal {
  type: 'script_loading';
  data: {
    /** URL of the script that was loaded */
    scriptUrl: string;
    /** Delay between page load and script injection (ms) */
    injectionDelay: number;
    /** Whether the script was dynamically created (not in original HTML) */
    dynamicallyCreated: boolean;
  };
}

/** User interaction pattern observation */
export interface InteractionSignal extends BehavioralSignal {
  type: 'interaction';
  data: {
    /** Type of interaction detected */
    interactionType: 'auto_scroll' | 'typing_indicator' | 'ai_response_expand' | 'chat_open';
    /** The element the interaction occurred on */
    elementSelector: string;
  };
}

/** Result of analyzing a collection of behavioral signals */
export interface BehavioralAnalysisResult {
  /** Overall AI likelihood score (0-1, higher = more likely AI) */
  score: number;
  /** Most likely AI category */
  category: AICategory;
  /** The detection vector to feed into the scoring engine */
  vector: DetectionVector;
}

// ═══════════════════════════════════════════════════════════════
// STREAMING TEXT TIMING ANALYSIS
// ═══════════════════════════════════════════════════════════════

/**
 * Watch an element for streaming text that matches AI token output.
 *
 * Sets up a MutationObserver on the element and records timestamps
 * of each text content change. When enough consecutive changes happen
 * at AI-typical intervals (20-200ms), produces a BehavioralSignal.
 *
 * @param element - The DOM element to watch
 * @returns Object with stop() method and signals accessor
 */
export function watchStreamingText(element: Element): {
  stop: () => void;
  getSignals: () => StreamingTextSignal[];
} {
  const signals: StreamingTextSignal[] = [];
  const timestamps: number[] = [];
  let observer: MutationObserver | null = null;

  observer = new MutationObserver((mutations) => {
    // Only care about text changes in this element
    const hasTextChange = mutations.some(
      (m) => m.type === 'characterData' || (m.type === 'childList' && m.target === element),
    );
    if (!hasTextChange) return;

    const now = Date.now();
    timestamps.push(now);

    // Keep only last 60 seconds of timestamps
    const cutoff = now - 60000;
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift();
    }

    // Check for AI streaming pattern
    if (timestamps.length >= AI_STREAM_PATTERN_MIN_LENGTH + 1) {
      const intervals = computeIntervals(timestamps);
      if (isStreamingPattern(intervals)) {
        const elementSelector = getElementSelector(element);
        const avgInterval = average(intervals);

        signals.push({
          type: 'streaming_text',
          timestamp: now,
          score: computeStreamScore(intervals),
          description: `Element ${elementSelector} shows AI token streaming at ${avgInterval.toFixed(1)}ms intervals`,
          likelyCategory: 'chat_widget',
          data: {
            elementSelector,
            intervals,
            averageInterval: avgInterval,
            chunkCount: timestamps.length - 1,
          },
        });

        // Reset timestamps to avoid duplicate signals for the same stream
        timestamps.length = 0;
      }
    }
  });

  observer.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  return {
    stop: () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
    getSignals: () => [...signals],
  };
}

/**
 * Compute a streaming score based on how closely intervals match
 * the AI streaming pattern. Perfect match = 0.95, weak match = 0.50.
 */
function computeStreamScore(intervals: number[]): number {
  if (intervals.length === 0) return 0;

  let inRange = 0;
  for (const interval of intervals) {
    if (interval >= AI_STREAM_INTERVAL_MIN && interval <= AI_STREAM_INTERVAL_MAX) {
      inRange++;
    }
  }

  const ratio = inRange / intervals.length;
  // Scale: 60%+ in range = 0.95, 40% = 0.70, 20% = 0.50
  return 0.50 + ratio * 0.45;
}

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET MESSAGE PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════

/** AI chat API message shape patterns in WebSocket data */
const AI_CHAT_WS_PATTERNS: ReadonlyArray<RegExp> = [
  /"role"\s*:\s*"(user|assistant|system)"/i,
  /"content"\s*:\s*"/i,
  /"delta"\s*:\s*{/i,
  /"choices"\s*:\s*\[/i,
  /"finish_reason"/i,
];

/**
 * Analyze WebSocket messages for AI chat API patterns.
 *
 * Checks message size distribution and content patterns to
 * determine if the WebSocket is communicating with an AI API.
 *
 * @param url - The WebSocket URL
 * @param messages - Array of message data (strings or objects)
 * @returns A WebSocketPatternSignal if AI patterns are detected, or null
 */
export function analyzeWebSocketPattern(
  url: string,
  messages: Array<{ data: string | ArrayBuffer; timestamp: number }>,
): WebSocketPatternSignal | null {
  if (messages.length < 3) return null;

  let chatAPIMatches = 0;
  let totalSize = 0;
  let inSizeRange = 0;

  for (const msg of messages) {
    const dataStr = typeof msg.data === 'string' ? msg.data : '';
    const size = typeof msg.data === 'string'
      ? new TextEncoder().encode(msg.data).length
      : (msg.data as ArrayBuffer).byteLength;

    totalSize += size;

    // Check message size range
    if (size >= AI_WEBSOCKET_MESSAGE_SIZE_MIN && size <= AI_WEBSOCKET_MESSAGE_SIZE_MAX) {
      inSizeRange++;
    }

    // Check for AI chat API patterns
    if (dataStr.length > 0 && dataStr.length < 100_000) {
      for (const pattern of AI_CHAT_WS_PATTERNS) {
        if (pattern.test(dataStr)) {
          chatAPIMatches++;
          break;
        }
      }
    }
  }

  const avgSize = totalSize / messages.length;
  const sizeRatio = inSizeRange / messages.length;
  const chatAPIRatio = chatAPIMatches / messages.length;

  // Require either strong size pattern or content pattern
  const score = (sizeRatio * 0.4) + (chatAPIRatio * 0.6);
  if (score < 0.35) return null;

  return {
    type: 'websocket_pattern',
    timestamp: Date.now(),
    score: Math.min(score, 1.0),
    description: chatAPIMatches > 0
      ? `WebSocket to ${url} shows AI chat API message patterns`
      : `WebSocket to ${url} shows AI-typical message size distribution`,
    likelyCategory: 'chat_widget',
    data: {
      url,
      messageCount: messages.length,
      averageSize: Math.round(avgSize),
      matchesChatAPI: chatAPIMatches > 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// DOM MUTATION BURST DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Watch for DOM mutation bursts characteristic of AI widget injection.
 *
 * AI widgets typically inject their complete UI tree in a short burst
 * (10+ mutations in under 1 second). This detector catches those
 * bursts and flags them.
 *
 * @param callback - Invoked when a mutation burst is detected
 * @returns Object with stop() method
 */
export function watchMutationBursts(
  callback: (signal: MutationBurstSignal) => void,
): { stop: () => void } {
  let observer: MutationObserver | null = null;
  let recentMutations: Array<{ timestamp: number; type: string; parent: Element }> = [];

  observer = new MutationObserver((mutations) => {
    const now = Date.now();

    // Add current mutations
    for (const mutation of mutations) {
      const parent = mutation.target instanceof Element
        ? mutation.target
        : mutation.target.parentElement;
      if (parent) {
        recentMutations.push({
          timestamp: now,
          type: mutation.type,
          parent,
        });
      }
    }

    // Prune mutations older than 1 second
    recentMutations = recentMutations.filter((m) => now - m.timestamp < 1000);

    // Check for burst pattern
    if (recentMutations.length >= AI_WIDGET_MUTATION_BURST) {
      const mutationTypes = [...new Set(recentMutations.map((m) => m.type))];
      const parentElement = recentMutations[0]?.parent;
      const parentSelector = parentElement
        ? getElementSelector(parentElement)
        : 'unknown';

      const burstDuration = now - (recentMutations[0]?.timestamp ?? now);

      callback({
        type: 'mutation_burst',
        timestamp: now,
        score: 0.65,
        description: `Burst of ${recentMutations.length} DOM mutations in ${burstDuration}ms — typical of widget injection`,
        likelyCategory: 'chat_widget',
        data: {
          mutationCount: recentMutations.length,
          burstDuration,
          parentSelector,
          mutationTypes,
        },
      });

      // Reset to avoid firing repeatedly for the same burst
      recentMutations = [];
    }
  });

  observer.observe(document.documentElement ?? document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });

  return {
    stop: () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SCRIPT LOADING PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════

/** AI-related script URL patterns */
const AI_SCRIPT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
  signal: string;
}> = [
  { pattern: /intercom\.io/i, category: 'chat_widget', signal: 'Intercom script' },
  { pattern: /driftt?\.com/i, category: 'chat_widget', signal: 'Drift script' },
  { pattern: /crisp\.chat/i, category: 'chat_widget', signal: 'Crisp script' },
  { pattern: /tidiochat/i, category: 'chat_widget', signal: 'Tidio script' },
  { pattern: /zendesk|zopim/i, category: 'chat_widget', signal: 'Zendesk script' },
  { pattern: /freshchat|freshworks/i, category: 'chat_widget', signal: 'Freshchat script' },
  { pattern: /livechat/i, category: 'chat_widget', signal: 'LiveChat script' },
  { pattern: /helpscout/i, category: 'chat_widget', signal: 'Help Scout script' },
  { pattern: /hubspot/i, category: 'chat_widget', signal: 'HubSpot script' },
  { pattern: /kommunicate/i, category: 'chat_widget', signal: 'Kommunicate script' },
  { pattern: /embed\.chatgpt/i, category: 'chat_widget', signal: 'ChatGPT embed script' },
  { pattern: /mosaicagent/i, category: 'chat_widget', signal: 'Mosaic agent script' },
  { pattern: /grammarly/i, category: 'content_injector', signal: 'Grammarly script' },
  { pattern: /jasper/i, category: 'content_injector', signal: 'Jasper script' },
  { pattern: /copilot/i, category: 'content_injector', signal: 'Copilot script' },
  { pattern: /clarity\.ms/i, category: 'tracker', signal: 'Microsoft Clarity script' },
  { pattern: /hotjar/i, category: 'tracker', signal: 'Hotjar script' },
  { pattern: /fullstory/i, category: 'tracker', signal: 'FullStory script' },
  { pattern: /openai|api\.openai/i, category: 'chat_widget', signal: 'OpenAI SDK script' },
  { pattern: /anthropic/i, category: 'chat_widget', signal: 'Anthropic SDK script' },
];

/**
 * Watch for dynamically loaded scripts that match AI patterns.
 *
 * AI widget scripts are often loaded lazily — not in the initial
 * HTML but injected by a bootstrap script. This catches those
 * dynamic script insertions.
 *
 * @param callback - Invoked when an AI-related script is loaded
 * @returns Object with stop() method
 */
export function watchScriptLoading(
  callback: (signal: ScriptLoadingSignal) => void,
): { stop: () => void } {
  let observer: MutationObserver | null = null;
  const pageLoadTime = Date.now();
  const seenScripts = new Set<string>();

  // Scan existing scripts first
  const existingScripts = document.querySelectorAll('script[src]');
  for (const script of existingScripts) {
    const src = script.getAttribute('src');
    if (src) seenScripts.add(src);
  }

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      const addedNodes = mutation.addedNodes;
      for (let i = 0; i < addedNodes.length; i++) {
        const node = addedNodes[i];
        if (!(node instanceof HTMLScriptElement)) continue;

        const src = node.getAttribute('src') ?? '';
        if (!src || seenScripts.has(src)) continue;
        seenScripts.add(src);

        // Check if the script was dynamically created (not in original HTML)
        const dynamicallyCreated = !node.hasAttribute('data-cortex-static');

        // Check against AI patterns
        for (const pattern of AI_SCRIPT_PATTERNS) {
          if (pattern.pattern.test(src)) {
            const injectionDelay = Date.now() - pageLoadTime;

            callback({
              type: 'script_loading',
              timestamp: Date.now(),
              score: 0.80,
              description: `AI-related script loaded: ${pattern.signal} (${injectionDelay}ms after page load)`,
              likelyCategory: pattern.category,
              data: {
                scriptUrl: src,
                injectionDelay,
                dynamicallyCreated,
              },
            });
            break;
          }
        }
      }
    }
  });

  observer.observe(document.documentElement ?? document.body, {
    childList: true,
    subtree: true,
  });

  return {
    stop: () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// USER INTERACTION PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════

/** AI-typical interaction patterns to watch for */
const AI_INTERACTION_SELECTORS: ReadonlyArray<{
  selector: string;
  interactionType: InteractionSignal['data']['interactionType'];
  category: AICategory;
  description: string;
}> = [
  { selector: '[class*="chat"]', interactionType: 'chat_open', category: 'chat_widget', description: 'Chat widget opened' },
  { selector: '[class*="ai-"]', interactionType: 'ai_response_expand', category: 'content_injector', description: 'AI response expanded' },
  { selector: '[class*="typing"]', interactionType: 'typing_indicator', category: 'chat_widget', description: 'AI typing indicator observed' },
  { selector: '[class*="bot-"]', interactionType: 'chat_open', category: 'chat_widget', description: 'Bot widget interacted with' },
];

/**
 * Watch for user interaction patterns typical of AI elements.
 *
 * AI chat widgets auto-scroll as new tokens arrive, show typing
 * indicators before responding, and have distinctive open/close
 * patterns. This detector catches those behaviors.
 *
 * @param callback - Invoked when an AI-typical interaction is detected
 * @returns Object with stop() method
 */
export function watchInteractionPatterns(
  callback: (signal: InteractionSignal) => void,
): { stop: () => void } {
  const abortController = new AbortController();
  const { signal } = abortController;

  // Watch for auto-scroll behavior in chat-like containers
  const chatContainers = document.querySelectorAll(
    '[class*="chat"], [class*="message-list"], [class*="conversation"]',
  );

  for (const container of chatContainers) {
    let isAutoScrolling = false;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    container.addEventListener('scroll', () => {
      // Check if scrolled to bottom (auto-scroll behavior)
      const el = container as HTMLElement;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;

      if (atBottom && !isAutoScrolling) {
        isAutoScrolling = true;

        callback({
          type: 'interaction',
          timestamp: Date.now(),
          score: 0.55,
          description: 'Auto-scroll behavior detected in chat-like container',
          likelyCategory: 'chat_widget',
          data: {
            interactionType: 'auto_scroll',
            elementSelector: getElementSelector(container),
          },
        });
      }

      // Reset after 500ms of no scrolling
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        isAutoScrolling = false;
      }, 500);
    }, { signal });
  }

  // Watch for typing indicator appearance
  const typingObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      const addedNodes = mutation.addedNodes;
      for (let i = 0; i < addedNodes.length; i++) {
        const node = addedNodes[i];
        if (!(node instanceof Element)) continue;

        // Check for typing indicator elements
        if (
          node.className && typeof node.className === 'string' &&
          (node.className.includes('typing') || node.className.includes('indicator'))
        ) {
          callback({
            type: 'interaction',
            timestamp: Date.now(),
            score: 0.60,
            description: 'AI typing indicator element appeared',
            likelyCategory: 'chat_widget',
            data: {
              interactionType: 'typing_indicator',
              elementSelector: getElementSelector(node),
            },
          });
        }
      }
    }
  });

  typingObserver.observe(document.body, { childList: true, subtree: true });

  return {
    stop: () => {
      abortController.abort();
      typingObserver.disconnect();
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: ANALYZE BEHAVIORAL SIGNALS
// ═══════════════════════════════════════════════════════════════

/**
 * Analyze a collection of behavioral signals and produce a
 * combined DetectionVector, or null if the signals do not
 * collectively indicate AI.
 *
 * This is the main entry point for the behavioral detection vector.
 * It aggregates individual signals into one combined assessment.
 *
 * @param signals - Array of behavioral signals to analyze
 * @returns A DetectionVector if AI behavior is detected, or null
 */
export function analyzeBehavioralSignals(
  signals: BehavioralSignal[],
): DetectionVector | null {
  if (signals.length === 0) return null;

  // Weight different signal types differently
  const typeWeights: Record<BehavioralSignal['type'], number> = {
    streaming_text: 0.35,     // Strongest behavioral signal
    websocket_pattern: 0.25,  // Strong if chat API patterns found
    mutation_burst: 0.15,     // Moderate — could be any widget
    script_loading: 0.15,     // Moderate — confirms AI script loaded
    interaction: 0.10,        // Weakest — easily confused with non-AI
  };

  let weightedScore = 0;
  let totalWeight = 0;
  const evidence: string[] = [];
  let bestCategory: AICategory = 'chat_widget';

  for (const sig of signals) {
    const weight = typeWeights[sig.type] ?? 0.10;
    weightedScore += sig.score * weight;
    totalWeight += weight;

    evidence.push(sig.description);

    // Prefer the category from the highest-scoring signal
    if (sig.score > 0.5 && sig.likelyCategory) {
      bestCategory = sig.likelyCategory;
    }
  }

  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Only produce a vector if score exceeds a meaningful threshold
  if (finalScore < 0.30) return null;

  return {
    source: 'behavioral',
    score: finalScore,
    confidence: Math.min(finalScore + 0.10, 1.0), // Slight confidence boost
    weight: DEFAULT_VECTOR_WEIGHTS.behavioral ?? 0.05,
    evidence,
    timestamp: Date.now(),
  };
}

/**
 * Create a complete behavioral pattern watcher that combines
 * all individual watchers into a single managed instance.
 *
 * @param onSignal - Callback for each individual behavioral signal
 * @returns Object with start/stop lifecycle and combined analysis
 */
export function createBehavioralWatcher(
  onSignal: (signal: BehavioralSignal) => void,
): {
  start: () => void;
  stop: () => void;
  getCollectedSignals: () => BehavioralSignal[];
  analyze: () => DetectionVector | null;
} {
  const collectedSignals: BehavioralSignal[] = [];
  const watchers: Array<{ stop: () => void }> = [];

  function handleSignal(signal: BehavioralSignal): void {
    collectedSignals.push(signal);
    onSignal(signal);
  }

  return {
    start() {
      // Mutation burst watcher
      watchers.push(watchMutationBursts((signal) => handleSignal(signal)));

      // Script loading watcher
      watchers.push(watchScriptLoading((signal) => handleSignal(signal)));

      // Interaction pattern watcher
      watchers.push(watchInteractionPatterns((signal) => handleSignal(signal)));
    },

    stop() {
      for (const watcher of watchers) {
        watcher.stop();
      }
      watchers.length = 0;
    },

    getCollectedSignals() {
      return [...collectedSignals];
    },

    analyze() {
      return analyzeBehavioralSignals(collectedSignals);
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute time intervals between consecutive timestamps.
 */
function computeIntervals(timestamps: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i]! - timestamps[i - 1]!);
  }
  return intervals;
}

/**
 * Check if intervals match the AI token streaming pattern.
 */
function isStreamingPattern(intervals: number[]): boolean {
  if (intervals.length < AI_STREAM_PATTERN_MIN_LENGTH) return false;

  let consecutiveMatches = 0;
  for (const interval of intervals) {
    if (interval >= AI_STREAM_INTERVAL_MIN && interval <= AI_STREAM_INTERVAL_MAX) {
      consecutiveMatches++;
      if (consecutiveMatches >= AI_STREAM_PATTERN_MIN_LENGTH) {
        return true;
      }
    } else {
      consecutiveMatches = 0;
    }
  }

  return false;
}

/**
 * Compute average of a number array.
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Get a stable CSS selector path for an element.
 *
 * Simplified version of the shared utility — duplicated here
 * to avoid importing window-dependent utils in contexts where
 * the document may not be fully available.
 */
function getElementSelector(element: Element): string {
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
