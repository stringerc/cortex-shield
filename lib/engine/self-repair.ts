/**
 * SelfRepair — Auto-calibration from user feedback
 *
 * Takes calibration entries as input and adjusts detection vector weights
 * when accuracy drifts. This is the feedback loop that makes CortexShield
 * adaptive rather than static.
 *
 * When users override our decisions, that's a calibration signal:
 *   - User allowed something we blocked → we were oversensitive on that vector
 *   - User blocked something we missed   → we were undersensitive on that vector
 *
 * Each cycle adjusts weights by CALIBRATION_WEIGHT_ADJUSTMENT per vector.
 * Only runs when MIN_CALIBRATION_ENTRIES reached.
 *
 * Category 4 protection: never modifies engine thresholds or constants.
 * Only Category 1-3 (calibration, strategy, narrative) are auto-repaired.
 */

import type { CalibrationEntry, AICategory } from '../shared/types';
import { ALL_CATEGORIES } from '../shared/types';

import {
  MIN_CALIBRATION_ENTRIES,
  MAX_CALIBRATION_ENTRIES,
  CALIBRATION_WEIGHT_ADJUSTMENT,
  CALIBRATION_DRIFT_THRESHOLD,
  DEFAULT_VECTOR_WEIGHTS,
} from '../shared/constants';

import { clamp } from '../shared/utils';

// ── Types ──────────────────────────────────────────────────────────

/** The result of a self-repair cycle */
export interface SelfRepairResult {
  /** Whether any weights were actually adjusted */
  adjusted: boolean;
  /** Description of what was adjusted and why */
  description: string;
  /** The weights before adjustment */
  previousWeights: Record<string, number>;
  /** The weights after adjustment */
  newWeights: Record<string, number>;
  /** Per-vector adjustment details */
  adjustments: VectorAdjustment[];
}

/** A single vector's adjustment */
export interface VectorAdjustment {
  /** Which detection vector was adjusted */
  source: string;
  /** Direction of adjustment */
  direction: 'increase' | 'decrease' | 'none';
  /** The amount of adjustment (absolute) */
  amount: number;
  /** Why this adjustment was made */
  reason: string;
}

/** Per-category accuracy stats derived from calibration entries */
export interface CategoryAccuracy {
  category: AICategory;
  /** How often users agreed with our decisions for this category */
  accuracy: number;
  /** How many calibration entries we have for this category */
  sampleSize: number;
  /** Whether this category is oversensitive (users override blocks) */
  oversensitive: boolean;
  /** Whether this category is undersensitive (users block missed items) */
  undersensitive: boolean;
}

// ── Self-Repair Engine ─────────────────────────────────────────────

/**
 * Run self-repair on detection vector weights based on calibration data.
 *
 * For each recent calibration entry, we track whether the user agreed
 * with the gate's decision. When accuracy drifts for a category, we
 * adjust the weight of the vectors that contributed to that category.
 *
 * The adjustment is conservative: CALIBRATION_WEIGHT_ADJUSTMENT per cycle.
 * This prevents wild swings from a small number of overrides.
 *
 * Category 4 rule: engine thresholds and constants are never modified here.
 * Only vector weights (Category 1: calibration) are adjusted.
 */
