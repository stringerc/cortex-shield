/**
 * CortexShield — DOM Analyzer
 *
 * Detects AI elements through DOM analysis: MutationObserver for
 * dynamic injections, Shadow DOM traversal, iframe detection,
 * attribute analysis, and text content scanning.
 *
 * This is the "dom" detection vector — catches widgets that appear
 * after page load (2-10 seconds), hides in shadow roots, or embed
 * via iframes.
 */

import type { AICategory, DetectionVector } from '../shared/types';
import { DEFAULT_VECTOR_WEIGHTS } from '../shared/constants';
import { getElementPath } from '../shared/utils';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** Callback invoked when a new AI-suspect element is detected */
export type DOMObserverCallback = (element: Element, analysis: ElementAnalysis) => void;

/** Deep analysis result for a single element */
export interface ElementAnalysis {
  /** Overall AI likelihood score (0-1, higher = more likely AI) */
  aiScore: number;
  /** Most likely AI category */
  likelyCategory: AICategory;
  /** Specific evidence signals found */
  signals: string[];
  /** Whether the element is inside a shadow root */
  inShadowDOM: boolean;
  /** Whether the element is an AI-related iframe */
  isAIIFrame: boolean;
  /** AI-typical data attributes found on the element */
  aiAttributes: string[];
  /** Text content markers that suggest AI */
  textMarkers: string[];
}

/** Configuration for the DOM observer */
export interface DOMObserverConfig {
  /** Watch for child additions (default: true) */
  watchChildren: boolean;
  /** Watch for attribute changes (default: true) */
  watchAttributes: boolean;
  /** Watch for character data changes (default: true) */
  watchCharacterData: boolean;
  /** Maximum depth to traverse shadow roots (default: 5) */
  shadowDepthLimit: number;
  /** Delay after page load before initial scan (ms, default: 2000) */
  initialScanDelay: number;
  /** Second-pass scan delay for late-injecting widgets (ms, default: 5000) */
  lateScanDelay: number;
}

/** Default observer configuration */
const DEFAULT_OBSERVER_CONFIG: DOMObserverConfig = {
  watchChildren: true,
  watchAttributes: true,
  watchCharacterData: true,
  shadowDepthLimit: 5,
  initialScanDelay: 2000,
  lateScanDelay: 5000,
};

// ═══════════════════════════════════════════════════════════════
// AI DATA ATTRIBUTES (checked during attribute analysis)
// ═══════════════════════════════════════════════════════════════

const AI_ATTRIBUTE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
  signal: string;
}> = [
  { pattern: /^data-ai(-|$)/i, category: 'chat_widget', signal: 'data-ai attribute' },
  { pattern: /^data-chatbot(-|$)/i, category: 'chat_widget', signal: 'data-chatbot attribute' },
  { pattern: /^data-bot(-|$)/i, category: 'chat_widget', signal: 'data-bot attribute' },
  { pattern: /^data-ai-widget/i, category: 'chat_widget', signal: 'data-ai-widget attribute' },
  { pattern: /^data-chat-widget/i, category: 'chat_widget', signal: 'data-chat-widget attribute' },
  { pattern: /^data-copilot/i, category: 'content_injector', signal: 'data-copilot attribute' },
  { pattern: /^data-ai-generated/i, category: 'content_injector', signal: 'data-ai-generated attribute' },
  { pattern: /^data-ai-assistant/i, category: 'content_injector', signal: 'data-ai-assistant attribute' },
  { pattern: /^data-ai-suggest/i, category: 'content_injector', signal: 'data-ai-suggest attribute' },
  { pattern: /^data-ai-overlay/i, category: 'search_overlay', signal: 'data-ai-overlay attribute' },
  { pattern: /^data-grok/i, category: 'social_feature', signal: 'data-grok attribute' },
  { pattern: /^data-ai-popup/i, category: 'popup', signal: 'data-ai-popup attribute' },
  { pattern: /^data-ai-onboard/i, category: 'popup', signal: 'data-ai-onboard attribute' },
  { pattern: /^data-intercom/i, category: 'chat_widget', signal: 'data-intercom attribute' },
  { pattern: /^data-ada/i, category: 'chat_widget', signal: 'data-ada attribute' },
];

// ═══════════════════════════════════════════════════════════════
// IFRAME SRC PATTERNS
// ═══════════════════════════════════════════════════════════════

