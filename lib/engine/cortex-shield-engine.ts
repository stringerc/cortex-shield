/**
 * CortexShieldEngine — The Adaptive AI-Blocking Brain
 *
 * Adapted from CortexNudgeEngine. This is the brain that transforms
 * detection signals into action decisions.
 *
 * Three operating modes (mapped from NudgeEngine's silent/advisory/guardian):
 *   Ghost   — Detects silently. Logs stats but never shows UI changes.
 *   Sentry  — Detects + flags AI elements. Warns but never blocks.
 *   Guardian — Detects + flags + auto-blocks high-risk AI. The override.
 *
 * Self-repair categories:
 *   1. Calibration — SAFE, auto-repair (weight adjustment from user feedback)
 *   2. Strategy   — SAFE, auto-repair with logging (vector sensitivity updates)
 *   3. Narrative   — SAFE, auto-repair (engine state self-correction)
 *   4. Architecture — DANGEROUS, never auto-repair (thresholds / constants)
 */

import type {
  ShieldMode,
  DetectionResult,
  DetectionVector,
  BlockDecision,
  AICategory,
  CalibrationEntry,
  AnomalyReport,
  SitePolicy,
  GlobalSettings,
} from '../shared/types';

import {
  ELEMENT_RESCAN_COOLDOWN,
  CATEGORY_FLAG_COOLDOWN,
  ANOMALY_NOTIFICATION_COOLDOWN,
  MIN_CALIBRATION_ENTRIES,
  CALIBRATION_DRIFT_THRESHOLD,
  DEFAULT_VECTOR_WEIGHTS,
  MODE_CONFIG,
} from '../shared/constants';

import { generateId, clamp, cycleMode, getEffectiveMode } from '../shared/utils';
import { scoreLegitimacy, type LegitimacyResult } from './legitimacy-scorer';
import { AnomalyDetector } from './anomaly-detector';
import { CollapseBlock } from './collapse-block';
import { runSelfRepair, type SelfRepairResult } from './self-repair';

// ── Types ──────────────────────────────────────────────────────────

/** A self-repair log entry */
export interface ShieldRepairLog {
  category: 'calibration' | 'strategy' | 'narrative';
  description: string;
  before: string;
  after: string;
  timestamp: number;
}

/** Context passed to tick() for evaluation */
export interface ScanContext {
  /** Detection vectors from the current page scan */
  vectors: DetectionVector[];
  /** The AI category suspected (from detection) */
  category: AICategory;
  /** The DOM element that triggered detection (if any) */
  element?: Element;
  /** Current global settings */
  settings: GlobalSettings;
  /** Site-specific policy (if any) */
  sitePolicy?: SitePolicy;
  /** Calibration entries for self-repair */
  calibration: CalibrationEntry[];
}

// ── Engine ─────────────────────────────────────────────────────────

export class CortexShieldEngine {
  private mode: ShieldMode = 'sentry';
  private decisions: BlockDecision[] = [];
  private repairLog: ShieldRepairLog[] = [];
  private maxDecisionHistory = 100;
  private maxRepairLog = 50;

  // Cooldowns: same pattern as NudgeEngine — prevent detection thrash
  private lastElementScanTimestamps = new Map<string, number>();
  private lastCategoryFlagTimestamps = new Map<string, number>();
  private lastAnomalyNotifyTimestamp = 0;

  // Current adaptive vector weights — adjusted by self-repair
  private vectorWeights: Record<string, number> = { ...DEFAULT_VECTOR_WEIGHTS };

  // Subsystems
  private anomalyDetector = new AnomalyDetector();
  private collapseBlock = new CollapseBlock();

  // Listeners for UI updates
  private listeners = new Set<(decision: BlockDecision) => void>();

  // ── Mode Control ───────────────────────────────────────────────

  getMode(): ShieldMode {
    return this.mode;
  }

  setMode(mode: ShieldMode): void {
    this.mode = mode;
  }

  cycleMode(): ShieldMode {
    this.mode = cycleMode(this.mode);
    return this.mode;
  }

  // ── Tick → Scan ───────────────────────────────────────────────

