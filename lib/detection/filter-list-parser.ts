/**
 * CortexShield — Filter List Parser
 *
 * Parses EasyList-format filter rules for AI content blocking.
 * Supports: element hiding rules (##), element hiding exceptions (#@#),
 * network blocking rules (||), network exceptions (@@),
 * CSS selector rules, and domain-specific rules.
 *
 * Converts parsed rules to Declarative Net Request (DNR) format
 * and provides merging/deduplication for multiple filter lists.
 */

import type { AICategory } from '../shared/types';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/** Rule type classification */
export type ParsedRuleType =
  | 'element_hiding'        // ## selector
  | 'element_hiding_exception' // #@# selector
  | 'network_block'         // ||domain^ or pattern$options
  | 'network_exception'     // @@||domain^ or @@pattern$option
  | 'css_injection'         // ##selector##style
  | 'comment'               // ! comment line
  | 'unknown';              // Unparseable or unsupported

/** A single parsed filter rule */
export interface ParsedRule {
  /** The type of rule */
  type: ParsedRuleType;
  /** The raw text of the rule */
  raw: string;
  /** The CSS selector for element hiding rules */
  selector?: string;
  /** The URL pattern for network rules */
  pattern?: string;
  /** Domain restrictions (before the ## or $) */
  domains?: string[];
  /** Filter options (after $) */
  options?: FilterOptions;
  /** Whether this is an exception (allow) rule */
  isException: boolean;
  /** Which AI category this rule most likely targets */
  likelyCategory?: AICategory;
  /** Whether the rule passed validation */
  valid: boolean;
  /** Validation warning if the rule has issues */
  warning?: string;
}

/** Parsed filter options from the $-suffix */
export interface FilterOptions {
  /** Resource types to apply the rule to */
  resourceTypes?: string[];
  /** Resource types to exclude */
  excludedResourceTypes?: string[];
  /** Domains to apply the rule to */
  domains?: string[];
  /** Domains to exclude the rule from */
  excludedDomains?: string[];
  /** Third-party only */
  thirdParty?: boolean;
  /** First-party only */
  firstParty?: boolean;
  /** Match case */
  matchCase?: boolean;
  /** Rewrite rule (for redirect support) */
  rewrite?: string;
  /** CSP directive (for $csp option) */
  csp?: string;
  /** All raw options for passthrough */
  rawOptions: string[];
}

/** Validation result for a filter list */
export interface FilterListValidation {
  /** Total lines in the filter list */
  totalLines: number;
  /** Number of valid rules */
  validRules: number;
  /** Number of invalid rules */
  invalidRules: number;
  /** Number of skipped rules (comments, blanks) */
  skippedLines: number;
  /** Warnings for rules that parsed but may be problematic */
  warnings: Array<{ line: number; raw: string; warning: string }>;
  /** Errors for rules that failed to parse */
  errors: Array<{ line: number; raw: string; error: string }>;
}

// ═══════════════════════════════════════════════════════════════
// AI CATEGORY HEURISTICS
// ═══════════════════════════════════════════════════════════════

/** Domain patterns that map to specific AI categories */
const CATEGORY_DOMAIN_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: AICategory;
}> = [
  // Chat widget domains
  { pattern: /intercom|drift|crisp|tidio|zendesk|zopim|freshchat|livechat|helpscout|hubspot|kommunicate|landbot|chatlio|qualified|gorgias|ada/i, category: 'chat_widget' },
  { pattern: /chatgpt|openai|anthropic|mistral|cohere|perplexity/i, category: 'chat_widget' },
  { pattern: /mosaicagent|botpress/i, category: 'chat_widget' },

  // Content injector domains
  { pattern: /grammarly|jasper|copilot|notion.*ai|cursor/i, category: 'content_injector' },
  { pattern: /jetpack.*ai|wordpress.*ai/i, category: 'content_injector' },

  // Search overlay domains
  { pattern: /google.*ai|bing.*copilot|duckduckgo.*ai|brave.*summar/i, category: 'search_overlay' },

  // Social feature domains
  { pattern: /grok|meta.*ai|linkedin.*ai|reddit.*ai|snapchat.*ai|pinterest.*ai/i, category: 'social_feature' },

  // Tracker domains
  { pattern: /clarity\.ms|hotjar|fullstory|logrocket|mouseflow|smartlook/i, category: 'tracker' },
  { pattern: /analytics\.openai|analytics\.anthropic/i, category: 'tracker' },
];

/**
 * Classify a parsed rule into an AICategory based on its pattern
 * and domain content.
 *
 * @param rule - The parsed rule to classify
 * @returns The most likely AICategory, or undefined if unclear
 */
