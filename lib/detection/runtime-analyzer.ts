/**
 * CortexShield — Runtime Analyzer
 *
 * The MOST IMPORTANT detection vector. Hooks into browser JavaScript APIs
 * to detect AI at the runtime level — before any DOM is even created.
 *
 * Intercepts: window.ai, fetch(), XMLHttpRequest, WebSocket connections,
 * Server-Sent Events, postMessage between frames, and PerformanceObserver
 * for AI workloads.
 *
 * Each interceptor produces a DetectionVector with source: 'runtime'.
 */

import type { AICategory, DetectionVector } from '../shared/types';
import {
  DEFAULT_VECTOR_WEIGHTS,
  AI_ENDPOINT_PATTERNS,
  AI_DOMAIN_INDICATORS,
  AI_STREAM_INTERVAL_MIN,
  AI_STREAM_INTERVAL_MAX,
  AI_STREAM_PATTERN_MIN_LENGTH,
} from '../shared/constants';
import { extractDomain, clamp } from '../shared/utils';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** A recorded interception event from a runtime hook */
export interface RuntimeInterception {
  /** The type of API that was intercepted */
  type: 'fetch' | 'xhr' | 'websocket' | 'sse' | 'postMessage' | 'windowAi' | 'longTask';
  /** The URL involved (if applicable) */
  url?: string;
  /** Which AI category this most likely belongs to */
  category: AICategory;
  /** The detection vector produced */
  vector: DetectionVector;
  /** When this interception occurred */
  timestamp: number;
}

/** Callback invoked when a runtime interception fires */
export type RuntimeCallback = (interception: RuntimeInterception) => void;

/** Configuration for the runtime analyzer */
export interface RuntimeAnalyzerConfig {
  /** Whether to intercept fetch() calls (default: true) */
  hookFetch: boolean;
  /** Whether to intercept XMLHttpRequest (default: true) */
  hookXHR: boolean;
  /** Whether to monitor WebSocket connections (default: true) */
  hookWebSocket: boolean;
  /** Whether to detect Server-Sent Events streams (default: true) */
  hookSSE: boolean;
  /** Whether to intercept postMessage between frames (default: true) */
  hookPostMessage: boolean;
  /** Whether to detect window.ai API calls (default: true) */
  hookWindowAI: boolean;
  /** Whether to detect long tasks via PerformanceObserver (default: true) */
  hookPerformance: boolean;
  /** Maximum number of interceptions to store in memory (default: 500) */
  maxInterceptionHistory: number;
  /** Debounce interval between identical URL interceptions (ms, default: 1000) */
  debounceIntervalMs: number;
}

/** Default runtime analyzer configuration */
const DEFAULT_RUNTIME_CONFIG: RuntimeAnalyzerConfig = {
  hookFetch: true,
  hookXHR: true,
  hookWebSocket: true,
  hookSSE: true,
  hookPostMessage: true,
  hookWindowAI: true,
  hookPerformance: true,
  maxInterceptionHistory: 500,
  debounceIntervalMs: 1000,
};

/** Active WebSocket connection being tracked */
interface TrackedWebSocket {
  /** The WebSocket instance */
  ws: WebSocket;
  /** The URL connected to */
  url: string;
  /** Whether this has been flagged as AI */
  flagged: boolean;
  /** When the connection was opened */
  openedAt: number;
  /** Number of messages received */
  messageCount: number;
  /** Timestamps of recent messages (for pattern analysis) */
  messageTimestamps: number[];
}

