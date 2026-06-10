/**
 * CollapseBlock — The Block Decision Gate
 *
 * Adapted from CollapseGate. This is the Orchestrated Objective Reduction
 * for AI element blocking decisions.
 *
 * Before blocking any AI element, the gate enforces a collapse:
 * it reduces the "superposition" of possible actions (hide/flag/ignore)
 * to a single verified decision, validates it against mode rules and
 * confidence thresholds, and only then allows the action.
 *
 * Modes:
 *   Guardian — blocks when gateConfidence > GATE_MINIMUM_BLOCK_CONFIDENCE
 *   Sentry   — always flags, never blocks
 *   Ghost    — always ignores (logs only)
 *
 * Calibration:
 *   recordOutcome(blockDecision, userAllowed) — for accuracy tracking
 *   getDetectionCalibration() — same math as getConfidenceCalibration() but
 *     for detection accuracy: whether block decisions match user intent
 *
 * Category 4 rule: core thresholds (GATE_MINIMUM_BLOCK_CONFIDENCE,
 * LEGITIMACY_THRESHOLD_*) are NEVER auto-modified.
 */

import type {
  ShieldMode,
  DetectionResult,
  BlockDecision,
  BlockAction,
  CalibrationEntry,
  SitePolicy,
  AICategory,
} from '../shared/types';

import {
  GATE_MINIMUM_BLOCK_CONFIDENCE,
  LEGITIMACY_THRESHOLD_CRITICAL,
  LEGITIMACY_THRESHOLD_WARNING,
  LEGITIMACY_THRESHOLD_SAFE,
  MINIMUM_CONFIDENCE,
  MAX_CALIBRATION_ENTRIES,
} from '../shared/constants';

// ── Types ──────────────────────────────────────────────────────────

/** Input to the block evaluation */
export interface BlockEvaluationInput {
  /** The detection that triggered evaluation */
  detection: DetectionResult;
  /** The current operating mode */
  mode: ShieldMode;
  /** Site-specific policy overrides (if any) */
  sitePolicy?: SitePolicy;
}

/** Audit log entry for block decisions */
export interface BlockAuditEntry {
  action: BlockAction;
  category: AICategory;
  gateConfidence: number;
  legitimacyScore: number;
  mode: ShieldMode;
  reason: string;
  timestamp: number;
}

// ── CollapseBlock ──────────────────────────────────────────────────

export class CollapseBlock {
  private auditLog: BlockAuditEntry[] = [];
  private calibrationLog: CalibrationEntry[] = [];
  private maxAuditEntries = 100;
  private maxCalibrationEntries = MAX_CALIBRATION_ENTRIES;

  constructor(opts?: { maxAuditEntries?: number; maxCalibrationEntries?: number }) {
    this.maxAuditEntries = opts?.maxAuditEntries ?? 100;
    this.maxCalibrationEntries = opts?.maxCalibrationEntries ?? MAX_CALIBRATION_ENTRIES;
  }