function classifyRuleCategory(rule: ParsedRule): AICategory | undefined {
  const textToCheck = [rule.pattern, rule.selector, rule.raw]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();

  for (const { pattern, category } of CATEGORY_DOMAIN_PATTERNS) {
    if (pattern.test(textToCheck)) {
      return category;
    }
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// PARSING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Parse an EasyList-format filter list into structured rules.
 *
 * Supports the following rule types:
 *
 * - **Element hiding**: `domain##selector` or `##selector`
 * - **Element hiding exception**: `domain#@#selector` or `#@#selector`
 * - **Network blocking**: `||domain^` or `pattern$option1,option2`
 * - **Network exception**: `@@||domain^` or `@@pattern$option1,option2`
 * - **Comments**: `! comment` (skipped)
 * - **Blank lines**: (skipped)
 *
 * @param text - The raw text of the filter list
 * @returns Array of parsed, validated rules
 */
export function parseFilterList(text: string): ParsedRule[] {
  const lines = text.split('\n');
  const rules: ParsedRule[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines
    if (line.length === 0) continue;

    // Skip comments
    if (line.startsWith('!') || line.startsWith('[')) {
      // Section headers like [AdBlock Plus 2.0] are also comments
      continue;
    }

    const parsed = parseRule(line);
    if (parsed) {
      rules.push(parsed);
    }
  }

  return rules;
}

/**
 * Parse a single filter rule line.
 *
 * @param line - A single line from a filter list
 * @returns A ParsedRule, or null if the line cannot be parsed
 */
function parseRule(line: string): ParsedRule | null {
  // --- Network exception rules (@@ prefix) ---
  if (line.startsWith('@@')) {
    return parseNetworkRule(line.slice(2), true);
  }

  // --- Element hiding exception (#@#) ---
  // Must check before regular ## because #@# contains ##
  if (line.includes('#@#')) {
    return parseElementHidingRule(line, true);
  }

  // --- Element hiding / CSS injection rules (##) ---
  if (line.includes('##')) {
    return parseElementHidingRule(line, false);
  }

  // --- Network blocking rules (|| prefix or plain pattern) ---
  if (line.startsWith('||') || line.startsWith('|') || line.includes('$')) {
    return parseNetworkRule(line, false);
  }

  // --- Unknown rule type ---
  return {
    type: 'unknown',
    raw: line,
    isException: false,
    valid: false,
    warning: 'Unrecognized filter rule format',
  };
}

/**
 * Parse an element hiding rule (## or #@#).
 *
 * Format: `domain1,domain2##selector` or `##selector`
 * Exception: `domain1,domain2#@#selector` or `#@#selector`
 *
 * @param line - The raw rule line
 * @param isException - Whether this is an exception (#@#)
 * @returns A ParsedRule for the element hiding rule
 */
function parseElementHidingRule(line: string, isException: boolean): ParsedRule {
  const separator = isException ? '#@#' : '##';
  const separatorIndex = line.indexOf(separator);
  const domainPart = line.slice(0, separatorIndex);
  const selectorPart = line.slice(separatorIndex + separator.length);

  const rule: ParsedRule = {
    type: isException ? 'element_hiding_exception' : 'element_hiding',
    raw: line,
    isException,
    valid: true,
  };

  // Parse domain restrictions
  if (domainPart.length > 0) {
    rule.domains = domainPart.split(',').map((d) => d.trim()).filter((d) => d.length > 0);
  }

  // Parse selector
  if (selectorPart.length > 0) {
    rule.selector = selectorPart;

    // Validate selector — check for overly broad patterns
    if (selectorPart === '*' || selectorPart === 'body' || selectorPart === 'html') {
      rule.valid = false;
      rule.warning = `Overly broad selector: "${selectorPart}" — would hide entire page`;
    }

    // Check for CSS injection syntax (##selector##style)
    if (selectorPart.includes('##')) {
      rule.type = 'css_injection';
    }
  } else {
    rule.valid = false;
    rule.warning = 'Empty selector in element hiding rule';
  }

  rule.likelyCategory = classifyRuleCategory(rule);
  return rule;
}

/**
 * Parse a network blocking/exception rule.
 *
 * Format: `||domain^$option1,option2` or `pattern$option1,option2`
 * Exception: `@@||domain^$option1,option2`
 *
 * @param line - The raw rule line (without @@ prefix for exceptions)
 * @param isException - Whether this is an exception rule
 * @returns A ParsedRule for the network rule
 */
function parseNetworkRule(line: string, isException: boolean): ParsedRule {
  const rule: ParsedRule = {
    type: isException ? 'network_exception' : 'network_block',
    raw: line,
    isException,
    valid: true,
  };

  // Split pattern from options at the $ separator
  // (But $ in regex patterns can be tricky — handle carefully)
  let pattern = line;
  let optionsStr = '';

  const dollarIndex = findOptionsSeparator(line);
  if (dollarIndex !== -1) {
    pattern = line.slice(0, dollarIndex);
    optionsStr = line.slice(dollarIndex + 1);
  }

  // Strip anchor markers
  if (pattern.startsWith('||')) {
    pattern = pattern.slice(2);
  } else if (pattern.startsWith('|')) {
    pattern = pattern.slice(1);
  }

  if (pattern.endsWith('|')) {
    pattern = pattern.slice(0, -1);
  }

  // Strip caret separators
  if (pattern.endsWith('^')) {
    pattern = pattern.slice(0, -1);
  }

  rule.pattern = pattern.length > 0 ? pattern : undefined;

  // Validate pattern
  if (!rule.pattern || rule.pattern.length === 0) {
    rule.valid = false;
    rule.warning = 'Empty pattern in network rule';
  }

  // Check for overly broad patterns
  if (rule.pattern && isOverlyBroadPattern(rule.pattern)) {
    rule.warning = `Overly broad pattern: "${rule.pattern}" — may block legitimate resources`;
  }

  // Parse options
  if (optionsStr.length > 0) {
    rule.options = parseFilterOptions(optionsStr);
  }

  rule.likelyCategory = classifyRuleCategory(rule);
  return rule;
}

/**
 * Find the $ that separates a pattern from options.
 *
 * Must avoid splitting on $ that is part of a regex pattern.
 * In practice, EasyList uses $ as a separator only when followed
 * by known option keywords.
 */
function findOptionsSeparator(line: string): number {
  // Known option prefixes that appear after $
  const optionKeywords = [
    'domain=', 'third-party', 'first-party', 'match-case',
    'script', 'image', 'stylesheet', 'subdocument', 'xmlhttprequest',
    'media', 'font', 'object', 'popup', 'websocket', 'webrtc',
    'document', 'other', 'csp=', 'rewrite=', 'redirect=',
    'removeparams=', 'header=', 'all', 'important',
    '~script', '~image', '~stylesheet', '~subdocument',
    '~xmlhttprequest', '~media', '~font', '~object',
    '~popup', '~websocket', '~document', '~other',
  ];

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$') {
      const after = line.slice(i + 1);
      for (const keyword of optionKeywords) {
        if (after.startsWith(keyword)) {
          return i;
        }
      }
    }
  }

  return -1;
}