export function runSelfRepair(
  calibration: CalibrationEntry[],
  currentWeights: Record<string, number>,
): SelfRepairResult {
  const result: SelfRepairResult = {
    adjusted: false,
    description: 'No adjustment needed',
    previousWeights: { ...currentWeights },
    newWeights: { ...currentWeights },
    adjustments: [],
  };

  // Don't run if we don't have enough calibration data
  const recentCalibration = calibration.slice(-MAX_CALIBRATION_ENTRIES);
  if (recentCalibration.length < MIN_CALIBRATION_ENTRIES) {
    result.description = `Insufficient calibration data (${recentCalibration.length}/${MIN_CALIBRATION_ENTRIES} entries)`;
    return result;
  }

  // Calculate per-category accuracy
  const categoryAccuracies = calculateCategoryAccuracy(recentCalibration);

  // Check overall calibration drift
  const overallAccuracy = recentCalibration.filter(e => e.userAgreed).length / recentCalibration.length;
  const overallDrift = 1 - overallAccuracy;

  if (overallDrift < CALIBRATION_DRIFT_THRESHOLD) {
    result.description = `Calibration drift ${Math.round(overallDrift * 100)}% is within threshold ${Math.round(CALIBRATION_DRIFT_THRESHOLD * 100)}% — no adjustment needed`;
    return result;
  }

  // Identify which categories have accuracy problems
  const problemCategories = categoryAccuracies.filter(
    ca => ca.sampleSize >= 3 && (ca.oversensitive || ca.undersensitive),
  );

  if (problemCategories.length === 0) {
    result.description = `Overall drift detected (${Math.round(overallDrift * 100)}%) but no specific category has enough samples to adjust`;
    return result;
  }

  // Adjust vector weights based on problem categories
  const newWeights = { ...currentWeights };
  const adjustments: VectorAdjustment[] = [];

  for (const vectorSource of Object.keys(DEFAULT_VECTOR_WEIGHTS)) {
    const adjustment = calculateVectorAdjustment(
      vectorSource,
      problemCategories,
      currentWeights[vectorSource] ?? DEFAULT_VECTOR_WEIGHTS[vectorSource],
    );

    if (adjustment.direction !== 'none' && adjustment.amount > 0) {
      const current = newWeights[vectorSource] ?? DEFAULT_VECTOR_WEIGHTS[vectorSource];
      if (adjustment.direction === 'increase') {
        newWeights[vectorSource] = clamp(current + adjustment.amount, 0.01, 0.60);
      } else {
        newWeights[vectorSource] = clamp(current - adjustment.amount, 0.01, 0.60);
      }
      adjustments.push(adjustment);
    }
  }

  // Re-normalize weights to sum to 1.0
  const totalWeight = Object.values(newWeights).reduce((sum, w) => sum + w, 0);
  if (totalWeight > 0) {
    for (const key of Object.keys(newWeights)) {
      newWeights[key] = newWeights[key] / totalWeight;
    }
  }

  if (adjustments.length > 0) {
    result.adjusted = true;
    result.description = buildDescription(adjustments, overallDrift);
    result.newWeights = newWeights;
    result.adjustments = adjustments;
  }

  return result;
}

/**
 * Calculate per-category accuracy from calibration entries.
 */
function calculateCategoryAccuracy(calibration: CalibrationEntry[]): CategoryAccuracy[] {
  const categoryData = new Map<AICategory, { agreed: number; total: number; overrides: number }>();

  for (const entry of calibration) {
    const existing = categoryData.get(entry.category) ?? { agreed: 0, total: 0, overrides: 0 };
    existing.total++;
    if (entry.userAgreed) {
      existing.agreed++;
    } else {
      existing.overrides++;
    }
    categoryData.set(entry.category, existing);
  }

  return ALL_CATEGORIES.map(category => {
    const data = categoryData.get(category) ?? { agreed: 0, total: 0, overrides: 0 };
    const accuracy = data.total > 0 ? data.agreed / data.total : 1;
    return {
      category,
      accuracy,
      sampleSize: data.total,
      oversensitive: data.total > 0 && accuracy < 0.5 && data.overrides > data.agreed,
      undersensitive: data.total > 0 && accuracy < 0.5 && data.agreed > data.overrides,
    };
  });
}

/**
 * Calculate the adjustment for a single detection vector.
 *
 * Logic:
 *   - If most problem categories are oversensitive → decrease weight
 *     (we're catching too many false positives)
 *   - If most problem categories are undersensitive → increase weight
 *     (we're missing real AI)
 *   - Mixed signals → small adjustment in the dominant direction
 *
 * The amount is fixed at CALIBRATION_WEIGHT_ADJUSTMENT per cycle,
 * scaled by how many problem categories agree on the direction.
 */