const AI_IFRAME_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
  signal: string;
}> = [
  { pattern: /intercom/i, category: 'chat_widget', signal: 'Intercom iframe src' },
  { pattern: /driftt?\.com/i, category: 'chat_widget', signal: 'Drift iframe src' },
  { pattern: /crisp\.chat/i, category: 'chat_widget', signal: 'Crisp iframe src' },
  { pattern: /tidiochat/i, category: 'chat_widget', signal: 'Tidio iframe src' },
  { pattern: /zendesk/i, category: 'chat_widget', signal: 'Zendesk iframe src' },
  { pattern: /freshchat/i, category: 'chat_widget', signal: 'Freshchat iframe src' },
  { pattern: /livechat/i, category: 'chat_widget', signal: 'LiveChat iframe src' },
  { pattern: /helpscout/i, category: 'chat_widget', signal: 'Help Scout iframe src' },
  { pattern: /hubspot/i, category: 'chat_widget', signal: 'HubSpot iframe src' },
  { pattern: /embed\.chatgpt\.com/i, category: 'chat_widget', signal: 'ChatGPT embed iframe src' },
  { pattern: /mosaicagent/i, category: 'chat_widget', signal: 'Mosaic AI agent iframe' },
  { pattern: /kommunicate/i, category: 'chat_widget', signal: 'Kommunicate iframe src' },
  { pattern: /landbot/i, category: 'chat_widget', signal: 'Landbot iframe src' },
  { pattern: /chatbot|ai-bot/i, category: 'chat_widget', signal: 'Generic AI chatbot iframe' },
  { pattern: /copilot/i, category: 'content_injector', signal: 'Copilot iframe src' },
  { pattern: /grammarly/i, category: 'content_injector', signal: 'Grammarly iframe src' },
  { pattern: /jasper/i, category: 'content_injector', signal: 'Jasper iframe src' },
  { pattern: /notion.*ai/i, category: 'content_injector', signal: 'Notion AI iframe' },
  { pattern: /clarity\.ms/i, category: 'tracker', signal: 'Microsoft Clarity iframe' },
  { pattern: /hotjar/i, category: 'tracker', signal: 'Hotjar iframe' },
  { pattern: /fullstory/i, category: 'tracker', signal: 'FullStory iframe' },
  { pattern: /logrocket/i, category: 'tracker', signal: 'LogRocket iframe' },
];

// ═══════════════════════════════════════════════════════════════
// TEXT CONTENT MARKERS
// ═══════════════════════════════════════════════════════════════

const AI_TEXT_MARKERS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
  signal: string;
}> = [
  { pattern: /powered\s+by\s+(ai|gpt|chatgpt|copilot|gemini|claude)/i, category: 'popup', signal: '"Powered by AI" text' },
  { pattern: /try\s+(ai|our\s+ai|copilot|gemini)/i, category: 'popup', signal: '"Try AI" prompt text' },
  { pattern: /upgrade\s+to\s+(ai|pro|premium)/i, category: 'popup', signal: 'AI upgrade prompt text' },
  { pattern: /ai(-|\s)?assist(an|ed)/i, category: 'content_injector', signal: '"AI-assisted" text' },
  { pattern: /ai(-|\s)?generat(ed|ion)/i, category: 'content_injector', signal: '"AI-generated" text' },
  { pattern: /how\s+can\s+i\s+(help|assist)/i, category: 'chat_widget', signal: '"How can I help" chatbot greeting' },
  { pattern: /ask\s+me\s+anything/i, category: 'chat_widget', signal: '"Ask me anything" chatbot text' },
  { pattern: /ai(-|\s)?overview/i, category: 'search_overlay', signal: '"AI Overview" text' },
  { pattern: /ai(-|\s)?summary/i, category: 'search_overlay', signal: '"AI Summary" text' },
  { pattern: /grok(\/|\s|$)/i, category: 'social_feature', signal: 'Grok text mention' },
];

// ═══════════════════════════════════════════════════════════════
// ELEMENT ANALYSIS
// ═══════════════════════════════════════════════════════════════

/**
 * Perform a deep analysis of a DOM element for AI characteristics.
 *
 * Checks: tag name, attributes, class names, iframe src, shadow DOM
 * children, and text content. Returns a comprehensive analysis with
 * an AI likelihood score.
 *
 * @param element - The DOM element to analyze
 * @returns Analysis result with score and evidence
 */