/**
 * Parse filter options from the comma-separated $-suffix.
 *
 * @param optionsStr - The options string (everything after $)
 * @returns A parsed FilterOptions object
 */
function parseFilterOptions(optionsStr: string): FilterOptions {
  const options: FilterOptions = { rawOptions: [] };

  const parts = optionsStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    options.rawOptions.push(trimmed);

    // Domain restrictions
    if (trimmed.startsWith('domain=')) {
      const domainList = trimmed.slice(7).split('|');
      const includedDomains: string[] = [];
      const excludedDomains: string[] = [];

      for (const d of domainList) {
        const domain = d.trim();
        if (domain.startsWith('~')) {
          excludedDomains.push(domain.slice(1));
        } else if (domain.length > 0) {
          includedDomains.push(domain);
        }
      }

      if (includedDomains.length > 0) options.domains = includedDomains;
      if (excludedDomains.length > 0) options.excludedDomains = excludedDomains;
      continue;
    }

    // Third-party
    if (trimmed === 'third-party' || trimmed === '3p') {
      options.thirdParty = true;
      continue;
    }

    // First-party
    if (trimmed === 'first-party' || trimmed === '1p') {
      options.firstParty = true;
      continue;
    }

    // Match case
    if (trimmed === 'match-case') {
      options.matchCase = true;
      continue;
    }

    // Resource types (positive)
    if (isResourceType(trimmed)) {
      if (!options.resourceTypes) options.resourceTypes = [];
      options.resourceTypes.push(trimmed);
      continue;
    }

    // Resource types (negative / excluded)
    if (trimmed.startsWith('~') && isResourceType(trimmed.slice(1))) {
      if (!options.excludedResourceTypes) options.excludedResourceTypes = [];
      options.excludedResourceTypes.push(trimmed.slice(1));
      continue;
    }

    // CSP option
    if (trimmed.startsWith('csp=')) {
      options.csp = trimmed.slice(4);
      continue;
    }

    // Rewrite option
    if (trimmed.startsWith('rewrite=')) {
      options.rewrite = trimmed.slice(8);
      continue;
    }
  }

  return options;
}

