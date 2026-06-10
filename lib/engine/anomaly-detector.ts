/**
 * AnomalyDetector — Detects AI that doesn't match any known rule
 *
 * Adapted from MetacognitiveState.freeEnergy concept:
 * "Something on this page is acting like AI but I don't recognize it."
 *
 * Signals monitored:
 *   - Unusual streaming patterns (token intervals unlike known AI)
 *   - Unknown WebSocket connections (not in AI_DOMAIN_INDICATORS)
 *   - Unexpected DOM mutation bursts (rapid widget injection)
 *   - Unrecognizable AI-like text timing (typing cadence)
 *
 * Tallies anomaly signals over time (persists across scans of same page).
 * Requires ANOMALY_PERSIST_DURATION before flagging to avoid false positives
 * from brief anomalies (page loading, tab switching, etc.).
 *
 * Reports: AnomalyReport when anomaly score exceeds threshold.
 * likelyCategory: determined by closest matching behavioral signature.
 */

import type { DetectionVector, AnomalyReport, AICategory } from '../shared/types';

import {
  ANOMALY_THRESHOLD_FLAG,
  ANOMALY_PERSIST_DURATION,
  AI_STREAM_INTERVAL_MIN,
  AI_STREAM_INTERVAL_MAX,
  AI_STREAM_PATTERN_MIN_LENGTH,
  AI_WIDGET_MUTATION_BURST,
  AI_WEBSOCKET_MESSAGE_SIZE_MIN,
  AI_WEBSOCKET_MESSAGE_SIZE_MAX,
  AI_ENDPOINT_PATTERNS,
  AI_DOMAIN_INDICATORS,
} from '../shared/constants';

import { clamp } from '../shared/utils';

// ── Types ──────────────────────────────────────────────────────────

/** A single anomaly signal observed during a scan */
export interface AnomalySignal {
  /** What type of anomaly was observed */
  type: 'streaming' | 'websocket' | 'dom_burst' | 'text_timing' | 'network_endpoint';
  /** How strong this signal is (0-1) */
  strength: number;
  /** Description of the observation */
  description: string;
  /** When this signal was first observed */
  firstSeen: number;
  /** When this signal was last observed */
  lastSeen: number;
  /** How many times this signal has been observed */
  count: number;
}

/** Behavioral signatures mapped to likely AI categories */
const BEHAVIORAL_SIGNATURES: Record<string, AICategory> = {
  streaming: 'chat_widget',
  websocket: 'chat_widget',
  dom_burst: 'content_injector',
  text_timing: 'content_injector',
  network_endpoint: 'tracker',
};

// ── Detector ───────────────────────────────────────────────────────

export class AnomalyDetector {
  /** Accumulated signals for the current page, keyed by signal type + evidence */
  private signals = new Map<string, AnomalySignal>();

  /** When the current page monitoring started */
  private pageStartTime = Date.now();

  /** The last anomaly report emitted (to avoid duplicate reports) */
  private lastReport: AnomalyReport | null = null;

  /**
   * Evaluate detection vectors for anomalies.
   * Returns an AnomalyReport if anomaly score exceeds threshold,
   * or null if no anomaly is detected.
   */
  evaluate(vectors: DetectionVector[], element?: Element): AnomalyReport | null {
    // Process each vector for anomaly signals
    for (const vector of vectors) {
      this.processVector(vector);
    }

    // Calculate composite anomaly score
    const anomalyScore = this.calculateAnomalyScore();

    // Check persistence — anomaly must have been present for ANOMALY_PERSIST_DURATION
    if (!this.hasPersistedLongEnough()) {
      return null;
    }

    // Only report if score exceeds flag threshold
    if (anomalyScore < ANOMALY_THRESHOLD_FLAG) {
      return null;
    }

    // Build the report
    const signals = Array.from(this.signals.values());
    const activeSignals = signals.filter(s => s.strength > 0.1);
    const likelyCategory = this.determineLikelyCategory(activeSignals);

    const report: AnomalyReport = {
      description: this.buildDescription(anomalyScore, activeSignals),
      anomalyScore,
      likelyCategory,
      signals: activeSignals.map(s => s.description),
      element,
      timestamp: Date.now(),
    };

    // Avoid emitting the same report twice
    if (this.lastReport && this.isDuplicateReport(report)) {
      return null;
    }

    this.lastReport = report;
    return report;
  }

