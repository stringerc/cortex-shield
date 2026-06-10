/**
 * CortexShield — Element Blocker
 *
 * Hides detected AI elements and injects placeholder boxes.
 * Guardian mode: replaces AI elements with clickable "AI blocked" placeholders.
 * Sentry mode: adds yellow border + badge (see flag-marker.ts).
 * Ghost mode: does nothing to the DOM.
 */

import { CSS_CLASSES, PLACEHOLDER_STYLES } from '../shared/constants';
import type { BlockAction, DetectionResult, AICategory } from '../shared/types';
import { CATEGORY_ICONS, CATEGORY_LABELS } from '../shared/types';
import { generateId } from '../shared/utils';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

/** Map of detection ID → original element + placeholder, for undo/restore */
const blockedElements = new Map<
  string,
  {
    original: Element;
    placeholder: HTMLElement;
    parent: Node | null;
    nextSibling: Node | null;
    detection: DetectionResult;
  }
>();

// ═══════════════════════════════════════════════════════════════
// BLOCK — Hide element and inject placeholder
// ═══════════════════════════════════════════════════════════════

/** Block an AI element: hide it and show a placeholder */
export function blockElement(detection: DetectionResult): string | null {
  const element = detection.element;
  if (!element || !element.parentElement) return null;

  // Don't double-block
  if (element.classList.contains(CSS_CLASSES.blocked)) return null;

  const detectionId = detection.id;

  // Mark the original element
  element.classList.add(CSS_CLASSES.hidden);
  element.classList.add(CSS_CLASSES.blocked);
  element.setAttribute('data-cortex-shield-id', detectionId);

  // Create placeholder
  const placeholder = createPlaceholder(detection);

  // Insert placeholder where the element was
  element.parentElement.insertBefore(placeholder, element);

  // Track for potential restore
  blockedElements.set(detectionId, {
    original: element,
    placeholder,
    parent: element.parentElement,
    nextSibling: element.nextSibling,
    detection,
  });

  return detectionId;
}

/** Create a placeholder box for a blocked AI element */
function createPlaceholder(detection: DetectionResult): HTMLElement {
  const category = detection.category;
  const icon = CATEGORY_ICONS[category];
  const label = CATEGORY_LABELS[category];
  const evidence = detection.evidence[0] || 'AI-powered element';

  const placeholder = document.createElement('div');
  placeholder.className = CSS_CLASSES.placeholder;
  placeholder.setAttribute('data-cortex-shield-detection-id', detection.id);
  placeholder.setAttribute('data-cortex-shield-category', category);

  Object.assign(placeholder.style, PLACEHOLDER_STYLES);
  placeholder.style.minHeight = getMinHeight(detection);
  placeholder.style.width = getWidth(detection);

  placeholder.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center;">
      <span style="font-size:16px;">🛡️</span>
      <span style="font-weight:600; color:#475569;">AI Blocked</span>
      <span style="font-size:10px; background:#f1f5f9; border-radius:4px; padding:2px 6px; color:#64748b;">
        ${icon} ${label}
      </span>
    </div>
    <div style="font-size:10px; color:#94a3b8; margin-top:4px;">
      ${escapeHtml(evidence)}
    </div>
    <div style="font-size:10px; color:#94a3b8; margin-top:2px;">
      Click to show · Right-click to allow always
    </div>
  `;

  // Click to temporarily reveal the blocked element
  placeholder.addEventListener('click', () => {
    revealElement(detection.id);
  });

  // Right-click to add to allowlist
  placeholder.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // Dispatch custom event for the content script to handle (adds to allowlist)
    placeholder.dispatchEvent(
      new CustomEvent('cortex-shield-allow', {
        bubbles: true,
        detail: { detectionId: detection.id, category: detection.category },
      }),
    );
  });

  // Hover effect
  placeholder.addEventListener('mouseenter', () => {
    placeholder.style.borderColor = '#3b82f6';
    placeholder.style.backgroundColor = 'rgba(239, 246, 255, 0.95)';
  });
  placeholder.addEventListener('mouseleave', () => {
    placeholder.style.borderColor = '#cbd5e1';
    placeholder.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
  });

  return placeholder;
}

// ═══════════════════════════════════════════════════════════════
// REVEAL — Temporarily show a blocked element
// ═══════════════════════════════════════════════════════════════

/** Temporarily reveal a blocked element (re-hide on next scan) */
export function revealElement(detectionId: string): boolean {
  const entry = blockedElements.get(detectionId);
  if (!entry) return false;

  // Show original
  entry.original.classList.remove(CSS_CLASSES.hidden);
  entry.original.classList.add('cortex-shield-temporary-allow');

  // Hide placeholder
  entry.placeholder.style.display = 'none';

  return true;
}

// ═══════════════════════════════════════════════════════════════
// RESTORE — Undo a block (user allowed the element permanently)
// ═══════════════════════════════════════════════════════════════

/** Permanently restore a blocked element and remove the placeholder */
export function restoreElement(detectionId: string): boolean {
  const entry = blockedElements.get(detectionId);
  if (!entry) return false;

  // Remove placeholder
  entry.placeholder.remove();

  // Restore original element visibility
  entry.original.classList.remove(CSS_CLASSES.hidden);
  entry.original.classList.remove(CSS_CLASSES.blocked);
  entry.original.removeAttribute('data-cortex-shield-id');
  entry.original.classList.add('cortex-shield-allowed');

  blockedElements.delete(detectionId);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// RESTORE ALL — Undo all blocks on the page
// ═══════════════════════════════════════════════════════════════

/** Restore all blocked elements on the page */
export function restoreAllElements(): number {
  const ids = Array.from(blockedElements.keys());
  for (const id of ids) {
    restoreElement(id);
  }
  return ids.length;
}

// ═══════════════════════════════════════════════════════════════
// QUERY
// ═══════════════════════════════════════════════════════════════

/** Get the number of currently blocked elements */
export function getBlockedCount(): number {
  return blockedElements.size;
}

/** Get all currently blocked detections */
export function getBlockedDetections(): DetectionResult[] {
  return Array.from(blockedElements.values()).map((entry) => entry.detection);
}

/** Check if an element is already blocked */
export function isBlocked(detectionId: string): boolean {
  return blockedElements.has(detectionId);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getMinHeight(detection: DetectionResult): string {
  const element = detection.element;
  if (!element) return '60px';
  const rect = element.getBoundingClientRect();
  // Minimum 60px, maximum 200px for placeholder
  const height = Math.max(60, Math.min(200, rect.height));
  return `${height}px`;
}

function getWidth(detection: DetectionResult): string {
  const element = detection.element;
  if (!element) return '100%';
  const rect = element.getBoundingClientRect();
  // Use percentage width if element takes up most of the parent
  if (rect.width > 300) return '100%';
  return `${rect.width}px`;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
