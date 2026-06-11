/**
 * CortexShield — Constants & Thresholds
 *
 * All magic numbers live here. Nothing is hardcoded elsewhere.
 * These thresholds are the "architecture" layer — they are NEVER
 * auto-modified by self-repair (Cortex Category 4 rule).
 * Only human operators can change these.
 */

import type { AICategory, ShieldMode } from './types';

// ═══════════════════════════════════════════════════════════════
// ENGINE THRESHOLDS
// ═══════════════════════════════════════════════════════════════

/** When legitimacy score drops below this, we consider it AI */
export const LEGITIMACY_THRESHOLD_AI = 0.50;

/** Below this = definitely AI, block in Guardian mode */
export const LEGITIMACY_THRESHOLD_CRITICAL = 0.25;

/** Below this = likely AI, flag in Sentry mode */
export const LEGITIMACY_THRESHOLD_WARNING = 0.40;

/** Above this = definitely not AI, always ignore */
export const LEGITIMACY_THRESHOLD_SAFE = 0.80;

/** How many detection vectors must agree before we consider it AI */
export const MINIMUM_VECTOR_AGREEMENT = 2;

/** Minimum confidence for a detection to be actionable */
export const MINIMUM_CONFIDENCE = 0.30;

/** The gate's minimum confidence to approve a block */
export const GATE_MINIMUM_BLOCK_CONFIDENCE = 0.60;

// ═══════════════════════════════════════════════════════════════
// ANOMALY THRESHOLDS
// ═══════════════════════════════════════════════════════════════

/** Anomaly score above this = worth flagging */
export const ANOMALY_THRESHOLD_FLAG = 0.60;

/** Anomaly score above this = worth blocking in Guardian */
export const ANOMALY_THRESHOLD_BLOCK = 0.80;

/** How long an anomaly must persist before we flag it (ms) */
export const ANOMALY_PERSIST_DURATION = 5000;

// ═══════════════════════════════════════════════════════════════
// COOLDOWNS — Prevent Detection Thrash
// ═══════════════════════════════════════════════════════════════

/** Don't re-evaluate the same element more often than this (ms) */
export const ELEMENT_RESCAN_COOLDOWN = 10_000;

/** Don't re-flag the same category on the same site more often than this (ms) */
export const CATEGORY_FLAG_COOLDOWN = 60_000;

/** Don't send anomaly notifications more often than this (ms) */
export const ANOMALY_NOTIFICATION_COOLDOWN = 120_000;

/** Minimum time between filter list auto-updates (ms) */
export const FILTER_LIST_UPDATE_COOLDOWN = 86_400_000; // 24 hours

// ═══════════════════════════════════════════════════════════════
// CALIBRATION
// ═══════════════════════════════════════════════════════════════

/** Minimum calibration entries before self-repair adjusts weights */
export const MIN_CALIBRATION_ENTRIES = 5;

/** Maximum calibration entries to keep (rolling window) */
export const MAX_CALIBRATION_ENTRIES = 200;

/** How much to adjust detection weights per calibration cycle (0-1) */
export const CALIBRATION_WEIGHT_ADJUSTMENT = 0.05;

/** When calibration drift exceeds this, trigger self-repair */
export const CALIBRATION_DRIFT_THRESHOLD = 0.25;

// ═══════════════════════════════════════════════════════════════
// DETECTION VECTOR DEFAULT WEIGHTS
// ═══════════════════════════════════════════════════════════════

/** Default weights for the 5 detection vectors (sums to 1.0) */
export const DEFAULT_VECTOR_WEIGHTS: Record<string, number> = {
  static: 0.35,     // Static rules are most reliable — known patterns
  network: 0.25,    // Network interception is strong signal
  dom: 0.20,        // DOM analysis catches dynamic injections
  runtime: 0.15,    // Runtime hooks catch sophisticated AI
  behavioral: 0.05, // Behavioral analysis is novel but lower confidence
};

// ═══════════════════════════════════════════════════════════════
// BEHAVIORAL DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

/** Token streaming interval characteristic of LLM APIs (ms) */
export const AI_STREAM_INTERVAL_MIN = 20;
export const AI_STREAM_INTERVAL_MAX = 200;

