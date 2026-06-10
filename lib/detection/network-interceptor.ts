/**
 * CortexShield — Network Interceptor
 *
 * Network-level detection using Declarative Net Request (DNR) for
 * static blocking and runtime monitoring for dynamic detection.
 *
 * Generates DNR JSON rules from filter lists, categorizes network
 * requests, tracks active connections, and decides which requests
 * to flag as AI-related.
 *
 * This is the "network" detection vector — operates at the
 * request level before any DOM is created.
 */

import type { AICategory, DetectionVector } from '../shared/types';
import { AI_ENDPOINT_PATTERNS, AI_DOMAIN_INDICATORS, DEFAULT_VECTOR_WEIGHTS } from '../shared/constants';
import { extractDomain } from '../shared/utils';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** A tracked AI connection per tab */
export interface TrackedConnection {
  /** Tab ID where the connection originates */
  tabId: number;
  /** The URL of the AI endpoint */
  url: string;
  /** The domain extracted from the URL */
  domain: string;
  /** Which AI category this connection falls into */
  category: AICategory;
  /** How many requests have been made to this endpoint */
  requestCount: number;
  /** When the first request to this endpoint was seen */
  firstSeen: number;
  /** When the most recent request was seen */
  lastSeen: number;
}

/** A tracked WebSocket connection flagged as AI */
export interface TrackedWSConnection {
  /** Tab ID where the WebSocket was opened */
  tabId: number;
  /** The WebSocket URL (ws:// or wss://) */
  url: string;
  /** The domain extracted from the URL */
  domain: string;
  /** Which AI category this connection belongs to */
  category: AICategory;
  /** Whether the connection is currently active */
  active: boolean;
  /** When the connection was opened */
  openedAt: number;
}

/** DNR rule structure (Chrome extension API) */
export interface DNRRule {
  /** Unique rule ID */
  id: number;
  /** Whether the rule is active */
  enabled: boolean;
  /** The action to take when matched */
  action: {
    type: 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders';
    redirect?: { url: string };
    requestHeaders?: Array<{ header: string; operation: 'set' | 'remove'; value?: string }>;
    responseHeaders?: Array<{ header: string; operation: 'set' | 'remove'; value?: string }>;
  };
  /** The conditions under which the rule matches */
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    domains?: string[];
    excludedDomains?: string[];
    resourceTypes?: string[];
    excludedResourceTypes?: string[];
    requestMethods?: string[];
    excludedRequestMethods?: string[];
    tabIds?: number[];
    excludedTabIds?: number[];
  };
  /** Priority (higher = wins when multiple rules match) */
  priority?: number;
}

/** Request detail shape (simplified from chrome.webRequest) */
export interface RequestDetails {
  /** Tab ID of the request */
  tabId: number;
  /** URL of the request */
  url: string;
  /** HTTP method */
  method: string;
  /** Resource type (script, xmlhttprequest, etc.) */
  type: string;
  /** Request headers (if available) */
  requestHeaders?: Array<{ name: string; value: string }>;
  /** Whether this is a main frame request */
  isMainFrame: boolean;
}

// ═══════════════════════════════════════════════════════════════
// URL CATEGORIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Categorize a network request URL into an AICategory.
 *
 * Checks both the URL path (against AI_ENDPOINT_PATTERNS) and the
 * hostname (against AI_DOMAIN_INDICATORS) to determine if the
 * request is going to an AI service.
 *
 * @param url - The full request URL to categorize
 * @returns The most likely AICategory, or null if not AI-related
 */