/** An SSE stream being monitored */
interface MonitoredSSE {
  /** The EventSource instance */
  source: EventSource;
  /** The URL of the SSE stream */
  url: string;
  /** Whether this stream has been flagged as AI */
  flagged: boolean;
  /** Timestamps of recent events (for interval analysis) */
  eventTimestamps: number[];
  /** When monitoring started */
  startedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// URL CATEGORIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Categorize a URL based on AI endpoint and domain patterns.
 *
 * Checks both the path (against AI_ENDPOINT_PATTERNS) and the
 * hostname (against AI_DOMAIN_INDICATORS) to determine if a URL
 * is communicating with an AI service.
 *
 * @param url - The full URL to categorize
 * @returns Category and evidence, or null if not AI-related
 */
export function categorizeRuntimeURL(url: string): { category: AICategory; evidence: string[] } | null {
  const evidence: string[] = [];
  let isAI = false;
  let category: AICategory = 'tracker';

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const hostname = parsed.hostname;

    // Check endpoint path patterns
    for (const pattern of AI_ENDPOINT_PATTERNS) {
      if (pathname.includes(pattern)) {
        isAI = true;
        evidence.push(`Endpoint path matches: ${pattern}`);
        // Chat/completions endpoints = chat category
        if (pattern.includes('chat') || pattern.includes('messages')) {
          category = 'chat_widget';
        } else if (pattern.includes('generate') || pattern.includes('predict')) {
          category = 'content_injector';
        }
        break;
      }
    }

    // Check domain indicators
    for (const domain of AI_DOMAIN_INDICATORS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        isAI = true;
        evidence.push(`Domain matches: ${domain}`);
        if (domain.includes('openai') || domain.includes('anthropic') || domain.includes('mistral')) {
          category = 'chat_widget';
        } else if (domain.includes('copilot') || domain.includes('googleapis')) {
          category = 'content_injector';
        }
        break;
      }
    }
  } catch {
    // Invalid URL — cannot categorize
    return null;
  }

  return isAI ? { category, evidence } : null;
}

/**
 * Categorize a WebSocket URL (strips wss:// prefix and checks).
 *
 * @param url - The WebSocket URL (ws:// or wss://)
 * @returns Category and evidence, or null
 */
