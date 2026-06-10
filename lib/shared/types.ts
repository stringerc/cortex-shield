/**
 * CortexShield — Shared Type Definitions
 *
 * Every subsystem depends on these types. They define the contract
 * between detection, scoring, action, persistence, and UI layers.
 *
 * Design principle: Types are data, not behavior. All state flows
 * through explicit pipelines. No hidden mutation, no global god objects.
 */

// ═══════════════════════════════════════════════════════════════
// OPERATING MODES
// ═══════════════════════════════════════════════════════════════

/** The three operating modes — adapted from Cortex NudgeEngine */
export type ShieldMode = 'ghost' | 'sentry' | 'guardian';

// ═══════════════════════════════════════════════════════════════
// AI ELEMENT CATEGORIES
// ═══════════════════════════════════════════════════════════════

/** The six categories of AI-powered elements we detect and block */
export type AICategory =
  | 'chat_widget'      // Intercom, Drift, Crisp, ChatGPT embed, Tidio, Zendesk AI
  | 'search_overlay'   // Google AI Overviews, Bing Copilot, DDG AI
  | 'content_injector' // Grammarly, Notion AI, WordPress AI, Jasper, Copilot sidebar
  | 'social_feature'   // X/Twitter Grok, Meta AI, LinkedIn AI, Reddit AI summaries
  | 'popup'            // "Try AI!" banners, upgrade prompts, onboarding modals
  | 'tracker';         // AI analytics endpoints, heatmap scripts, session recorders

/** Human-readable labels for categories */
export const CATEGORY_LABELS: Record<AICategory, string> = {
  chat_widget: 'Chat Widgets',
  search_overlay: 'Search AI',
  content_injector: 'Content AI',
  social_feature: 'Social AI',
  popup: 'AI Popups',
  tracker: 'AI Trackers',
};

/** Category icons for UI */
export const CATEGORY_ICONS: Record<AICategory, string> = {
  chat_widget: '💬',
  search_overlay: '🔍',
  content_injector: '✍️',
  social_feature: '📱',
  popup: '🔔',
  tracker: '📊',
};

/** All six categories in display order */
export const ALL_CATEGORIES: AICategory[] = [
  'chat_widget',
  'search_overlay',
  'content_injector',
  'social_feature',
  'popup',
  'tracker',
];

// ═══════════════════════════════════════════════════════════════
// DETECTION TYPES
// ═══════════════════════════════════════════════════════════════

/** The five detection vectors — each independently scores elements */
export type DetectionSource =
  | 'static'     // Known CSS selectors, domains, iframes from filter lists
  | 'network'    // Network request interception (DNR + runtime monitoring)
  | 'dom'        // MutationObserver + DOM pattern analysis
  | 'runtime'    // window.ai, fetch/XHR hooks, postMessage monitoring
  | 'behavioral'; // Timing analysis, streaming patterns, AI text signatures

/** A single detection result from one vector */
export interface DetectionVector {
  /** Which detection method produced this result */
  source: DetectionSource;
  /** 0 = definitely not AI, 1 = definitely AI */
  score: number;
  /** How confident this vector is in its own score */
  confidence: number;
  /** Adaptive weight — adjusted by self-repair based on user feedback */
  weight: number;
  /** What specifically triggered this detection */
  evidence: string[];
  /** When this detection was made */
  timestamp: number;
}