function calculateVectorAdjustment(
  vectorSource: string,
  problemCategories: CategoryAccuracy[],
  currentWeight: number,
): VectorAdjustment {
  let oversensitiveCount = 0;
  let undersensitiveCount = 0;

  for (const cat of problemCategories) {
    if (cat.oversensitive) oversensitiveCount++;
    if (cat.undersensitive) undersensitiveCount++;
  }

  // Determine direction based on majority of problem categories
  if (oversensitiveCount > undersensitiveCount) {
    // We're too aggressive → decrease all vector weights slightly
    // Some vectors are more likely to cause false positives depending on category
    const scale = getVectorSensitivityScale(vectorSource, problemCategories, 'oversensitive');
    return {
      source: vectorSource,
      direction: 'decrease',
      amount: CALIBRATION_WEIGHT_ADJUSTMENT * scale,
      reason: `Reducing sensitivity: ${oversensitiveCount} categories oversensitive (current weight: ${currentWeight.toFixed(3)})`,
    };
  }

  if (undersensitiveCount > oversensitiveCount) {
    // We're missing real AI → increase all vector weights slightly
    const scale = getVectorSensitivityScale(vectorSource, problemCategories, 'undersensitive');
    return {
      source: vectorSource,
      direction: 'increase',
      amount: CALIBRATION_WEIGHT_ADJUSTMENT * scale,
      reason: `Increasing sensitivity: ${undersensitiveCount} categories undersensitive (current weight: ${currentWeight.toFixed(3)})`,
    };
  }

  return {
    source: vectorSource,
    direction: 'none',
    amount: 0,
    reason: 'Mixed calibration signals — no adjustment for this vector',
  };
}

/**
 * Get a scaling factor for how much a vector should be adjusted
 * based on which categories have problems.
 *
 * Vectors that are more relevant to a problem category get
 * larger adjustments. For example, if chat_widget is oversensitive,
 * the 'network' vector (which catches chat APIs) gets a larger
 * decrease than 'dom' (which catches visual elements).
 */
function getVectorSensitivityScale(
  vectorSource: string,
  problemCategories: CategoryAccuracy[],
  direction: 'oversensitive' | 'undersensitive',
): number {
  // Relevance matrix: how relevant each vector is to each category
  // (0 = not relevant, 1 = highly relevant)
  const relevance: Record<string, Record<AICategory, number>> = {
    static: {
      chat_widget: 0.9,
      search_overlay: 0.8,
      content_injector: 0.6,
      social_feature: 0.7,
      popup: 0.8,
      tracker: 0.9,
    },
    network: {
      chat_widget: 0.9,
      search_overlay: 0.7,
      content_injector: 0.5,
      social_feature: 0.4,
      popup: 0.3,
      tracker: 0.8,
    },
    dom: {
      chat_widget: 0.6,
      search_overlay: 0.5,
      content_injector: 0.9,
      social_feature: 0.7,
      popup: 0.8,
      tracker: 0.3,
    },
    runtime: {
      chat_widget: 0.7,
      search_overlay: 0.6,
      content_injector: 0.8,
      social_feature: 0.5,
      popup: 0.4,
      tracker: 0.7,
    },
    behavioral: {
      chat_widget: 0.6,
      search_overlay: 0.5,
      content_injector: 0.4,
      social_feature: 0.8,
      popup: 0.3,
      tracker: 0.2,
    },
  };

  const vectorRelevance = relevance[vectorSource];
  if (!vectorRelevance) return 0.5; // Unknown vector: moderate adjustment

  // Average relevance to problem categories
  const relevantCategories = problemCategories.filter(
    cat => direction === 'oversensitive' ? cat.oversensitive : cat.undersensitive,
  );

  if (relevantCategories.length === 0) return 1.0;

  const avgRelevance = relevantCategories.reduce(
    (sum, cat) => sum + (vectorRelevance[cat.category] ?? 0.5), 0,
  ) / relevantCategories.length;

  // Scale: 0.3 (barely relevant) to 1.5 (highly relevant)
  return clamp(avgRelevance * 1.5, 0.3, 1.5);
}

/**
 * Build a human-readable description of the adjustments made.
 */
function buildDescription(adjustments: VectorAdjustment[], overallDrift: number): string {
  const increased = adjustments.filter(a => a.direction === 'increase');
  const decreased = adjustments.filter(a => a.direction === 'decrease');
  const parts: string[] = [];

  if (overallDrift > 0) {
    parts.push(`Drift: ${Math.round(overallDrift * 100)}%`);
  }
  if (increased.length > 0) {
    parts.push(`Increased: ${increased.map(a => a.source).join(', ')}`);
  }
  if (decreased.length > 0) {
    parts.push(`Decreased: ${decreased.map(a => a.source).join(', ')}`);
  }

  return parts.join(' | ');
}