  /**
   * Evaluate whether to block a detected AI element.
   *
   * Same validation pattern as CollapseGate:
   *   1. Check criteria (legitimacy score, confidence, mode rules)
   *   2. Rank options (hide > flag > ignore) by severity
   *   3. Collapse to a single decision
   */
  evaluateBlock(input: BlockEvaluationInput): BlockDecision {
    const { detection, mode, sitePolicy } = input;

    // Step 1: Check site policy overrides
    const categoryOverride = sitePolicy?.categoryOverrides?.[detection.category];

    // Site-level allow override: never block regardless of mode
    if (categoryOverride === 'allow') {
      return this.makeDecision(detection, 'ignore', 1.0, mode, false,
        `ALLOWED by site policy override for ${detection.category}`);
    }

    // Site-level block override: always block regardless of mode
    if (categoryOverride === 'block') {
      return this.makeDecision(detection, 'hide', 1.0, mode, false,
        `BLOCKED by site policy override for ${detection.category}`);
    }

    // Step 2: Mode-based decision rules
    // Ghost mode: always ignore (logs only)
    if (mode === 'ghost') {
      return this.makeDecision(detection, 'ignore', detection.confidence, mode, false,
        'GHOST MODE: Detection logged, no action taken');
    }

    // Step 3: Evaluate gate confidence
    const gateConfidence = this.calculateGateConfidence(detection);

    // Sentry mode: always flag, never block
    if (mode === 'sentry') {
      if (detection.legitimacyScore < LEGITIMACY_THRESHOLD_WARNING) {
        return this.makeDecision(detection, 'flag', gateConfidence, mode, false,
          `SENTRY: AI detected (legitimacy ${Math.round(detection.legitimacyScore * 100)}%) — flagged for user review`);
      }
      return this.makeDecision(detection, 'ignore', gateConfidence, mode, false,
        `SENTRY: Legitimacy ${Math.round(detection.legitimacyScore * 100)}% — above flag threshold`);
    }

    // Guardian mode: block when confidence exceeds threshold
    if (mode === 'guardian') {
      // Critical: definitely AI — block
      if (detection.legitimacyScore < LEGITIMACY_THRESHOLD_CRITICAL
          && gateConfidence >= GATE_MINIMUM_BLOCK_CONFIDENCE) {
        return this.makeDecision(detection, 'hide', gateConfidence, mode, false,
          `GUARDIAN BLOCK: Legitimacy ${Math.round(detection.legitimacyScore * 100)}% (critical), gate confidence ${Math.round(gateConfidence * 100)}%`);
      }

      // Warning: likely AI — flag for review
      if (detection.legitimacyScore < LEGITIMACY_THRESHOLD_WARNING) {
        return this.makeDecision(detection, 'flag', gateConfidence, mode, false,
          `GUARDIAN FLAG: Legitimacy ${Math.round(detection.legitimacyScore * 100)}% (warning) — flagged, not blocked`);
      }

      // Safe: definitely not AI
      if (detection.legitimacyScore >= LEGITIMACY_THRESHOLD_SAFE) {
        return this.makeDecision(detection, 'ignore', gateConfidence, mode, false,
          `GUARDIAN: Legitimacy ${Math.round(detection.legitimacyScore * 100)}% — safe`);
      }

      // Between warning and safe: ambiguous, flag in cautious mode
      if (gateConfidence < MINIMUM_CONFIDENCE) {
        return this.makeDecision(detection, 'ignore', gateConfidence, mode, false,
          `GUARDIAN: Low gate confidence (${Math.round(gateConfidence * 100)}%) — insufficient certainty to act`);
      }

      return this.makeDecision(detection, 'flag', gateConfidence, mode, false,
        `GUARDIAN: Legitimacy ${Math.round(detection.legitimacyScore * 100)}% — ambiguous, flagged`);
    }

    // Fallback (should not reach here, but TypeScript safety)
    return this.makeDecision(detection, 'ignore', 0, mode, false,
      'FALLBACK: No matching mode rule');
  }

  /**
   * Calculate how confident the gate is in making a block decision.
   *
   * This combines the detection's overall confidence with the
   * sharpness of the legitimacy score (how far from the boundary).
   * A clear signal (very low or very high legitimacy) gets higher
   * gate confidence than an ambiguous one.
   */
  private calculateGateConfidence(detection: DetectionResult): number {
    // Base: the detection's own confidence
    const detectionConfidence = detection.confidence;

    // Boundary distance: how far from the 0.5 decision boundary
    // Far from boundary = clear signal = higher gate confidence
    const boundary = 0.5;
    const distanceFromBoundary = Math.abs(detection.legitimacyScore - boundary);
    const boundaryClarity = distanceFromBoundary * 2; // Scale 0-1

    // Vector agreement: more agreeing vectors = higher confidence
    const highScoreVectors = detection.vectors.filter(
      v => v.confidence >= MINIMUM_CONFIDENCE,
    ).length;
    const vectorAgreement = Math.min(highScoreVectors / detection.vectors.length, 1);

    // Weighted combination: detection confidence is primary,
    // boundary clarity and agreement amplify it
    const gateConfidence = (
      detectionConfidence * 0.5
      + boundaryClarity * 0.3
      + vectorAgreement * 0.2
    );

    return Math.max(0, Math.min(1, gateConfidence));
  }