function categorizeWebSocketURL(url: string): { category: AICategory; evidence: string[] } | null {
  // Convert ws:// and wss:// to https:// for URL parsing
  const httpsUrl = url.replace(/^ws(s?):\/\//, 'http$1://');
  return categorizeRuntimeURL(httpsUrl);
}

// ═══════════════════════════════════════════════════════════════
// WINDOW.AI API DETECTION
// ═══════════════════════════════════════════════════════════════

/** Shape of Chrome's built-in AI API (window.ai) */
interface WindowAI {
  canCreateTextSession?: () => Promise<{ available: string }>;
  createTextSession?: () => Promise<unknown>;
  defaultTextSession?: unknown;
  [key: string]: unknown;
}

/**
 * Detect and hook the window.ai API (Chrome's built-in AI).
 *
 * Chrome 125+ exposes window.ai for on-device LLM inference.
 * This function checks for its presence and wraps its methods
 * to intercept calls.
 *
 * @param callback - Invoked when window.ai is accessed
 * @returns Cleanup function to restore the original window.ai
 */
export function hookWindowAI(callback: RuntimeCallback): () => void {
  if (typeof window === 'undefined') return () => {};

  const aiObj = (window as unknown as Record<string, unknown>).ai as WindowAI | undefined;
  if (!aiObj) return () => {};

  const vector: DetectionVector = {
    source: 'runtime',
    score: 0.95,
    confidence: 0.95,
    weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
    evidence: ['window.ai API detected — Chrome built-in AI'],
    timestamp: Date.now(),
  };

  callback({
    type: 'windowAi',
    category: 'content_injector',
    vector,
    timestamp: Date.now(),
  });

  // Wrap canCreateTextSession to detect when it is called
  const originalCanCreate = aiObj.canCreateTextSession?.bind(aiObj);
  if (originalCanCreate) {
    aiObj.canCreateTextSession = function (): Promise<{ available: string }> {
      callback({
        type: 'windowAi',
        category: 'content_injector',
        vector: {
          source: 'runtime',
          score: 0.95,
          confidence: 0.95,
          weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
          evidence: ['window.ai.canCreateTextSession() called'],
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
      return originalCanCreate();
    };
  }

  // Wrap createTextSession to detect when it is called
  const originalCreate = aiObj.createTextSession?.bind(aiObj);
  if (originalCreate) {
    aiObj.createTextSession = function (): Promise<unknown> {
      callback({
        type: 'windowAi',
        category: 'content_injector',
        vector: {
          source: 'runtime',
          score: 0.98,
          confidence: 0.98,
          weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
          evidence: ['window.ai.createTextSession() called — AI session initiated'],
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
      return originalCreate();
    };
  }

  // Return cleanup function
  return () => {
    if (originalCanCreate) {
      aiObj.canCreateTextSession = originalCanCreate;
    }
    if (originalCreate) {
      aiObj.createTextSession = originalCreate;
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// FETCH HOOKING
// ═══════════════════════════════════════════════════════════════

/**
 * Intercept fetch() calls to detect requests to AI endpoints.
 *
 * Wraps the global fetch function. Each call is checked against
 * AI_ENDPOINT_PATTERNS and AI_DOMAIN_INDICATORS. Matching requests
 * produce a RuntimeInterception.
 *
 * @param callback - Invoked when an AI-related fetch is detected
 * @returns Cleanup function to restore the original fetch
 */
export function hookFetch(callback: RuntimeCallback): () => void {
  if (typeof window === 'undefined' || !window.fetch) return () => {};

  const originalFetch = window.fetch.bind(window);
  const seenUrls = new Map<string, number>(); // url → last intercept timestamp

  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const categorization = categorizeRuntimeURL(url);
    if (categorization) {
      const now = Date.now();
      const lastSeen = seenUrls.get(url);
      // Debounce — skip if we saw this URL very recently
      if (!lastSeen || now - lastSeen > 1000) {
        seenUrls.set(url, now);

        // Check request body for AI-specific patterns
        const bodyEvidence: string[] = [...categorization.evidence];
        if (init?.body) {
          const bodyStr = typeof init.body === 'string' ? init.body : '';
          if (bodyStr.includes('"model"') || bodyStr.includes('"messages"')) {
            bodyEvidence.push('Request body contains AI model/messages structure');
          }
          if (bodyStr.includes('"stream"') && bodyStr.includes('true')) {
            bodyEvidence.push('Request body requests streaming response');
          }
        }

        callback({
          type: 'fetch',
          url,
          category: categorization.category,
          vector: {
            source: 'runtime',
            score: 0.85,
            confidence: 0.85,
            weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
            evidence: bodyEvidence,
            timestamp: now,
          },
          timestamp: now,
        });
      }
    }

    return originalFetch(input, init);
  };

  // Return cleanup function
  return () => {
    window.fetch = originalFetch;
  };
}

// ═══════════════════════════════════════════════════════════════
// XHR HOOKING
// ═══════════════════════════════════════════════════════════════

/**
 * Intercept XMLHttpRequest to detect AI endpoint calls.
 *
 * Some AI SDKs still use XHR instead of fetch. This wraps
 * XMLHttpRequest.open() and checks URLs against AI patterns.
 *
 * @param callback - Invoked when an AI-related XHR is detected
 * @returns Cleanup function to restore the original XHR.open
 */
export function hookXHR(callback: RuntimeCallback): () => void {
  if (typeof window === 'undefined' || !window.XMLHttpRequest) return () => {};

  const originalOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string | null,
    password?: string | null,
  ): void {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const categorization = categorizeRuntimeURL(urlStr);

    if (categorization) {
      callback({
        type: 'xhr',
        url: urlStr,
        category: categorization.category,
        vector: {
          source: 'runtime',
          score: 0.80,
          confidence: 0.80,
          weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
          evidence: [...categorization.evidence, `XHR ${method} request`],
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
    }

    // Call original — preserve all arguments
    return async
      ? originalOpen.call(this, method, url, async, username, password)
      : originalOpen.call(this, method, url, async);
  };

  // Return cleanup function
  return () => {
    XMLHttpRequest.prototype.open = originalOpen;
  };
}

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET MONITORING
// ═══════════════════════════════════════════════════════════════

/**
 * Monitor WebSocket connections for AI service communication.
 *
 * Wraps the WebSocket constructor to track new connections.
 * Checks the URL against AI domain patterns. Also monitors
 * incoming message timing for AI token-streaming patterns.
 *
 * @param callback - Invoked when an AI WebSocket is detected or
 *                   when message patterns indicate AI streaming
 * @returns Cleanup function and tracked connections map
 */
export function hookWebSocket(callback: RuntimeCallback): {
  cleanup: () => void;
  getActiveConnections: () => ReadonlyMap<string, TrackedWebSocket>;
} {
  if (typeof window === 'undefined' || !window.WebSocket) {
    return {
      cleanup: () => {},
      getActiveConnections: () => new Map(),
    };
  }

  const originalWebSocket = window.WebSocket;
  const trackedConnections = new Map<WebSocket, TrackedWebSocket>();

  // Create a patched WebSocket class
  const PatchedWebSocket = function (url: string | URL, protocols?: string | string[]) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const ws = new originalWebSocket(urlStr, protocols);

    const tracked: TrackedWebSocket = {
      ws,
      url: urlStr,
      flagged: false,
      openedAt: Date.now(),
      messageCount: 0,
      messageTimestamps: [],
    };

    const categorization = categorizeWebSocketURL(urlStr);
    if (categorization) {
      tracked.flagged = true;
      callback({
        type: 'websocket',
        url: urlStr,
        category: categorization.category,
        vector: {
          source: 'runtime',
          score: 0.85,
          confidence: 0.85,
          weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
          evidence: [...categorization.evidence, 'WebSocket connection to AI service'],
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
    }

    // Monitor incoming messages for AI streaming patterns
    ws.addEventListener('message', (event: MessageEvent) => {
      tracked.messageCount++;
      const now = Date.now();
      tracked.messageTimestamps.push(now);

      // Keep only recent timestamps (last 30 seconds)
      const cutoff = now - 30000;
      tracked.messageTimestamps = tracked.messageTimestamps.filter((t) => t > cutoff);

      // Check for AI-like message intervals (token streaming)
      if (tracked.messageTimestamps.length >= AI_STREAM_PATTERN_MIN_LENGTH) {
        const intervals = computeIntervals(tracked.messageTimestamps);
        if (isStreamingPattern(intervals)) {
          tracked.flagged = true;
          callback({
            type: 'websocket',
            url: urlStr,
            category: 'chat_widget',
            vector: {
              source: 'runtime',
              score: 0.90,
              confidence: 0.85,
              weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
              evidence: [
                'WebSocket message intervals match AI token streaming pattern',
                `Avg interval: ${average(intervals).toFixed(1)}ms`,
                `Message count: ${tracked.messageCount}`,
              ],
              timestamp: now,
            },
            timestamp: now,
          });
        }
      }
    });

    // Track closed connections
    ws.addEventListener('close', () => {
      trackedConnections.delete(ws);
    });

    trackedConnections.set(ws, tracked);
    return ws;
  } as unknown as typeof WebSocket;

  // Copy static properties (read-only on WebSocket, so use defineProperty)
  const wsStaticProps = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
  for (const prop of wsStaticProps) {
    const value = originalWebSocket[prop];
    Object.defineProperty(PatchedWebSocket, prop, {
      value,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  }
  PatchedWebSocket.prototype = originalWebSocket.prototype;

  window.WebSocket = PatchedWebSocket;

  return {
    cleanup: () => {
      window.WebSocket = originalWebSocket;
    },
    getActiveConnections: () => {
      // Return a map keyed by URL for external consumers
      const result = new Map<string, TrackedWebSocket>();
      for (const tracked of trackedConnections.values()) {
        result.set(tracked.url, tracked);
      }
      return result;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SSE (Server-Sent Events) DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Monitor Server-Sent Events connections for AI streaming responses.
 *
 * Many AI APIs deliver token-by-token responses via SSE. This hook
 * wraps the EventSource constructor and monitors event timing to
 * detect the characteristic 20-200ms interval of AI token output.
 *
 * @param callback - Invoked when an AI SSE stream is detected
 * @returns Cleanup function and monitored streams map
 */
export function hookSSE(callback: RuntimeCallback): {
  cleanup: () => void;
  getMonitoredStreams: () => ReadonlyMap<string, MonitoredSSE>;
} {
  if (typeof window === 'undefined' || !window.EventSource) {
    return {
      cleanup: () => {},
      getMonitoredStreams: () => new Map(),
    };
  }

  const originalEventSource = window.EventSource;
  const monitoredStreams = new Map<EventSource, MonitoredSSE>();

  const PatchedEventSource = function (url: string | URL, config?: EventSourceInit) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const source = new originalEventSource(urlStr, config);

    const monitored: MonitoredSSE = {
      source,
      url: urlStr,
      flagged: false,
      eventTimestamps: [],
      startedAt: Date.now(),
    };

    const categorization = categorizeRuntimeURL(urlStr);

    source.addEventListener('message', () => {
      const now = Date.now();
      monitored.eventTimestamps.push(now);

      // Keep only recent timestamps (last 30 seconds)
      const cutoff = now - 30000;
      monitored.eventTimestamps = monitored.eventTimestamps.filter((t) => t > cutoff);

      // Check for AI streaming pattern
      if (monitored.eventTimestamps.length >= AI_STREAM_PATTERN_MIN_LENGTH) {
        const intervals = computeIntervals(monitored.eventTimestamps);
        if (isStreamingPattern(intervals)) {
          monitored.flagged = true;
          callback({
            type: 'sse',
            url: urlStr,
            category: categorization?.category ?? 'chat_widget',
            vector: {
              source: 'runtime',
              score: 0.90,
              confidence: 0.85,
              weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
              evidence: [
                ...(categorization?.evidence ?? []),
                'SSE event intervals match AI token streaming pattern',
                `Avg interval: ${average(intervals).toFixed(1)}ms`,
              ],
              timestamp: now,
            },
            timestamp: now,
          });
        }
      }
    });

    source.addEventListener('error', () => {
      monitoredStreams.delete(source);
    });

    monitoredStreams.set(source, monitored);
    return source;
  } as unknown as typeof EventSource;

  PatchedEventSource.prototype = originalEventSource.prototype;
  // Copy static properties (read-only on EventSource, so use defineProperty)
  const sseStaticProps = ['CONNECTING', 'OPEN', 'CLOSED'] as const;
  for (const prop of sseStaticProps) {
    const value = originalEventSource[prop];
    Object.defineProperty(PatchedEventSource, prop, {
      value,
      writable: false,
      enumerable: true,
      configurable: true,
    });
  }

  window.EventSource = PatchedEventSource;

  return {
    cleanup: () => {
      window.EventSource = originalEventSource;
    },
    getMonitoredStreams: () => {
      const result = new Map<string, MonitoredSSE>();
      for (const monitored of monitoredStreams.values()) {
        result.set(monitored.url, monitored);
      }
      return result;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// POSTMESSAGE MONITORING
// ═══════════════════════════════════════════════════════════════

/** Patterns in postMessage data that indicate AI communication */
const AI_POSTMESSAGE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
  signal: string;
}> = [
  { pattern: /"model"\s*:/i, category: 'chat_widget', signal: 'postMessage contains AI model reference' },
  { pattern: /"completion"\s*:/i, category: 'chat_widget', signal: 'postMessage contains completion data' },
  { pattern: /"tokens"\s*:/i, category: 'chat_widget', signal: 'postMessage contains token count' },
  { pattern: /"streaming"\s*:\s*true/i, category: 'chat_widget', signal: 'postMessage indicates streaming' },
  { pattern: /chatgpt|openai|anthropic|copilot|gemini|claude/i, category: 'chat_widget', signal: 'postMessage mentions known AI service' },
  { pattern: /"ai(-|\s)?generat/i, category: 'content_injector', signal: 'postMessage contains AI-generated marker' },
];

/**
 * Monitor postMessage calls between frames to detect AI communication.
 *
 * AI widgets embedded in iframes often communicate with the parent
 * page via postMessage. This wraps window.postMessage and the
 * message event listener to intercept these communications.
 *
 * @param callback - Invoked when an AI-related postMessage is detected
 * @returns Cleanup function to restore original methods
 */
export function hookPostMessage(callback: RuntimeCallback): () => void {
  if (typeof window === 'undefined') return () => {};

  const originalPostMessage = window.postMessage.bind(window);

  // Hook outgoing postMessage — use a broad signature and delegate to original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.postMessage = function (message: unknown, targetOrOptions: unknown, transfer?: Transferable[]): void {
    checkPostMessageData(message, 'outgoing', callback);

    if (typeof targetOrOptions === 'string') {
      originalPostMessage(message, targetOrOptions, transfer);
    } else {
      originalPostMessage(message, targetOrOptions as WindowPostMessageOptions);
    }
  };

  // Hook incoming message events
  function onIncomingMessage(event: MessageEvent): void {
    checkPostMessageData(event.data, 'incoming', callback);
  }

  window.addEventListener('message', onIncomingMessage);

  // Return cleanup function
  return () => {
    window.postMessage = originalPostMessage;
    window.removeEventListener('message', onIncomingMessage);
  };
}

/**
 * Check postMessage data for AI-related content patterns.
 */
function checkPostMessageData(
  data: unknown,
  direction: string,
  callback: RuntimeCallback,
): void {
  if (!data) return;

  // Only analyze string or JSON-serializable data
  let dataStr: string;
  if (typeof data === 'string') {
    dataStr = data;
  } else if (typeof data === 'object') {
    try {
      dataStr = JSON.stringify(data);
    } catch {
      return; // Non-serializable object — skip
    }
  } else {
    return;
  }

  // Limit analysis size (avoid scanning huge payloads)
  if (dataStr.length > 100_000) return;

  for (const pattern of AI_POSTMESSAGE_PATTERNS) {
    if (pattern.pattern.test(dataStr)) {
      callback({
        type: 'postMessage',
        category: pattern.category,
        vector: {
          source: 'runtime',
          score: 0.70,
          confidence: 0.70,
          weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
          evidence: [`${direction} postMessage: ${pattern.signal}`],
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
      break; // One match per message is enough
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE OBSERVER (Long Tasks)
// ═══════════════════════════════════════════════════════════════

/**
 * Detect AI workloads via the Performance Observer API.
 *
 * AI inference (especially on-device via window.ai or WebLLM)
 * creates long tasks (>50ms). This observer flags sustained
 * long-task patterns that indicate AI processing.
 *
 * @param callback - Invoked when long tasks suggest AI inference
 * @returns Cleanup function to disconnect the observer
 */
export function hookPerformance(callback: RuntimeCallback): () => void {
  if (typeof window === 'undefined' || !window.PerformanceObserver) return () => {};

  let consecutiveLongTasks = 0;
  const LONG_TASK_THRESHOLD = 50; // ms — matches browser definition
  const AI_LONG_TASK_BURST = 3; // 3+ consecutive long tasks = suspicious

  let observer: PerformanceObserver | null = null;

  try {
    observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (entry.duration > LONG_TASK_THRESHOLD) {
          consecutiveLongTasks++;

          if (consecutiveLongTasks >= AI_LONG_TASK_BURST) {
            callback({
              type: 'longTask',
              category: 'content_injector',
              vector: {
                source: 'runtime',
                score: 0.55,
                confidence: 0.50,
                weight: DEFAULT_VECTOR_WEIGHTS.runtime ?? 0.15,
                evidence: [
                  `Sustained long tasks detected (${consecutiveLongTasks} consecutive)`,
                  `Last task duration: ${entry.duration.toFixed(1)}ms`,
                  'Pattern consistent with on-device AI inference',
                ],
                timestamp: Date.now(),
              },
              timestamp: Date.now(),
            });

            // Reset counter to avoid flooding
            consecutiveLongTasks = 0;
          }
        } else {
          // Short task resets the counter
          consecutiveLongTasks = 0;
        }
      }
    });

    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // PerformanceObserver may not support 'longtask' in all browsers
  }

  return () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION: LIFECYCLE MANAGER
// ═══════════════════════════════════════════════════════════════

/** Manages all runtime hooks and their lifecycle */
export interface RuntimeAnalyzerInstance {
  /** Start all configured runtime hooks */
  start: () => void;
  /** Stop all runtime hooks and restore original APIs */
  stop: () => void;
  /** Get the interception history */
  getHistory: () => ReadonlyArray<RuntimeInterception>;
  /** Clear the interception history */
  clearHistory: () => void;
}

/**
 * Create and manage a complete runtime analyzer instance.
 *
 * Starts all configured hooks and provides lifecycle control.
 * This is the main entry point for the runtime detection vector.
 *
 * @param callback - Invoked for every AI-related runtime interception
 * @param config - Optional configuration overrides
 * @returns A RuntimeAnalyzerInstance with start/stop lifecycle methods
 */
export function createRuntimeAnalyzer(
  callback: RuntimeCallback,
  config: Partial<RuntimeAnalyzerConfig> = {},
): RuntimeAnalyzerInstance {
  const fullConfig: RuntimeAnalyzerConfig = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  const history: RuntimeInterception[] = [];
  const cleanups: Array<() => void> = [];

  function wrappedCallback(interception: RuntimeInterception): void {
    // Add to history
    if (history.length >= fullConfig.maxInterceptionHistory) {
      history.shift(); // Remove oldest
    }
    history.push(interception);

    // Forward to caller
    callback(interception);
  }

  return {
    start() {
      if (fullConfig.hookWindowAI) {
        cleanups.push(hookWindowAI(wrappedCallback));
      }
      if (fullConfig.hookFetch) {
        cleanups.push(hookFetch(wrappedCallback));
      }
      if (fullConfig.hookXHR) {
        cleanups.push(hookXHR(wrappedCallback));
      }
      if (fullConfig.hookWebSocket) {
        const wsHook = hookWebSocket(wrappedCallback);
        cleanups.push(wsHook.cleanup);
      }
      if (fullConfig.hookSSE) {
        const sseHook = hookSSE(wrappedCallback);
        cleanups.push(sseHook.cleanup);
      }
      if (fullConfig.hookPostMessage) {
        cleanups.push(hookPostMessage(wrappedCallback));
      }
      if (fullConfig.hookPerformance) {
        cleanups.push(hookPerformance(wrappedCallback));
      }
    },

    stop() {
      // Call all cleanup functions in reverse order
      for (let i = cleanups.length - 1; i >= 0; i--) {
        const cleanup = cleanups[i];
        if (cleanup) cleanup();
      }
      cleanups.length = 0;
    },

    getHistory() {
      return history;
    },

    clearHistory() {
      history.length = 0;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// STREAMING PATTERN HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute time intervals (ms) between consecutive timestamps.
 *
 * @param timestamps - Sorted array of timestamps (ms)
 * @returns Array of intervals between consecutive timestamps
 */
function computeIntervals(timestamps: number[]): number[] {
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i]! - timestamps[i - 1]!);
  }
  return intervals;
}

/**
 * Check if a set of intervals matches the AI streaming token pattern.
 *
 * AI token streaming produces intervals consistently in the
 * 20-200ms range (as defined by AI_STREAM_INTERVAL_MIN/MAX).
 * At least AI_STREAM_PATTERN_MIN_LENGTH consecutive intervals
 * must fall within this range.
 *
 * @param intervals - Array of time intervals (ms)
 * @returns True if the pattern matches AI token streaming
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
 * Compute the average of a number array.
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