/** Number of consecutive streaming intervals before we flag it */
export const AI_STREAM_PATTERN_MIN_LENGTH = 5;

/** WebSocket message size patterns typical of AI chat APIs */
export const AI_WEBSOCKET_MESSAGE_SIZE_MIN = 50;
export const AI_WEBSOCKET_MESSAGE_SIZE_MAX = 500;

/** Rate of DOM mutations characteristic of AI widget injection */
export const AI_WIDGET_MUTATION_BURST = 10; // 10+ mutations in 1 second

// ═══════════════════════════════════════════════════════════════
// KNOWN AI DOMAINS (for network-level detection)
// ═══════════════════════════════════════════════════════════════

export const AI_ENDPOINT_PATTERNS: string[] = [
  '/v1/chat/completions',
  '/v1/completions',
  '/v1/generate',
  '/api/chat',
  '/api/generate',
  '/api/ai',
  '/v1/engines/',
  '/api/v1/predict',
  '/v1/messages',
  '/chat/completions',
  '/v1/responses',
];

export const AI_DOMAIN_INDICATORS: string[] = [
  'openai.com',
  'api.openai.com',
  'chat.openai.com',
  'anthropic.com',
  'api.anthropic.com',
  'googleapis.com/generative',
  'generativelanguage.googleapis.com',
  'copilot.microsoft.com',
  'builder.embed.chatgpt.com',
  'cdn.mosaicagent.com',
  'api.mistral.ai',
  'api.perplexity.ai',
  'api.cohere.ai',
];

// ═══════════════════════════════════════════════════════════════
// UI CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Placeholder box styles — the "white box" that replaces blocked AI */
export const PLACEHOLDER_STYLES = {
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  border: '2px dashed #cbd5e1',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontSize: '12px',
  color: '#64748b',
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  padding: '12px 16px',
  textAlign: 'center' as const,
  lineHeight: '1.4',
  userSelect: 'none' as const,
};

/** Flag border styles — the yellow border in Sentry mode */
export const FLAG_STYLES = {
  outline: '2px solid #f59e0b',
  outlineOffset: '-2px',
  position: 'relative' as const,
};

/** CSS class names injected into the page */
export const CSS_CLASSES = {
  blocked: 'cortex-shield-blocked',
  placeholder: 'cortex-shield-placeholder',
  flagged: 'cortex-shield-flagged',
  flagBadge: 'cortex-shield-flag-badge',
  container: 'cortex-shield-container',
  hidden: 'cortex-shield-hidden',
};

// ═══════════════════════════════════════════════════════════════
// STORAGE KEYS
// ═══════════════════════════════════════════════════════════════

export const STORAGE_KEYS = {
  settings: 'cortex_shield_settings',
  sitePolicies: 'cortex_shield_site_policies',
  stats: 'cortex_shield_stats',
  calibration: 'cortex_shield_calibration',
  vectorWeights: 'cortex_shield_vector_weights',
  lastFilterListUpdate: 'cortex_shield_last_filter_update',
  onboardingComplete: 'cortex_shield_onboarding_complete',
  FILTER_CACHE: 'cortex_shield_filter_cache',
  FILTER_LAST_CHECK: 'cortex_shield_filter_last_check',
} as const;

// ═══════════════════════════════════════════════════════════════
// MODE ICONS & COLORS
// ═══════════════════════════════════════════════════════════════

export const MODE_CONFIG: Record<ShieldMode, { label: string; color: string; icon: string; description: string }> = {
  ghost: {
    label: 'Ghost',
    color: '#6b7280',
    icon: '👻',
    description: 'Detects AI silently. Logs stats but never shows UI changes.',
  },
  sentry: {
    label: 'Sentry',
    color: '#3b82f6',
    icon: '🛡️',
    description: 'Detects and flags AI with yellow borders. You choose what to block.',
  },
  guardian: {
    label: 'Guardian',
    color: '#ef4444',
    icon: '🛑',
    description: 'Auto-blocks AI elements. You see placeholder boxes. Click to allow.',
  },
};