/** The combined assessment from all 5 vectors */
export interface DetectionResult {
  /** Overall legitimacy score: 0 = definitely AI (should block), 1 = definitely not AI (should allow) */
  legitimacyScore: number;
  /** Which AI category this element belongs to */
  category: AICategory;
  /** Overall confidence in the detection decision */
  confidence: number;
  /** The 5 individual vector results */
  vectors: DetectionVector[];
  /** Human-readable reasons for the detection */
  evidence: string[];
  /** The DOM element that was detected (if applicable) */
  element?: Element;
  /** Unique ID for this detection event */
  id: string;
  /** When this combined detection was computed */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// BLOCK DECISION TYPES
// ═══════════════════════════════════════════════════════════════

/** The action to take on a detected AI element */
export type BlockAction = 'hide' | 'flag' | 'ignore';

/** Result from the CollapseBlock gate — should this element be blocked? */
export interface BlockDecision {
  /** The detection that triggered this decision */
  detection: DetectionResult;
  /** What action was decided */
  action: BlockAction;
  /** The gate's confidence in this decision (0-1) */
  gateConfidence: number;
  /** Mode that was active when decision was made */
  mode: ShieldMode;
  /** Whether the user overrode this decision */
  userOverrode: boolean;
  /** Why this decision was made (human-readable) */
  reason: string;
  /** When this decision was made */
  timestamp: number;
}

/** Calibration entry — tracks whether our block decisions match user intent */
export interface CalibrationEntry {
  /** The gate confidence at decision time */
  gateConfidence: number;
  /** Did the user agree with the decision? (allowed = they disagreed) */
  userAgreed: boolean;
  /** The category of the blocked element */
  category: AICategory;
  /** When this calibration was recorded */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// SITE POLICY TYPES
// ═══════════════════════════════════════════════════════════════

/** Per-site policy overrides */
export interface SitePolicy {
  /** The domain this policy applies to */
  domain: string;
  /** Override the global mode for this site */
  mode: ShieldMode | 'use-global';
  /** Per-category overrides: 'allow' = never block, 'block' = always block, 'default' = use mode */
  categoryOverrides: Partial<Record<AICategory, 'allow' | 'block' | 'default'>>;
  /** User-added custom CSS selectors to block */
  customBlockSelectors: string[];
  /** User-added custom CSS selectors to always allow */
  customAllowSelectors: string[];
  /** User-added domains to block at network level */
  customBlockDomains: string[];
  /** When this policy was last updated */
  lastUpdated: number;
}

/** Global settings */
export interface GlobalSettings {
  /** The active mode across all sites (unless overridden per-site) */
  mode: ShieldMode;
  /** Which categories are enabled for detection */
  enabledCategories: Record<AICategory, boolean>;
  /** Whether to show a notification when AI is first detected on a site */
  showNotifications: boolean;
  /** Whether to auto-update filter lists */
  autoUpdateFilterLists: boolean;
  /** How often to check for filter list updates (hours) */
  filterListUpdateInterval: number;
  /** Whether the extension is enabled globally */
  enabled: boolean;
  /** Whether debug logging is enabled */
  debugLogging: boolean;
  /** The detection sensitivity: 0.0 = low (fewer false positives) to 1.0 = high (catches more AI) */
  sensitivity: number;
}

/** Default global settings */
export const DEFAULT_SETTINGS: GlobalSettings = {
  mode: 'sentry',
  enabledCategories: {
    chat_widget: true,
    search_overlay: true,
    content_injector: true,
    social_feature: true,
    popup: true,
    tracker: true,
  },
  showNotifications: true,
  autoUpdateFilterLists: true,
  filterListUpdateInterval: 24,
  enabled: true,
  debugLogging: false,
  sensitivity: 0.5,
};

// ═══════════════════════════════════════════════════════════════
// STATS TYPES
// ═══════════════════════════════════════════════════════════════

/** Block statistics — tracks what's been detected and blocked */
export interface BlockStats {
  /** Total AI elements detected (all time) */
  totalDetected: number;
  /** Total AI elements blocked (all time) */
  totalBlocked: number;
  /** Total AI elements flagged (sentry mode, all time) */
  totalFlagged: number;
  /** Per-category counts */
  byCategory: Record<AICategory, { detected: number; blocked: number; flagged: number }>;
  /** Per-site counts (domain → stats) */
  bySite: Record<string, { detected: number; blocked: number; flagged: number }>;
  /** Number of user overrides (user allowed a blocked element) */
  userOverrides: number;
  /** Detection accuracy (user agreed / total decisions with feedback) */
  accuracy: number;
  /** When stats were last reset */
  lastReset: number;
}

/** Default empty stats */
export const DEFAULT_STATS: BlockStats = {
  totalDetected: 0,
  totalBlocked: 0,
  totalFlagged: 0,
  byCategory: {
    chat_widget: { detected: 0, blocked: 0, flagged: 0 },
    search_overlay: { detected: 0, blocked: 0, flagged: 0 },
    content_injector: { detected: 0, blocked: 0, flagged: 0 },
    social_feature: { detected: 0, blocked: 0, flagged: 0 },
    popup: { detected: 0, blocked: 0, flagged: 0 },
    tracker: { detected: 0, blocked: 0, flagged: 0 },
  },
  bySite: {},
  userOverrides: 0,
  accuracy: 1,
  lastReset: Date.now(),
};

// ═══════════════════════════════════════════════════════════════
// SESSION TYPES
// ═══════════════════════════════════════════════════════════════

/** Per-tab session state — tracks what's been detected on the current page */
export interface TabSession {
  /** Tab ID */
  tabId: number;
  /** The domain of the current page */
  domain: string;
  /** Detection results for this page */
  detections: DetectionResult[];
  /** Block decisions for this page */
  decisions: BlockDecision[];
  /** Current mode applied (global or site-specific) */
  effectiveMode: ShieldMode;
  /** Number of elements currently blocked on this page */
  blockedCount: number;
  /** Number of elements currently flagged on this page */
  flaggedCount: number;
  /** Whether the page has been fully scanned */
  scanned: boolean;
  /** When this session was created */
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// ANOMALY TYPES
// ═══════════════════════════════════════════════════════════════

/** An anomaly report — something on this page is acting like AI even though we have no rule for it */
export interface AnomalyReport {
  /** What makes this anomalous */
  description: string;
  /** How anomalous — 0 = slightly unusual, 1 = extremely AI-like behavior */
  anomalyScore: number;
  /** Which AI category this anomaly most likely belongs to */
  likelyCategory: AICategory;
  /** The specific signals that triggered this anomaly */
  signals: string[];
  /** The DOM element showing anomalous behavior (if identified) */
  element?: Element;
  /** When this anomaly was detected */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE PROTOCOL (Content ↔ Background)
// ═══════════════════════════════════════════════════════════════

/** Messages from content script to background */
export type ContentToBackgroundMessage =
  | { type: 'DETECTION_RESULT'; data: DetectionResult }
  | { type: 'REQUEST_SETTINGS' }
  | { type: 'REQUEST_SITE_POLICY'; data: { domain: string } }
  | { type: 'USER_ACTION'; data: { detectionId: string; action: 'allow' | 'block' | 'dismiss' } }
  | { type: 'REQUEST_STATS' }
  | { type: 'PAGE_SCANNED'; data: { domain: string; detectionCount: number; blockedCount: number; flaggedCount: number } }
  | { type: 'ANOMALY_DETECTED'; data: AnomalyReport };

/** Messages from background to content script */
export type BackgroundToContentMessage =
  | { type: 'SETTINGS_UPDATE'; data: GlobalSettings }
  | { type: 'SITE_POLICY_UPDATE'; data: SitePolicy }
  | { type: 'BLOCK_ELEMENT'; data: { detectionId: string; action: BlockAction } }
  | { type: 'UNBLOCK_ELEMENT'; data: { detectionId: string } }
  | { type: 'MODE_CHANGE'; data: { mode: ShieldMode } }
  | { type: 'CATEGORY_TOGGLE'; data: { category: AICategory; enabled: boolean } };

/** Messages from popup to background */
export type PopupToBackgroundMessage =
  | { type: 'GET_CURRENT_TAB_STATE' }
  | { type: 'SET_MODE'; data: { mode: ShieldMode } }
  | { type: 'SET_SITE_MODE'; data: { domain: string; mode: ShieldMode | 'use-global' } }
  | { type: 'TOGGLE_CATEGORY'; data: { category: AICategory; enabled: boolean } }
  | { type: 'TOGGLE_SITE_CATEGORY'; data: { domain: string; category: AICategory; action: 'allow' | 'block' | 'default' } }
  | { type: 'USER_OVERRIDE'; data: { detectionId: string; allow: boolean } }
  | { type: 'GET_SETTINGS' }
  | { type: 'GET_STATS' }
  | { type: 'RESET_STATS' }
  | { type: 'TOGGLE_ENABLED' }
  | { type: 'ADD_CUSTOM_RULE'; data: { domain: string; type: 'block' | 'allow'; selector: string } }
  | { type: 'REMOVE_CUSTOM_RULE'; data: { domain: string; type: 'block' | 'allow'; selector: string } }
  | { type: 'EXPORT_SETTINGS' }
  | { type: 'IMPORT_SETTINGS'; data: string };
