/**
 * CortexShield — Flag Marker
 *
 * In Sentry mode, flagged AI elements get a yellow border + "AI" badge.
 * This is purely cosmetic — no behavior changes, just visual marking.
 * The user decides whether to block or allow.
 */

import { CSS_CLASSES, FLAG_STYLES } from '../shared/constants';
import type { DetectionResult } from '../shared/types';
import { CATEGORY_ICONS, CATEGORY_LABELS } from '../shared/types';

/** Map of detection ID → badge element */
const flaggedElements = new Map<string, { element: Element; badge: HTMLElement }>();

/** Flag an AI element with a yellow border + badge */
export function flagElement(detection: DetectionResult): string | null {
  const element = detection.element;
  if (!element || !(element instanceof HTMLElement)) return null;

  // Don't double-flag
  if (element.classList.contains(CSS_CLASSES.flagged)) return null;

  const detectionId = detection.id;
  const category = detection.category;

  // Mark element
  element.classList.add(CSS_CLASSES.flagged);
  element.setAttribute('data-cortex-shield-id', detectionId);

  // Apply flag styles
  element.style.outline = FLAG_STYLES.outline;
  element.style.outlineOffset = FLAG_STYLES.outlineOffset;
  element.style.position = element.style.position || 'relative';

  // Create badge
  const badge = createBadge(detection);
  element.appendChild(badge);

  flaggedElements.set(detectionId, { element, badge });
  return detectionId;
}

/** Remove a flag from an element */
export function unflagElement(detectionId: string): boolean {
  const entry = flaggedElements.get(detectionId);
  if (!entry) return false;

  entry.element.classList.remove(CSS_CLASSES.flagged);
  entry.element.removeAttribute('data-cortex-shield-id');
  entry.element.style.outline = '';
  entry.element.style.outlineOffset = '';
  entry.badge.remove();

  flaggedElements.delete(detectionId);
  return true;
}

/** Remove all flags from the page */
export function unflagAllElements(): number {
  const ids = Array.from(flaggedElements.keys());
  for (const id of ids) {
    unflagElement(id);
  }
  return ids.length;
}

/** Get count of flagged elements */
export function getFlaggedCount(): number {
  return flaggedElements.size;
}

/** Create the "AI" badge that appears in the corner of flagged elements */
function createBadge(detection: DetectionResult): HTMLElement {
  const badge = document.createElement('div');
  badge.className = CSS_CLASSES.flagBadge;

  const icon = CATEGORY_ICONS[detection.category];
  const label = CATEGORY_LABELS[detection.category];

  Object.assign(badge.style, {
    position: 'absolute',
    top: '0',
    right: '0',
    zIndex: '2147483647', // Maximum z-index — always on top
    background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
    color: '#1e293b',
    fontSize: '10px',
    fontWeight: '700',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: '2px 6px',
    borderRadius: '0 0 0 6px',
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    cursor: 'pointer',
    userSelect: 'none',
    lineHeight: '1',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.1s ease',
  });

  badge.innerHTML = `${icon}<span>AI</span>`;
  badge.title = `CortexShield: ${label} detected — click to block, right-click to allow`;

  // Click the badge → block this element (upgrade from flag to hide)
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Dispatch custom event for the content script to handle
    badge.dispatchEvent(
      new CustomEvent('cortex-shield-block', {
        bubbles: true,
        detail: { detectionId: detection.id, category: detection.category },
      }),
    );
  });

  // Right-click the badge → allow this element permanently
  badge.addEventListener('contextmenu', (e) => {
    e.stopPropagation();
    e.preventDefault();
    badge.dispatchEvent(
      new CustomEvent('cortex-shield-allow', {
        bubbles: true,
        detail: { detectionId: detection.id, category: detection.category },
      }),
    );
  });

  // Hover scale effect
  badge.addEventListener('mouseenter', () => {
    badge.style.transform = 'scale(1.1)';
  });
  badge.addEventListener('mouseleave', () => {
    badge.style.transform = 'scale(1)';
  });

  return badge;
}