  /**
   * Process a single detection vector for anomaly signals.
   */
  private processVector(vector: DetectionVector): void {
    const now = Date.now();

    switch (vector.source) {
      case 'network':
        this.processNetworkAnomalies(vector, now);
        break;
      case 'dom':
        this.processDOMAnomalies(vector, now);
        break;
      case 'behavioral':
        this.processBehavioralAnomalies(vector, now);
        break;
      case 'runtime':
        this.processRuntimeAnomalies(vector, now);
        break;
      case 'static':
        // Static rules don't produce anomalies — known patterns are not anomalous
        break;
    }
  }

  /**
   * Network anomalies: requests to domains/paths not in our known lists
   * but showing AI-like behavior patterns.
   */
  private processNetworkAnomalies(vector: DetectionVector, now: number): void {
    for (const evidence of vector.evidence) {
      // Check if this is an unrecognized endpoint that behaves like AI
      const isKnownAI = AI_DOMAIN_INDICATORS.some(d => evidence.includes(d))
        || AI_ENDPOINT_PATTERNS.some(p => evidence.includes(p));

      if (!isKnownAI && vector.score > 0.5) {
        // Unknown domain with AI-like behavior = anomaly
        const key = `network:unknown:${evidence.slice(0, 50)}`;
        this.updateSignal(key, 'network_endpoint', vector.score, now,
          `Unknown endpoint with AI-like behavior: ${evidence.slice(0, 80)}`);
      }

      // Check WebSocket patterns in evidence
      if (evidence.toLowerCase().includes('websocket') || evidence.toLowerCase().includes('ws:')) {
        const isKnownWS = AI_DOMAIN_INDICATORS.some(d => evidence.includes(d));
        if (!isKnownWS && vector.score > 0.3) {
          // AI chat APIs typically send messages in the
          // AI_WEBSOCKET_MESSAGE_SIZE_MIN to AI_WEBSOCKET_MESSAGE_SIZE_MAX range
          const sizeIndicator = evidence.includes('size:')
            && (() => {
              const sizeMatch = evidence.match(/size:(\d+)/);
              if (sizeMatch) {
                const size = parseInt(sizeMatch[1], 10);
                return size >= AI_WEBSOCKET_MESSAGE_SIZE_MIN
                  && size <= AI_WEBSOCKET_MESSAGE_SIZE_MAX;
              }
              return false;
            })();
          const wsScore = sizeIndicator ? vector.score * 1.2 : vector.score;
          const key = `network:ws:unknown`;
          this.updateSignal(key, 'websocket', clamp(wsScore, 0, 1), now,
            `Unknown WebSocket with AI-like message patterns (${AI_WEBSOCKET_MESSAGE_SIZE_MIN}-${AI_WEBSOCKET_MESSAGE_SIZE_MAX} byte range)`);
        }
      }
    }
  }

  /**
   * DOM anomalies: mutation bursts that exceed typical widget injection rate
   * but don't match known CSS selectors.
   */
  private processDOMAnomalies(vector: DetectionVector, now: number): void {
    for (const evidence of vector.evidence) {
      const lower = evidence.toLowerCase();

      // Check for mutation burst patterns (10+ mutations/second = AI widget injection)
      if (lower.includes('mutation') || lower.includes('burst')) {
        const mutationMatch = evidence.match(/(\d+)\s*mutation/);
        const mutationCount = mutationMatch ? parseInt(mutationMatch[1], 10) : 0;
        const isBurstRate = mutationCount >= AI_WIDGET_MUTATION_BURST;
        const burstScore = isBurstRate ? vector.score * 0.9 : vector.score * 0.8;
        if (burstScore > 0.3) {
          const key = 'dom:mutation_burst';
          this.updateSignal(key, 'dom_burst', burstScore, now,
            `Unusual DOM mutation burst detected (${AI_WIDGET_MUTATION_BURST}+ mutations/second pattern)`);
        }
      }

      // Check for shadow DOM or iframe injection that doesn't match rules
      if (lower.includes('shadow') || lower.includes('iframe')) {
        if (vector.score > 0.4) {
          const key = 'dom:shadow_injection';
          this.updateSignal(key, 'dom_burst', vector.score * 0.6, now,
            'Shadow DOM or iframe injection without matching static rule');
        }
      }

      // Dynamic content insertion
      if (lower.includes('insert') || lower.includes('append') || lower.includes('inject')) {
        if (vector.score > 0.5) {
          const key = 'dom:dynamic_inject';
          this.updateSignal(key, 'dom_burst', vector.score * 0.5, now,
            'Dynamic content injection not matching known AI widgets');
        }
      }
    }
  }