export function analyzeElement(element: Element): ElementAnalysis {
  const signals: string[] = [];
  const aiAttributes: string[] = [];
  const textMarkers: string[] = [];
  let score = 0;
  let bestCategory: AICategory = 'chat_widget';

  // --- Tag name heuristics ---
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'iframe') {
    const src = element.getAttribute('src') ?? '';
    for (const iframePattern of AI_IFRAME_PATTERNS) {
      if (iframePattern.pattern.test(src)) {
        signals.push(iframePattern.signal);
        score += 0.35;
        bestCategory = iframePattern.category;
        break;
      }
    }
  }

  // --- Attribute analysis ---
  const attributes = element.attributes;
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (!attr) continue;
    const attrName = attr.name.toLowerCase();
    for (const attrDef of AI_ATTRIBUTE_PATTERNS) {
      if (attrDef.pattern.test(attrName)) {
        aiAttributes.push(attr.name);
        signals.push(attrDef.signal);
        score += 0.25;
        if (score < 0.3) bestCategory = attrDef.category;
        break;
      }
    }
  }

  // --- Class name heuristics ---
  const classList = element.classList;
  if (classList && classList.length > 0) {
    const aiClassPatterns = [
      { pattern: /chatbot|ai-chat|bot-/i, category: 'chat_widget' as AICategory, signal: 'AI chatbot class' },
      { pattern: /intercom|drift|crisp|tidio|zendesk|freshchat|livechat|helpscout|hubspot/i, category: 'chat_widget' as AICategory, signal: 'Known chat widget class' },
      { pattern: /copilot|grammarly|jasper|ai-writing|ai-editor/i, category: 'content_injector' as AICategory, signal: 'AI content injector class' },
      { pattern: /ai-overlay|ai-summary|ai-answer/i, category: 'search_overlay' as AICategory, signal: 'AI search overlay class' },
      { pattern: /grok|meta-ai|linkedin-ai|radar-ai/i, category: 'social_feature' as AICategory, signal: 'AI social feature class' },
      { pattern: /ai-popup|ai-upsell|ai-nudge|ai-onboard/i, category: 'popup' as AICategory, signal: 'AI popup class' },
      { pattern: /ai-track|ai-analytics|ai-beacon/i, category: 'tracker' as AICategory, signal: 'AI tracker class' },
    ];

    for (let ci = 0; ci < classList.length; ci++) {
      const className = classList.item(ci);
      if (!className) continue;
      for (const classDef of aiClassPatterns) {
        if (classDef.pattern.test(className)) {
          signals.push(classDef.signal);
          score += 0.20;
          bestCategory = classDef.category;
          break;
        }
      }
    }
  }

  // --- Shadow DOM detection ---
  let inShadowDOM = false;
  try {
    const rootNode = element.getRootNode();
    if (rootNode !== document && rootNode instanceof ShadowRoot) {
      inShadowDOM = true;
      signals.push('Element resides in Shadow DOM');
      score += 0.10;
    }
  } catch {
    // getRootNode may fail in some contexts
  }

  // --- iframe detection (element itself is not an iframe, but contains one) ---
  let isAIIFrame = false;
  if (tagName === 'iframe') {
    const src = element.getAttribute('src') ?? '';
    isAIIFrame = AI_IFRAME_PATTERNS.some((p) => p.pattern.test(src));
  }

  // --- Text content analysis (lightweight — only check direct text, not subtree) ---
  const textContent = element.textContent ?? '';
  if (textContent.length > 0 && textContent.length < 5000) {
    for (const textDef of AI_TEXT_MARKERS) {
      if (textDef.pattern.test(textContent)) {
        textMarkers.push(textDef.signal);
        signals.push(textDef.signal);
        score += 0.15;
        bestCategory = textDef.category;
      }
    }
  }

  // Clamp score
  const aiScore = Math.min(score, 1.0);

  return {
    aiScore,
    likelyCategory: bestCategory,
    signals,
    inShadowDOM,
    isAIIFrame,
    aiAttributes,
    textMarkers,
  };
}

// ═══════════════════════════════════════════════════════════════
// SHADOW DOM TRAVERSAL
// ═══════════════════════════════════════════════════════════════