  /**
   * Make a block decision and log it.
   */
  private makeDecision(
    detection: DetectionResult,
    action: BlockAction,
    gateConfidence: number,
    mode: ShieldMode,
    userOverrode: boolean,
    reason: string,
  ): BlockDecision {
    const decision: BlockDecision = {
      detection,
      action,
      gateConfidence,
      mode,
      userOverrode,
      reason,
      timestamp: Date.now(),
    };

    // Audit log entry
    const auditEntry: BlockAuditEntry = {
      action,
      category: detection.category,
      gateConfidence,
      legitimacyScore: detection.legitimacyScore,
      mode,
      reason,
      timestamp: decision.timestamp,
    };
    this.auditLog.push(auditEntry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.shift();
    }

    return decision;
  }

  /**
   * Record the actual outcome of a block decision.
   * This enables detection calibration — tracking whether our
   * block decisions match user intent.
   *
   * A well-calibrated system has gate confidence that predicts user agreement:
   * decisions made with 0.8 gate confidence should be agreed with ~80% of the time.
   */
  recordOutcome(decision: BlockDecision, userAgreed: boolean): void {
    this.calibrationLog.push({
      gateConfidence: decision.gateConfidence,
      userAgreed,
      category: decision.detection.category,
      timestamp: Date.now(),
    });

    if (this.calibrationLog.length > this.maxCalibrationEntries) {
      this.calibrationLog.shift();
    }
  }

  /**
   * Get detection calibration: does the gate's confidence predict user agreement?
   * Returns a value from -1 to +1:
   *   0  = well-calibrated (confidence matches user agreement rate)
   *   +N = oversensitive (high confidence blocking, but users disagree)
   *   -N = undersensitive (low confidence, but users would have agreed to block)
   *
   * Same math as CollapseGate.getConfidenceCalibration() but applied to
   * detection accuracy instead of action success.
   */
  getDetectionCalibration(): number {
    if (this.calibrationLog.length < 5) return 0;

    const recent = this.calibrationLog.slice(-50);
    const avgConfidence = recent.reduce((sum, e) => sum + e.gateConfidence, 0) / recent.length;
    const userAgreementRate = recent.filter(e => e.userAgreed).length / recent.length;

    // Positive = overconfident (we blocked but users disagreed)
    // Negative = underconfident (users would have blocked but we didn't)
    return avgConfidence - userAgreementRate;
  }

  /**
   * Get calibration curve data: groups decisions by gate confidence bucket
   * and computes actual user agreement rates per bucket.
   */
  getCalibrationCurve(): Array<{ confidenceBucket: number; agreementRate: number; count: number }> {
    if (this.calibrationLog.length === 0) return [];

    const buckets = new Map<number, { agreements: number; total: number }>();

    for (const entry of this.calibrationLog) {
      const bucket = Math.round(entry.gateConfidence * 10) / 10;
      const current = buckets.get(bucket) ?? { agreements: 0, total: 0 };
      current.total++;
      if (entry.userAgreed) current.agreements++;
      buckets.set(bucket, current);
    }

    return Array.from(buckets.entries())
      .map(([bucket, { agreements, total }]) => ({
        confidenceBucket: bucket,
        agreementRate: agreements / total,
        count: total,
      }))
      .sort((a, b) => a.confidenceBucket - b.confidenceBucket);
  }

  /**
   * Get the audit log for debugging/inspection.
   */
  getAuditLog(): BlockAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Get calibration entries for self-repair.
   */
  getCalibrationEntries(): CalibrationEntry[] {
    return [...this.calibrationLog];
  }
}