/**
 * Check if a string is a recognized resource type in filter lists.
 */
function isResourceType(str: string): boolean {
  const types = new Set([
    'script', 'image', 'stylesheet', 'subdocument',
    'xmlhttprequest', 'media', 'font', 'object',
    'popup', 'websocket', 'webrtc', 'document',
    'other', 'font', 'ping',
  ]);
  return types.has(str);
}

/**
 * Check if a network pattern is overly broad (could block too much).
 */
function isOverlyBroadPattern(pattern: string): boolean {
  // Very short patterns with no domain qualifiers
  if (pattern.length < 5 && !pattern.includes('.')) return true;
  // Patterns that match any subdomain of a TLD
  if (/^\*\.[a-z]{2,3}$/.test(pattern)) return true;
  // Wildcard-only patterns
  if (pattern === '*' || pattern === '**') return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// DNR CONVERSION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert parsed filter rules to Declarative Net Request (DNR) format.
 *
 * Network blocking rules become DNR block rules. Element hiding rules
 * are NOT converted (they are handled via CSS injection in content scripts).
 * Exception rules become DNR allow rules.
 *
 * @param parsed - Array of parsed filter rules
 * @param startId - Starting rule ID (to avoid collisions, default: 1)
 * @returns Array of DNR-compatible rule objects
 */
export function convertToDNRRules(
  parsed: ParsedRule[],
  startId: number = 1,
): Array<{
  id: number;
  enabled: boolean;
  action: { type: string; [key: string]: unknown };
  condition: { [key: string]: unknown };
  priority?: number;
}> {
  const dnrRules: Array<{
    id: number;
    enabled: boolean;
    action: { type: string; [key: string]: unknown };
    condition: { [key: string]: unknown };
    priority?: number;
  }> = [];

  let ruleId = startId;

  for (const rule of parsed) {
    // Skip non-network rules (cosmetic/element hiding handled differently)
    if (rule.type !== 'network_block' && rule.type !== 'network_exception') continue;
    // Skip invalid rules
    if (!rule.valid) continue;
    // Skip rules without a pattern
    if (!rule.pattern) continue;

    const actionType = rule.isException ? 'allow' : 'block';

    const condition: Record<string, unknown> = {};

    // URL filter
    if (rule.pattern.startsWith('||')) {
      condition.urlFilter = rule.pattern;
    } else {
      condition.regexFilter = convertWildcardToRegex(rule.pattern);
    }

    // Domain restrictions from options
    if (rule.options?.domains && rule.options.domains.length > 0) {
      condition.domains = rule.options.domains;
    }
    if (rule.options?.excludedDomains && rule.options.excludedDomains.length > 0) {
      condition.excludedDomains = rule.options.excludedDomains;
    }

    // Domain restrictions from rule prefix
    if (rule.domains && rule.domains.length > 0) {
      const includedDomains: string[] = [];
      const excludedDomains: string[] = [];
      for (const d of rule.domains) {
        if (d.startsWith('~')) {
          excludedDomains.push(d.slice(1));
        } else {
          includedDomains.push(d);
        }
      }
      if (includedDomains.length > 0) {
        condition.domains = [...(condition.domains as string[] ?? []), ...includedDomains];
      }
      if (excludedDomains.length > 0) {
        condition.excludedDomains = [...(condition.excludedDomains as string[] ?? []), ...excludedDomains];
      }
    }

    // Resource type restrictions
    if (rule.options?.resourceTypes && rule.options.resourceTypes.length > 0) {
      condition.resourceTypes = rule.options.resourceTypes;
    }
    if (rule.options?.excludedResourceTypes && rule.options.excludedResourceTypes.length > 0) {
      condition.excludedResourceTypes = rule.options.excludedResourceTypes;
    }

    // Third-party restriction
    if (rule.options?.thirdParty) {
      condition.thirdParty = true;
    }
    if (rule.options?.firstParty) {
      condition.thirdParty = false;
    }

    dnrRules.push({
      id: ruleId++,
      enabled: true,
      action: { type: actionType },
      condition,
      priority: rule.isException ? 3 : 1, // Exceptions take priority
    });
  }

  return dnrRules;
}

/**
 * Convert EasyList wildcard patterns to DNR-compatible regex.
 *
 * @param pattern - The EasyList wildcard pattern
 * @returns A regex string compatible with DNR regexFilter
 */
function convertWildcardToRegex(pattern: string): string {
  let regex = pattern
    .replace(/[.+?${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\^/g, '(?:[?/&]|$)');

  if (regex.startsWith('\\|\\|')) {
    regex = `^[a-z]+://(?:[a-z0-9-]+\\.)*${regex.slice(4)}`;
  }

  return regex;
}

// ═══════════════════════════════════════════════════════════════
// MERGING & DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Merge multiple filter lists, deduplicating identical rules.
 *
 * When multiple filter lists contain the same rule pattern, only
 * one copy is kept. Exception rules always take precedence over
 * blocking rules for the same pattern.
 *
 * @param lists - Array of parsed rule arrays (one per filter list)
 * @returns Deduplicated, merged array of rules
 */
export function mergeFilterLists(lists: ParsedRule[][]): ParsedRule[] {
  const seen = new Map<string, ParsedRule>(); // key → rule
  const exceptions = new Map<string, ParsedRule>(); // pattern → exception rule

  // First pass: collect all rules, keyed by their canonical form
  for (const list of lists) {
    for (const rule of list) {
      // Skip invalid rules
      if (!rule.valid) continue;

      const key = getRuleCanonicalKey(rule);

      // Network exceptions always win
      if (rule.isException && rule.pattern) {
        exceptions.set(rule.pattern, rule);
      }

      // Only keep first occurrence of duplicate
      if (seen.has(key)) continue;

      seen.set(key, rule);
    }
  }

  // Second pass: apply exceptions — remove blocked rules that have explicit exceptions
  const merged: ParsedRule[] = [];
  for (const rule of seen.values()) {
    // If this is a blocking rule and an exception exists for the same pattern, skip it
    if (!rule.isException && rule.pattern && exceptions.has(rule.pattern)) {
      continue;
    }
    merged.push(rule);
  }

  return merged;
}

/**
 * Generate a canonical key for deduplication.
 *
 * Two rules with the same key are considered duplicates.
 */
function getRuleCanonicalKey(rule: ParsedRule): string {
  const parts: string[] = [rule.type];

  if (rule.pattern) parts.push(`p:${rule.pattern}`);
  if (rule.selector) parts.push(`s:${rule.selector}`);
  if (rule.domains) parts.push(`d:${rule.domains.sort().join(',')}`);

  // Include key options that affect matching
  if (rule.options) {
    if (rule.options.thirdParty) parts.push('3p');
    if (rule.options.firstParty) parts.push('1p');
    if (rule.options.resourceTypes) parts.push(`rt:${rule.options.resourceTypes.sort().join(',')}`);
    if (rule.options.domains) parts.push(`od:${rule.options.domains.sort().join(',')}`);
  }

  return parts.join('|');
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Validate a filter list and produce a validation report.
 *
 * Checks for: malformed rules, overly broad patterns, conflicting
 * rules, and other issues. Returns a detailed report.
 *
 * @param rules - Array of parsed rules to validate
 * @returns A validation report
 */
export function validateFilterList(rules: ParsedRule[]): FilterListValidation {
  const validation: FilterListValidation = {
    totalLines: rules.length,
    validRules: 0,
    invalidRules: 0,
    skippedLines: 0,
    warnings: [],
    errors: [],
  };

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    if (rule.type === 'comment' || rule.type === 'unknown') {
      validation.skippedLines++;
      continue;
    }

    if (!rule.valid) {
      validation.invalidRules++;
      if (rule.warning) {
        validation.errors.push({
          line: i,
          raw: rule.raw,
          error: rule.warning,
        });
      }
      continue;
    }

    validation.validRules++;

    if (rule.warning) {
      validation.warnings.push({
        line: i,
        raw: rule.raw,
        warning: rule.warning,
      });
    }
  }

  return validation;
}

/**
 * Get statistics about a parsed filter list.
 *
 * @param rules - Array of parsed rules
 * @returns Count of rules by type
 */
export function getFilterListStats(rules: ParsedRule[]): Record<ParsedRuleType, number> & { byCategory: Partial<Record<AICategory, number>> } {
  const typeCounts: Record<string, number> = {
    element_hiding: 0,
    element_hiding_exception: 0,
    network_block: 0,
    network_exception: 0,
    css_injection: 0,
    comment: 0,
    unknown: 0,
  };

  const categoryCounts: Partial<Record<AICategory, number>> = {};

  for (const rule of rules) {
    typeCounts[rule.type] = (typeCounts[rule.type] ?? 0) + 1;

    if (rule.likelyCategory) {
      categoryCounts[rule.likelyCategory] = (categoryCounts[rule.likelyCategory] ?? 0) + 1;
    }
  }

  return {
    ...typeCounts as Record<ParsedRuleType, number>,
    byCategory: categoryCounts,
  };
}