/**
 * Traverse an element and all nested shadow roots, invoking the
 * callback on each discovered element.
 *
 * AI widgets frequently hide their internals inside Shadow DOM to
 * prevent style leaking. This penetrates those boundaries.
 *
 * @param root - The root element to start traversal from
 * @param callback - Function called for each discovered element
 * @param depth - Current shadow depth (used internally for limit)
 * @param maxDepth - Maximum shadow root nesting depth to traverse
 */
export function traverseShadowDOM(
  root: Element | DocumentFragment,
  callback: (element: Element) => void,
  depth: number = 0,
  maxDepth: number = 5,
): void {
  if (depth > maxDepth) return;

  // Walk all children of the current root
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;

    callback(child);

    // Recurse into child's regular DOM children
    traverseShadowDOM(child, callback, depth, maxDepth);

    // If the child has a shadow root, traverse into it (increment depth)
    const shadowRoot = child.shadowRoot;
    if (shadowRoot) {
      traverseShadowDOM(shadowRoot, callback, depth + 1, maxDepth);
    }
  }
}

/**
 * Find all elements within shadow roots that match a given selector.
 *
 * Standard querySelectorAll does not penetrate shadow boundaries.
 * This function manually traverses shadow DOM trees to find matches.
 *
 * @param root - Root element to search from
 * @param selector - CSS selector to match against
 * @param maxDepth - Maximum shadow nesting depth (default: 5)
 * @returns Array of matching elements found in shadow DOM
 */
export function querySelectorAllDeep(
  root: Element | DocumentFragment,
  selector: string,
  maxDepth: number = 5,
): Element[] {
  const results: Element[] = [];

  traverseShadowDOM(root, (element) => {
    try {
      if (element.matches(selector)) {
        results.push(element);
      }
    } catch {
      // Invalid selector for element.matches()
    }
  }, 0, maxDepth);

  return results;
}

// ═══════════════════════════════════════════════════════════════
// MUTATION OBSERVER
// ═══════════════════════════════════════════════════════════════

/**
 * Create a MutationObserver that watches for AI widget injection.
 *
 * Detects dynamically added elements (common pattern: page loads,
 * then 2-10 seconds later, a chat widget script injects an iframe).
 * Also watches for attribute changes that might activate AI features.
 *
 * @param callback - Invoked for each newly added element that looks AI-like
 * @param config - Observer configuration (optional, uses defaults)
 * @returns Object with start() and stop() methods for lifecycle control
 */