  /**
   * Behavioral anomalies: streaming/text timing patterns that look AI-like
   * but don't match known AI product signatures.
   */
  private processBehavioralAnomalies(vector: DetectionVector, now: number): void {
    for (const evidence of vector.evidence) {
      const lower = evidence.toLowerCase();

      // Check for streaming patterns with unusual timing
      if (lower.includes('stream') || lower.includes('token')) {
        const streamScore = vector.score * 0.7;
        if (streamScore > 0.3) {
          const key = 'behavioral:streaming';
          this.updateSignal(key, 'streaming', streamScore, now,
            `Streaming pattern detected (${AI_STREAM_INTERVAL_MIN}-${AI_STREAM_INTERVAL_MAX}ms intervals, ${AI_STREAM_PATTERN_MIN_LENGTH}+ consecutive)`);
        }
      }

      // Check for AI-like text timing (typed-out appearance)
      if (lower.includes('timing') || lower.includes('typing') || lower.includes('cadence')) {
        if (vector.score > 0.4) {
          const key = 'behavioral:text_timing';
          this.updateSignal(key, 'text_timing', vector.score * 0.6, now,
            'AI-like text display timing detected (uniform character intervals)');
        }
      }

      // Check for response patterns (question → answer cadence)
      if (lower.includes('response') || lower.includes('answer')) {
        if (vector.score > 0.5) {
          const key = 'behavioral:qa_pattern';
          this.updateSignal(key, 'streaming', vector.score * 0.5, now,
            'Question-answer interaction pattern detected on page');
        }
      }
    }
  }

  /**
   * Runtime anomalies: window.ai usage, fetch/XHR hooks, postMessage
   * patterns that suggest AI integration but aren't in filter lists.
   */
  private processRuntimeAnomalies(vector: DetectionVector, now: number): void {
    for (const evidence of vector.evidence) {
      const lower = evidence.toLowerCase();

      // window.ai or navigator.ai usage
      if (lower.includes('window.ai') || lower.includes('navigator.ai')) {
        const key = 'runtime:window_ai';
        this.updateSignal(key, 'network_endpoint', vector.score, now,
          'Browser AI API access detected (window.ai / navigator.ai)');
      }

      // Unusual fetch/XHR patterns to AI-like endpoints
      if (lower.includes('fetch') || lower.includes('xhr')) {
        if (vector.score > 0.4) {
          const key = `runtime:fetch:${evidence.slice(0, 40)}`;
          this.updateSignal(key, 'network_endpoint', vector.score * 0.6, now,
            `Runtime fetch/XHR pattern suggesting AI integration: ${evidence.slice(0, 80)}`);
        }
      }

      // postMessage patterns typical of AI widget communication
      if (lower.includes('postmessage')) {
        if (vector.score > 0.3) {
          const key = 'runtime:postmessage';
          this.updateSignal(key, 'websocket', vector.score * 0.5, now,
            'Cross-frame postMessage communication pattern suggesting AI widget');
        }
      }
    }
  }

  /**
   * Update or create a signal entry.
   */
  private updateSignal(
    key: string,
    type: AnomalySignal['type'],
    strength: number,
    now: number,
    description: string,
  ): void {
    const existing = this.signals.get(key);
    if (existing) {
      existing.strength = clamp(Math.max(existing.strength, strength), 0, 1);
      existing.lastSeen = now;
      existing.count++;
    } else {
      this.signals.set(key, {
        type,
        strength: clamp(strength, 0, 1),
        description,
        firstSeen: now,
        lastSeen: now,
        count: 1,
      });
    }
  }

