/**
 * LegitimacyScorer — Combines all 5 detection vectors into a single score
 *
 * Takes DetectionVector[] as input and returns a composite legitimacy result:
 *   legitimacyScore: 0 = definitely AI (should block), 1 = definitely not AI
 *   category:        determined by majority vote of high-score vectors
 *   confidence:      reduced when vectors disagree
 *   evidence:        aggregated from all contributing vectors
 *
 * Uses adaptive weights (DEFAULT_VECTOR_WEIGHTS by default, adjusted by self-repair).
 * If fewer than MINIMUM_VECTOR_AGREEMENT vectors agree, confidence is reduced.
 */

import type { DetectionVector, AICategory } from '../shared/types';
import { ALL_CATEGORIES, CATEGORY_LABELS } from '../shared/types';

import {
  MINIMUM_VECTOR_AGREEMENT,
  MINIMUM_CONFIDENCE,
  LEGITIMACY_THRESHOLD_AI,
} from '../shared/constants';

import { weightedAverage, clamp } from '../shared/utils';

// ── Types ──────────────────────────────────────────────────────────

/** The output of legitimacy scoring */
export interface LegitimacyResult {
  /** 0 = definitely AI (should block), 1 = definitely not AI */
  legitimacyScore: number;
  /** Which AI category this element most likely belongs to */
  category: AICategory;
  /** Overall confidence in the scoring decision (0-1) */
  confidence: number;
  /** What evidence contributed to this score */
  evidence: string[];
}

// ── Scorer ─────────────────────────────────────────────────────────

/**
 * Score the legitimacy of a page element based on all detection vectors.
 *
 * A high legitimacy score means the element is NOT AI (safe to allow).
 * A low legitimacy score means the element IS AI (should flag/block).
 *
 * The score is inverted from the raw detection scores:
 *   raw detection score = "how AI-like is this" (0-1)
 *   legitimacy score = "how NOT AI-like is this" (approximately 1 - weighted raw)
 *
 * But it's more nuanced: if vectors disagree, confidence drops.
 * And we use a soft inversion rather than a hard flip to preserve
 * the gradient information in the individual scores.
 */
export function scoreLegitimacy(
  vectors: DetectionVector[],
  weights: Record<string, number>,
): LegitimacyResult {
  if (vectors.length === 0) {
    return {
      legitimacyScore: 1.0,
      category: 'popup',
      confidence: 0,
      evidence: ['No detection vectors provided'],
    };
  }

  // Weight each vector's AI score by its adaptive weight
  const weightedItems = vectors.map((v) => ({
    score: v.score,
    weight: (weights[v.source] ?? 0) * v.confidence,
  }));

  // Weighted average of AI-detection scores (0 = not AI, 1 = definitely AI)
  const weightedAIScore = weightedAverage(weightedItems);

  // Invert to get legitimacy: high AI score = low legitimacy
  const legitimacyScore = clamp(1 - weightedAIScore, 0, 1);

  // ── Agreement check ──────────────────────────────────────────
  // Count how many vectors agree this is AI (score above threshold)
  const aiVotes = vectors.filter(
    (v) => v.score >= LEGITIMACY_THRESHOLD_AI && v.confidence >= MINIMUM_CONFIDENCE,
  );
  const agreementCount = aiVotes.length;

  // If fewer than MINIMUM_VECTOR_AGREEMENT vectors agree, reduce confidence
  let confidence: number;
  if (agreementCount < MINIMUM_VECTOR_AGREEMENT) {
    // Scale confidence down proportionally to how many vectors agree
    const agreementRatio = agreementCount / MINIMUM_VECTOR_AGREEMENT;
    const rawConfidence = vectors.reduce((sum, v) => sum + v.confidence, 0) / vectors.length;
    confidence = clamp(rawConfidence * agreementRatio, 0, 1);
  } else {
    // Enough vectors agree — confidence is the mean of agreeing vectors' confidence
    const agreeingVectors = aiVotes.length > 0 ? aiVotes : vectors;
    confidence = clamp(
      agreeingVectors.reduce((sum, v) => sum + v.confidence, 0) / agreeingVectors.length,
      0,
      1,
    );
  }

  // ── Category determination ────────────────────────────────────
  // Majority vote from high-scoring vectors
  const category = determineCategory(vectors);

  // ── Evidence aggregation ──────────────────────────────────────
  const evidence = aggregateEvidence(vectors, weightedAIScore, agreementCount);

  return {
    legitimacyScore,
    category,
    confidence,
    evidence,
  };
}

/**
 * Determine the AI category by majority vote of high-score vectors.
 * Each vector's vote is weighted by both its confidence and its adaptive weight.
 */
function determineCategory(vectors: DetectionVector[]): AICategory {
  // For now, category is assigned externally by the detection layer.
  // The scorer determines which AI category the *combined* evidence
  // most strongly supports, by examining the evidence strings for
  // category keywords and boosting the category whose evidence
  // has the highest aggregate (confidence * weight * score).
  //
  // Since DetectionVector doesn't carry a category field directly,
  // we fall back to the vector with the highest (score * confidence * weight)
  // and let the engine layer assign category from context.
  //
  // The default category is 'popup' as it's the most generic AI intrusion type.
  // The engine overrides this with detection-layer category information.

  // Score each category by how strongly the vectors' evidence mentions it
  const categoryScores: Record<string, number> = {};
  for (const cat of ALL_CATEGORIES) {
    categoryScores[cat] = 0;
  }

  for (const vector of vectors) {
    if (vector.confidence < 0.2) continue;
    const voteWeight = vector.score * vector.confidence * vector.weight;
    for (const evidenceStr of vector.evidence) {
      const lower = evidenceStr.toLowerCase();
      for (const cat of ALL_CATEGORIES) {
        const label = CATEGORY_LABELS[cat].toLowerCase();
        if (lower.includes(label) || lower.includes(cat.replace('_', ' '))) {
          categoryScores[cat] += voteWeight;
        }
      }
    }
  }

  // Pick the highest-scoring category
  let bestCategory: AICategory = 'popup';
  let bestScore = 0;
  for (const cat of ALL_CATEGORIES) {
    if (categoryScores[cat] > bestScore) {
      bestScore = categoryScores[cat];
      bestCategory = cat;
    }
  }

  return bestCategory;
}

/**
 * Aggregate evidence from all contributing vectors into a human-readable list.
 */
function aggregateEvidence(
  vectors: DetectionVector[],
  weightedAIScore: number,
  agreementCount: number,
): string[] {
  const evidence: string[] = [];

  // Add the composite assessment
  if (weightedAIScore >= 0.75) {
    evidence.push(`Strong AI signal (composite: ${Math.round(weightedAIScore * 100)}%)`);
  } else if (weightedAIScore >= 0.50) {
    evidence.push(`Moderate AI signal (composite: ${Math.round(weightedAIScore * 100)}%)`);
  } else if (weightedAIScore >= 0.25) {
    evidence.push(`Weak AI signal (composite: ${Math.round(weightedAIScore * 100)}%)`);
  }

  // Agreement summary
  evidence.push(`${agreementCount}/${vectors.length} vectors agree`);

  // Per-vector evidence (top 3 strongest)
  const sorted = [...vectors].sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence));
  for (const v of sorted.slice(0, 3)) {
    if (v.evidence.length > 0) {
      evidence.push(`[${v.source}] ${v.evidence[0]}`);
    }
  }

  return evidence;
}