export function createDOMObserver(
  callback: DOMObserverCallback,
  config: Partial<DOMObserverConfig> = {},
): { start: () => void; stop: () => void } {
  const fullConfig: DOMObserverConfig = { ...DEFAULT_OBSERVER_CONFIG, ...config };
  let observer: MutationObserver | null = null;
  let initialScanTimer: ReturnType<typeof setTimeout> | null = null;
  let lateScanTimer: ReturnType<typeof setTimeout> | null = null;

  const processedElements = new WeakSet<Element>();
  const vectorWeight = DEFAULT_VECTOR_WEIGHTS.dom ?? 0.20;

  /**
   * Process a mutation record — check added nodes for AI characteristics.
   */
  function processMutation(mutation: MutationRecord): void {
    // Handle added nodes
    if (mutation.type === 'childList') {
      const addedNodes = mutation.addedNodes;
      for (let i = 0; i < addedNodes.length; i++) {
        const node = addedNodes[i];
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as Element;
        checkElement(element);
      }
    }

    // Handle attribute changes
    if (mutation.type === 'attributes') {
      const target = mutation.target;
      if (target instanceof Element) {
        const attrName = mutation.attributeName?.toLowerCase() ?? '';
        // Re-check element if an AI-related attribute was added/changed
        if (attrName.startsWith('data-ai') || attrName.startsWith('data-bot') || attrName.startsWith('data-copilot')) {
          checkElement(target);
        }
      }
    }

    // Handle character data changes (streaming text detection hint)
    if (mutation.type === 'characterData') {
      const parent = mutation.target.parentElement;
      if (parent) {
        checkElement(parent);
      }
    }
  }

  /**
   * Analyze an element and invoke callback if AI characteristics found.
   */
  function checkElement(element: Element): void {
    // Skip already-processed elements
    if (processedElements.has(element)) return;
    processedElements.add(element);

    const analysis = analyzeElement(element);

    // Only fire callback for elements with meaningful AI score
    if (analysis.aiScore >= 0.25) {
      callback(element, analysis);
    }

    // Also check child elements (injections often come as trees)
    const children = element.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child && !processedElements.has(child)) {
        checkElement(child);
      }
    }

    // Penetrate shadow DOM if present
    const shadow = element.shadowRoot;
    if (shadow) {
      traverseShadowDOM(shadow, (shadowElement) => {
        if (!processedElements.has(shadowElement)) {
          processedElements.add(shadowElement);
          const shadowAnalysis = analyzeElement(shadowElement);
          if (shadowAnalysis.aiScore >= 0.25) {
            callback(shadowElement, shadowAnalysis);
          }
        }
      }, 0, fullConfig.shadowDepthLimit);
    }
  }

  /**
   * Scan the entire document for AI elements that might already exist.
   */
  function scanExistingElements(doc: Document): void {
    // Check all iframes first
    const iframes = doc.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (!processedElements.has(iframe)) {
        checkElement(iframe);
      }
    }

    // Check elements with AI-related data attributes
    const aiAttrElements = doc.querySelectorAll(
      '[data-ai], [data-chatbot], [data-bot-id], [data-ai-widget], [data-copilot], [data-ai-generated]',
    );
    for (const el of aiAttrElements) {
      if (!processedElements.has(el)) {
        checkElement(el);
      }
    }

    // Check shadow roots of all custom elements
    const allElements = doc.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot && !processedElements.has(el)) {
        traverseShadowDOM(el.shadowRoot, (shadowEl) => {
          if (!processedElements.has(shadowEl)) {
            processedElements.add(shadowEl);
            const shadowAnalysis = analyzeElement(shadowEl);
            if (shadowAnalysis.aiScore >= 0.25) {
              callback(shadowEl, shadowAnalysis);
            }
          }
        }, 0, fullConfig.shadowDepthLimit);
      }
    }
  }

  /**
   * Start the observer.
   */
  function start(): void {
    const target = document.documentElement ?? document.body;
    if (!target) return;

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        processMutation(mutation);
      }
    });

    observer.observe(target, {
      childList: fullConfig.watchChildren,
      attributes: fullConfig.watchAttributes,
      characterData: fullConfig.watchCharacterData,
      subtree: true,
      attributeFilter: [
        'data-ai', 'data-chatbot', 'data-bot-id', 'data-ai-widget',
        'data-copilot', 'data-ai-generated', 'data-ai-overlay',
        'data-ai-popup', 'data-ai-assistant',
      ],
    });

    // Schedule initial scan (some widgets load shortly after DOMContentLoaded)
    initialScanTimer = setTimeout(() => {
      scanExistingElements(document);
    }, fullConfig.initialScanDelay);

    // Schedule late scan (some widgets inject 5-10s after page load)
    lateScanTimer = setTimeout(() => {
      scanExistingElements(document);
    }, fullConfig.lateScanDelay);
  }

  /**
   * Stop the observer and clear timers.
   */
  function stop(): void {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (initialScanTimer !== null) {
      clearTimeout(initialScanTimer);
      initialScanTimer = null;
    }
    if (lateScanTimer !== null) {
      clearTimeout(lateScanTimer);
      lateScanTimer = null;
    }
  }

  return { start, stop };
}

/**
 * Convert an ElementAnalysis into a DetectionVector for the scoring engine.
 *
 * @param analysis - The element analysis result
 * @returns A DetectionVector with source: 'dom'
 */
export function analysisToVector(analysis: ElementAnalysis): DetectionVector {
  const confidence = Math.min(analysis.aiScore + 0.10, 1.0); // Slight boost for DOM signals
  return {
    source: 'dom',
    score: analysis.aiScore, // High score = likely AI
    confidence,
    weight: DEFAULT_VECTOR_WEIGHTS.dom ?? 0.20,
    evidence: analysis.signals,
    timestamp: Date.now(),
  };
}

/**
 * Quick check whether an iframe src points to a known AI service.
 *
 * Useful for fast pre-filtering before full analysis.
 *
 * @param src - The iframe src URL to check
 * @returns The matching category and signal string, or null if no match
 */
export function checkIframeSrc(src: string): { category: AICategory; signal: string } | null {
  if (!src) return null;
  for (const pattern of AI_IFRAME_PATTERNS) {
    if (pattern.pattern.test(src)) {
      return { category: pattern.category, signal: pattern.signal };
    }
  }
  return null;
}