  /**
   * Calculate composite anomaly score from all active signals.
   * Uses exponential decay — recent signals count more than stale ones.
   * Strength is boosted when multiple signal types agree.
   */
  private calculateAnomalyScore(): number {
    const now = Date.now();
    let totalScore = 0;
    const typeScores = new Map<AnomalySignal['type'], number>();

    for (const signal of this.signals.values()) {
      // Expire signals older than 60 seconds
      if (now - signal.lastSeen > 60_000) continue;

      // Decay: signals lose 1% per second since last observation
      const ageSeconds = (now - signal.lastSeen) / 1000;
      const decay = Math.max(0, 1 - ageSeconds * 0.01);
      const adjustedStrength = signal.strength * decay;

      totalScore += adjustedStrength;

      // Track per-type scores
      const currentType = typeScores.get(signal.type) ?? 0;
      typeScores.set(signal.type, currentType + adjustedStrength);
    }

    // If multiple signal types agree, boost the anomaly score
    const confidentTypes = Array.from(typeScores.values()).filter(s => s > 0.2).length;
    const agreementBoost = confidentTypes >= 3 ? 1.3 : confidentTypes >= 2 ? 1.1 : 1.0;

    // Normalize: max possible is around 5 (one strong signal per type)
    const normalized = clamp((totalScore * agreementBoost) / 3, 0, 1);

    return normalized;
  }

  /**
   * Check whether anomalous signals have persisted long enough
   * to avoid false positives from brief transient events.
   */
  private hasPersistedLongEnough(): boolean {
    const now = Date.now();
    for (const signal of this.signals.values()) {
      const duration = now - signal.firstSeen;
      if (duration >= ANOMALY_PERSIST_DURATION && signal.strength > 0.2) {
        return true;
      }
    }
    return false;
  }

  /**
   * Determine the most likely AI category based on the types
   * of anomaly signals observed. Uses behavioral signatures
   * to map signal types to categories, with majority vote.
   */
  private determineLikelyCategory(signals: AnomalySignal[]): AICategory {
    if (signals.length === 0) return 'popup';

    const categoryVotes: Record<string, number> = {};
    for (const signal of signals) {
      const category = BEHAVIORAL_SIGNATURES[signal.type] ?? 'popup';
      categoryVotes[category] = (categoryVotes[category] ?? 0) + signal.strength;
    }

    let bestCategory: AICategory = 'popup';
    let bestScore = 0;
    for (const [category, score] of Object.entries(categoryVotes)) {
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category as AICategory;
      }
    }

    return bestCategory;
  }

  /**
   * Build a human-readable description of the anomaly.
   */
  private buildDescription(anomalyScore: number, signals: AnomalySignal[]): string {
    const scoreLabel = anomalyScore >= ANOMALY_THRESHOLD_FLAG * 1.3
      ? 'Strong'
      : anomalyScore >= ANOMALY_THRESHOLD_FLAG
        ? 'Moderate'
        : 'Weak';

    const signalTypes = [...new Set(signals.map(s => s.type))];
    const typeDescriptions: Record<AnomalySignal['type'], string> = {
      streaming: 'unusual data streaming',
      websocket: 'unknown WebSocket connections',
      dom_burst: 'rapid DOM mutations',
      text_timing: 'AI-like text timing',
      network_endpoint: 'suspicious network endpoints',
    };

    const observed = signalTypes
      .map(t => typeDescriptions[t])
      .filter(Boolean)
      .join(', ');

    return `${scoreLabel} anomaly detected: ${observed}`;
  }

  /**
   * Check if this report is substantially the same as the last one
   * to avoid emitting duplicates.
   */
  private isDuplicateReport(report: AnomalyReport): boolean {
    if (!this.lastReport) return false;
    return (
      this.lastReport.likelyCategory === report.likelyCategory
      && Math.abs(this.lastReport.anomalyScore - report.anomalyScore) < 0.1
    );
  }

  /**
   * Reset the detector state for a new page.
   */
  reset(): void {
    this.signals.clear();
    this.pageStartTime = Date.now();
    this.lastReport = null;
  }

  /**
   * Get current signal state (for debugging/inspection).
   */
  getSignals(): AnomalySignal[] {
    return Array.from(this.signals.values());
  }
}