export function categorizeNetworkRequest(url: string): AICategory | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const hostname = parsed.hostname;

    // Check endpoint path patterns first (more specific)
    for (const pattern of AI_ENDPOINT_PATTERNS) {
      if (pathname.includes(pattern)) {
        // Chat/completions endpoints
        if (pattern.includes('chat') || pattern.includes('messages')) {
          return 'chat_widget';
        }
        // Generation/content endpoints
        if (pattern.includes('generate') || pattern.includes('predict') || pattern.includes('completions')) {
          return 'content_injector';
        }
        // General AI API
        return 'tracker';
      }
    }

    // Check domain indicators
    for (const domain of AI_DOMAIN_INDICATORS) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        // Specific domain → category mapping
        if (domain.includes('openai') || domain.includes('anthropic') || domain.includes('mistral') || domain.includes('cohere')) {
          return 'chat_widget';
        }
        if (domain.includes('copilot') || domain.includes('googleapis')) {
          return 'content_injector';
        }
        if (domain.includes('mosaicagent')) {
          return 'tracker';
        }
        return 'chat_widget';
      }
    }
  } catch {
    // Invalid URL — cannot categorize
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// REQUEST INTERCEPTION DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Decide whether a network request should be flagged as AI-related.
 *
 * Uses URL categorization, request method, and resource type to
 * determine whether to flag the request. Main frame navigation
 * requests are never flagged (to avoid blocking entire pages).
 *
 * @param details - The request details from the webRequest API
 * @returns A DetectionVector if the request should be flagged, or null
 */
export function shouldInterceptRequest(
  details: RequestDetails,
): DetectionVector | null {
  // Never intercept main frame navigation
  if (details.isMainFrame) return null;

  // Skip data: and blob: URLs
  if (details.url.startsWith('data:') || details.url.startsWith('blob:')) return null;

  const category = categorizeNetworkRequest(details.url);
  if (!category) return null;

  const domain = extractDomain(details.url);
  const evidence: string[] = [];

  // Add domain-based evidence
  for (const aiDomain of AI_DOMAIN_INDICATORS) {
    if (domain.includes(aiDomain) || domain.endsWith(`.${aiDomain}`)) {
      evidence.push(`Request to AI domain: ${aiDomain}`);
      break;
    }
  }

  // Add path-based evidence
  try {
    const pathname = new URL(details.url).pathname;
    for (const pattern of AI_ENDPOINT_PATTERNS) {
      if (pathname.includes(pattern)) {
        evidence.push(`Request path matches AI endpoint: ${pattern}`);
        break;
      }
    }
  } catch {
    // URL parsing failed — skip path evidence
  }

  // Add method evidence
  evidence.push(`${details.method} ${details.type} request to AI service`);

  return {
    source: 'network',
    score: 0.85,
    confidence: 0.80,
    weight: DEFAULT_VECTOR_WEIGHTS.network ?? 0.25,
    evidence,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// ACTIVE CONNECTION TRACKING
// ═══════════════════════════════════════════════════════════════

/** Manages tracking of active AI connections across tabs */
export class ConnectionTracker {
  private connections: Map<string, TrackedConnection> = new Map();
  private wsConnections: Map<string, TrackedWSConnection> = new Map();
  private maxConnections: number;

  constructor(maxConnections: number = 1000) {
    this.maxConnections = maxConnections;
  }

  /**
   * Record a network request to a potential AI endpoint.
   *
   * @param details - The request details
   * @returns The tracked connection entry (new or updated)
   */
  recordRequest(details: RequestDetails): TrackedConnection {
    const key = `${details.tabId}:${details.url}`;
    const now = Date.now();
    const domain = extractDomain(details.url);
    const category = categorizeNetworkRequest(details.url) ?? 'tracker';

    const existing = this.connections.get(key);
    if (existing) {
      existing.requestCount++;
      existing.lastSeen = now;
      return existing;
    }

    // Evict oldest connection if at capacity
    if (this.connections.size >= this.maxConnections) {
      let oldest: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.connections) {
        if (v.lastSeen < oldestTime) {
          oldestTime = v.lastSeen;
          oldest = k;
        }
      }
      if (oldest !== null) {
        this.connections.delete(oldest);
      }
    }

    const entry: TrackedConnection = {
      tabId: details.tabId,
      url: details.url,
      domain,
      category,
      requestCount: 1,
      firstSeen: now,
      lastSeen: now,
    };

    this.connections.set(key, entry);
    return entry;
  }

  /**
   * Record a WebSocket connection to a potential AI endpoint.
   *
   * @param tabId - Tab ID where the WebSocket was opened
   * @param url - The WebSocket URL
   * @returns The tracked WebSocket connection entry
   */
  recordWebSocket(tabId: number, url: string): TrackedWSConnection {
    const key = `${tabId}:${url}`;
    const domain = extractDomain(url.replace(/^ws(s?):\/\//, 'http$1://'));
    const category = categorizeNetworkRequest(
      url.replace(/^ws(s?):\/\//, 'https://'),
    ) ?? 'chat_widget';

    const entry: TrackedWSConnection = {
      tabId,
      url,
      domain,
      category,
      active: true,
      openedAt: Date.now(),
    };

    this.wsConnections.set(key, entry);
    return entry;
  }

  /**
   * Mark a WebSocket connection as closed.
   */
  closeWebSocket(tabId: number, url: string): void {
    const key = `${tabId}:${url}`;
    const entry = this.wsConnections.get(key);
    if (entry) {
      entry.active = false;
    }
  }

  /**
   * Get all tracked connections for a specific tab.
   */
  getConnectionsForTab(tabId: number): TrackedConnection[] {
    const result: TrackedConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.tabId === tabId) {
        result.push(conn);
      }
    }
    return result;
  }

  /**
   * Get all tracked WebSocket connections for a specific tab.
   */
  getWebSocketConnectionsForTab(tabId: number): TrackedWSConnection[] {
    const result: TrackedWSConnection[] = [];
    for (const ws of this.wsConnections.values()) {
      if (ws.tabId === tabId) {
        result.push(ws);
      }
    }
    return result;
  }

  /**
   * Get all currently active WebSocket connections.
   */
  getActiveWebSocketConnections(): TrackedWSConnection[] {
    const result: TrackedWSConnection[] = [];
    for (const ws of this.wsConnections.values()) {
      if (ws.active) {
        result.push(ws);
      }
    }
    return result;
  }

  /**
   * Get a map of which tabs have active AI connections.
   */
  getTabsWithAIConnections(): Map<number, { httpCount: number; wsCount: number }> {
    const tabMap = new Map<number, { httpCount: number; wsCount: number }>();

    for (const conn of this.connections.values()) {
      const entry = tabMap.get(conn.tabId) ?? { httpCount: 0, wsCount: 0 };
      entry.httpCount++;
      tabMap.set(conn.tabId, entry);
    }

    for (const ws of this.wsConnections.values()) {
      if (ws.active) {
        const entry = tabMap.get(ws.tabId) ?? { httpCount: 0, wsCount: 0 };
        entry.wsCount++;
        tabMap.set(ws.tabId, entry);
      }
    }

    return tabMap;
  }

  /**
   * Remove all tracked connections for a specific tab.
   */
  clearTab(tabId: number): void {
    for (const [key, conn] of this.connections) {
      if (conn.tabId === tabId) {
        this.connections.delete(key);
      }
    }
    for (const [key, ws] of this.wsConnections) {
      if (ws.tabId === tabId) {
        this.wsConnections.delete(key);
      }
    }
  }

  /**
   * Clear all tracked connections.
   */
  clearAll(): void {
    this.connections.clear();
    this.wsConnections.clear();
  }
}

/**
 * Monitor active connections across the browser.
 *
 * Creates and returns a ConnectionTracker that can be fed request
 * details from the chrome.webRequest API to maintain a real-time
 * view of which tabs have active AI connections.
 *
 * @param maxConnections - Maximum number of connections to track
 * @returns A ConnectionTracker instance
 */
export function monitorActiveConnections(maxConnections: number = 1000): ConnectionTracker {
  return new ConnectionTracker(maxConnections);
}

// ═══════════════════════════════════════════════════════════════
// DNR RULE GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Generate Declarative Net Request (DNR) rules from filter list data.
 *
 * Takes a list of AI domains and endpoint patterns and generates
 * a JSON ruleset compatible with chrome.declarativeNetRequest.
 *
 * @param filterListPath - Path to a filter list file (for future use with
 *                          the filter list parser; currently uses built-in constants)
 * @returns Array of DNR rules ready to be loaded into the extension
 */
export function generateDNRRules(filterListPath?: string): DNRRule[] {
  const rules: DNRRule[] = [];
  let ruleId = 1;

  // Generate domain-based blocking rules
  for (const domain of AI_DOMAIN_INDICATORS) {
    // Determine the most appropriate action based on the domain
    const isAnalyticsDomain = domain.includes('analytics') || domain.includes('clarity') || domain.includes('hotjar');
    const actionType = isAnalyticsDomain ? 'block' : 'block';

    rules.push({
      id: ruleId++,
      enabled: true,
      action: {
        type: actionType,
        responseHeaders: [
          {
            header: 'X-Cortex-Shield',
            operation: 'set',
            value: 'blocked',
          },
        ],
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: [
          'script',
          'xmlhttprequest',
          'sub_frame',
          'other',
        ],
      },
      priority: 2,
    });
  }

  // Generate endpoint-based blocking rules
  for (const pattern of AI_ENDPOINT_PATTERNS) {
    rules.push({
      id: ruleId++,
      enabled: true,
      action: {
        type: 'block',
        responseHeaders: [
          {
            header: 'X-Cortex-Shield',
            operation: 'set',
            value: 'blocked',
          },
        ],
      },
      condition: {
        regexFilter: escapeRegexForDNR(pattern),
        resourceTypes: [
          'xmlhttprequest',
          'other',
        ],
      },
      priority: 1,
    });
  }

  return rules;
}

/**
 * Escape a string for use as a DNR regexFilter.
 *
 * DNR regexFilter supports a subset of regex. This handles
 * common special characters that need escaping.
 *
 * @param str - The string to escape
 * @returns The escaped regex string
 */
function escapeRegexForDNR(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate DNR rules from parsed filter list rules.
 *
 * Converts the output of the filter list parser into DNR format.
 * This handles network blocking rules from EasyList-format lists.
 *
 * @param parsedRules - Rules parsed by the filter list parser
 * @param startId - Starting rule ID (to avoid collisions)
 * @returns Array of DNR rules
 */
export function generateDNRRulesFromParsed(
  parsedRules: Array<{
    type: 'network' | 'cosmetic';
    pattern?: string;
    domain?: string;
    domains?: string[];
    isException: boolean;
    raw: string;
  }>,
  startId: number = 1,
): DNRRule[] {
  const rules: DNRRule[] = [];
  let ruleId = startId;

  for (const rule of parsedRules) {
    // Skip cosmetic rules — DNR only handles network requests
    if (rule.type === 'cosmetic') continue;
    // Skip exception rules at this stage
    if (rule.isException) continue;
    // Skip rules without a pattern
    if (!rule.pattern) continue;

    const condition: DNRRule['condition'] = {};

    // Use regexFilter for complex patterns, urlFilter for simple ones
    if (rule.pattern.startsWith('||')) {
      // Domain anchored pattern
      condition.urlFilter = rule.pattern;
    } else if (rule.pattern.includes('*') || rule.pattern.includes('^')) {
      // Wildcard pattern — convert to regex
      condition.regexFilter = convertWildcardToRegex(rule.pattern);
    } else {
      condition.urlFilter = rule.pattern;
    }

    // Apply domain restrictions
    if (rule.domains && rule.domains.length > 0) {
      const includedDomains: string[] = [];
      const excludedDomains: string[] = [];

      for (const d of rule.domains) {
        if (d.startsWith('~')) {
          excludedDomains.push(d.slice(1));
        } else {
          includedDomains.push(d);
        }
      }

      if (includedDomains.length > 0) condition.domains = includedDomains;
      if (excludedDomains.length > 0) condition.excludedDomains = excludedDomains;
    }

    rules.push({
      id: ruleId++,
      enabled: true,
      action: {
        type: 'block',
        responseHeaders: [
          {
            header: 'X-Cortex-Shield',
            operation: 'set',
            value: 'blocked',
          },
        ],
      },
      condition,
      priority: 1,
    });
  }

  return rules;
}

/**
 * Convert EasyList wildcard patterns to DNR-compatible regex.
 *
 * EasyList uses * for any string and ^ for a separator.
 * This converts those to proper regex equivalents.
 *
 * @param pattern - The EasyList wildcard pattern
 * @returns A regex string compatible with DNR regexFilter
 */
function convertWildcardToRegex(pattern: string): string {
  let regex = pattern
    // Escape special regex characters (except * and ^)
    .replace(/[.+?${}()|[\]\\]/g, '\\$&')
    // Convert * to .* (any string)
    .replace(/\*/g, '.*')
    // Convert ^ to separator pattern (end of URL or path separator)
    .replace(/\^/g, '(?:[?/&]|$)');

  // Anchor at start if pattern starts with ||
  if (regex.startsWith('\\|\\|')) {
    regex = `^[a-z]+://(?:[a-z0-9-]+\\.)*${regex.slice(4)}`;
  }

  return regex;
}

/**
 * Serialize DNR rules to JSON for storage or loading.
 *
 * @param rules - Array of DNR rules
 * @returns JSON string representation
 */
export function serializeDNRRules(rules: DNRRule[]): string {
  return JSON.stringify(rules, null, 2);
}