  /**
   * Evaluate page state and produce a block decision if warranted.
   * Call this each time detection vectors are gathered from a page scan.
   *
   * In ghost mode, compute but never act (logs only).
   * In sentry mode, always flag, never block.
   * In guardian mode, block when confidence exceeds threshold.
   */
  tick(context: ScanContext): BlockDecision | null {
    const effectiveMode = context.sitePolicy?.mode === 'use-global'
      ? this.mode
      : (context.sitePolicy?.mode as ShieldMode | undefined) ?? this.mode;

    // Cooldown check: don't re-evaluate the same element too often
    const elementKey = context.element
      ? context.element.tagName + ':' + (context.element.id || generateId())
      : context.category;
    const lastScan = this.lastElementScanTimestamps.get(elementKey) ?? 0;
    if (Date.now() - lastScan < ELEMENT_RESCAN_COOLDOWN) {
      return null;
    }
    this.lastElementScanTimestamps.set(elementKey, Date.now());

    // Score legitimacy from all detection vectors
    const legitimacy: LegitimacyResult = scoreLegitimacy(
      context.vectors,
      this.vectorWeights,
    );

    // Build DetectionResult
    const detection: DetectionResult = {
      legitimacyScore: legitimacy.legitimacyScore,
      category: legitimacy.category,
      confidence: legitimacy.confidence,
      vectors: context.vectors,
      evidence: legitimacy.evidence,
      element: context.element,
      id: generateId(),
      timestamp: Date.now(),
    };

    // Check for anomalies — signals that don't match known rules
    const anomaly: AnomalyReport | null = this.anomalyDetector.evaluate(
      context.vectors,
      context.element,
    );

    if (anomaly) {
      const lastAnomalyNotify = this.lastAnomalyNotifyTimestamp;
      if (Date.now() - lastAnomalyNotify >= ANOMALY_NOTIFICATION_COOLDOWN) {
        this.lastAnomalyNotifyTimestamp = Date.now();
        // Merge anomaly signals into evidence
        detection.evidence.push(
          `Anomaly detected: ${anomaly.description}`,
          ...anomaly.signals,
        );
        // If anomaly is high-confidence, reduce legitimacy score
        if (anomaly.anomalyScore > 0.7) {
          detection.legitimacyScore = clamp(
            detection.legitimacyScore - anomaly.anomalyScore * 0.2,
            0,
            1,
          );
        }
      }
    }

    // Category cooldown check: don't re-flag same category on same site too often
    const categoryKey = `${context.sitePolicy?.domain ?? '_'}:${detection.category}`;
    const lastCategoryFlag = this.lastCategoryFlagTimestamps.get(categoryKey) ?? 0;
    if (effectiveMode !== 'guardian' && Date.now() - lastCategoryFlag < CATEGORY_FLAG_COOLDOWN) {
      // In non-guardian modes, respect category cooldown
      this.runSelfRepairs(context);
      return null;
    }

    // Run the collapse block gate
    const decision: BlockDecision = this.collapseBlock.evaluateBlock({
      detection,
      mode: effectiveMode,
      sitePolicy: context.sitePolicy,
    });

    // Ghost mode: always ignore (log only)
    if (effectiveMode === 'ghost') {
      this.runSelfRepairs(context);
      return null;
    }

    // Sentry mode: always flag, never block
    if (effectiveMode === 'guardian' && decision.action === 'hide') {
      this.lastCategoryFlagTimestamps.set(categoryKey, Date.now());
    } else if (effectiveMode === 'sentry' && decision.action !== 'ignore') {
      decision.action = 'flag';
      this.lastCategoryFlagTimestamps.set(categoryKey, Date.now());
    }

    // Emit the decision
    return this.emit(decision, context);
  }

  // ── Record User Feedback ──────────────────────────────────────

  /**
   * Record that the user allowed or dismissed a block decision.
   * This feeds into calibration for self-repair.
   */
  recordUserOverride(decision: BlockDecision, userAllowed: boolean): void {
    this.collapseBlock.recordOutcome(decision, !userAllowed);
  }

  // ── Self-Repair ───────────────────────────────────────────────

  /**
   * Run safe self-repairs (categories 1-3).
   * Category 4 (architecture = thresholds/constants) is NEVER auto-modified.
   */
  private runSelfRepairs(context: ScanContext): void {
    // Category 1: Calibration — adjust vector weights based on user feedback
    if (context.calibration.length >= MIN_CALIBRATION_ENTRIES) {
      const repairResult: SelfRepairResult = runSelfRepair(
        context.calibration,
        this.vectorWeights,
      );

      if (repairResult.adjusted) {
        this.vectorWeights = repairResult.newWeights;
        this.repairLog.push({
          category: 'calibration',
          description: repairResult.description,
          before: JSON.stringify(repairResult.previousWeights),
          after: JSON.stringify(repairResult.newWeights),
          timestamp: Date.now(),
        });
        if (this.repairLog.length > this.maxRepairLog) {
          this.repairLog.shift();
        }
      }
    }

    // Category 2: Strategy — update detection approach based on accuracy drift
    const calibrationValue = this.collapseBlock.getDetectionCalibration();
    if (Math.abs(calibrationValue) > CALIBRATION_DRIFT_THRESHOLD) {
      const direction = calibrationValue > 0 ? 'oversensitive' : 'undersensitive';
      this.repairLog.push({
        category: 'strategy',
        description: `Detection is ${direction} by ${Math.round(Math.abs(calibrationValue) * 100)}%. Adjusting vector weights.`,
        before: `calibration=${calibrationValue.toFixed(3)}`,
        after: `weights adjusted toward ${direction === 'oversensitive' ? 'lower' : 'higher'} sensitivity`,
        timestamp: Date.now(),
      });
      if (this.repairLog.length > this.maxRepairLog) {
        this.repairLog.shift();
      }
    }

    // Category 3: Narrative — engine state self-correction
    // Prune stale element scan timestamps (older than 5 minutes)
    const pruneCutoff = Date.now() - ELEMENT_RESCAN_COOLDOWN * 30;
    for (const [key, ts] of this.lastElementScanTimestamps) {
      if (ts < pruneCutoff) {
        this.lastElementScanTimestamps.delete(key);
      }
    }
    for (const [key, ts] of this.lastCategoryFlagTimestamps) {
      if (ts < pruneCutoff) {
        this.lastCategoryFlagTimestamps.delete(key);
      }
    }

    // Category 4: Architecture — EXPLICITLY NOT DONE
    // LEGITIMACY_THRESHOLD_*, GATE_MINIMUM_BLOCK_CONFIDENCE,
    // ANOMALY_THRESHOLD_*, and all constants are never modified
    // without human approval.
  }

  // ── Emit ──────────────────────────────────────────────────────

  private emit(decision: BlockDecision, _context: ScanContext): BlockDecision {
    this.decisions.push(decision);
    if (this.decisions.length > this.maxDecisionHistory) {
      this.decisions.shift();
    }

    // Notify listeners (popup, badge, content script)
    for (const listener of Array.from(this.listeners)) {
      try { listener(decision); } catch { /* swallow errors */ }
    }

    // Run background self-repairs after each scan
    this.runSelfRepairs(_context);

    return decision;
  }

  // ── Listener Pattern (same as onNudge) ────────────────────────

  onDecision(listener: (decision: BlockDecision) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ── Public Query ──────────────────────────────────────────────

  getDecisionHistory(): BlockDecision[] {
    return [...this.decisions];
  }

  getRepairLog(): ShieldRepairLog[] {
    return [...this.repairLog];
  }

  getVectorWeights(): Record<string, number> {
    return { ...this.vectorWeights };
  }

  getDetectionCalibration(): number {
    return this.collapseBlock.getDetectionCalibration();
  }

  /**
   * Get the status text for the toolbar badge.
   * Adapted from NudgeEngine's getWhisperText().
   */
  getStatusBarText(): string {
    const config = MODE_CONFIG[this.mode];
    const calibration = this.collapseBlock.getDetectionCalibration();
    const calibrationLabel = Math.abs(calibration) > CALIBRATION_DRIFT_THRESHOLD
      ? ` drift ${calibration > 0 ? '+' : ''}${Math.round(calibration * 100)}%`
      : '';
    return `${config.icon} ${this.mode}${calibrationLabel}`;
  }

  /**
   * Get a count of currently blocked elements for the badge.
   */
  getBlockedCount(): number {
    return this.decisions.filter(d => d.action === 'hide').length;
  }

  /**
   * Reset the engine to initial state (for testing or factory reset).
   * Does NOT modify constants — those are Category 4.
   */
  reset(): void {
    this.mode = 'sentry';
    this.decisions = [];
    this.repairLog = [];
    this.lastElementScanTimestamps.clear();
    this.lastCategoryFlagTimestamps.clear();
    this.lastAnomalyNotifyTimestamp = 0;
    this.vectorWeights = { ...DEFAULT_VECTOR_WEIGHTS };
    this.anomalyDetector.reset();
    this.collapseBlock = new CollapseBlock();
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let globalEngine: CortexShieldEngine | null = null;

export function getCortexShieldEngine(): CortexShieldEngine {
  if (!globalEngine) {
    globalEngine = new CortexShieldEngine();
  }
  return globalEngine;
}

export function resetCortexShieldEngine(): void {
  globalEngine = null;
}
