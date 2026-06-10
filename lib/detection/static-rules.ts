/**
 * CortexShield — Static Rules Database
 *
 * Comprehensive database of known AI widget CSS selectors, domains,
 * iframe patterns, and script patterns. This is the "static rules"
 * detection vector — the highest-weighted and most reliable source.
 *
 * Organized by AICategory. Each rule carries a confidence score
 * reflecting how certain we are that a match indicates AI content.
 */

import type { AICategory } from '../shared/types';

// ═══════════════════════════════════════════════════════════════
// RULE TYPES
// ═══════════════════════════════════════════════════════════════

/** A single static detection rule */
export interface StaticRule {
  /** CSS selector, domain pattern, or iframe pattern to match */
  selector: string;
  /** Which AI category this rule detects */
  category: AICategory;
  /** How confident we are that a match = AI (0-1) */
  confidence: number;
  /** Human-readable description of what this rule catches */
  description: string;
}

/** A match result from evaluating an element against static rules */
export interface StaticRuleMatch {
  /** The rule that matched */
  rule: StaticRule;
  /** The specific part of the element that matched (e.g. attribute value) */
  matchDetail: string;
}

// ═══════════════════════════════════════════════════════════════
// CHAT WIDGET SELECTORS (40+)
// ═══════════════════════════════════════════════════════════════

const CHAT_WIDGET_RULES: StaticRule[] = [
  // Intercom
  { selector: '.intercom-lightweight-app', category: 'chat_widget', confidence: 0.95, description: 'Intercom lightweight chat launcher' },
  { selector: '#intercom-container', category: 'chat_widget', confidence: 0.95, description: 'Intercom main container' },
  { selector: '.intercom-messenger', category: 'chat_widget', confidence: 0.90, description: 'Intercom messenger panel' },
  { selector: '[data-intercom-frame]', category: 'chat_widget', confidence: 0.90, description: 'Intercom iframe frame' },
  { selector: 'iframe[src*="intercom"]', category: 'chat_widget', confidence: 0.90, description: 'Intercom iframe by src' },

  // Drift
  { selector: '#drift-frame-chat', category: 'chat_widget', confidence: 0.95, description: 'Drift chat frame' },
  { selector: '#drift-frame-controller', category: 'chat_widget', confidence: 0.90, description: 'Drift controller widget' },
  { selector: '.drift-chat-wrapper', category: 'chat_widget', confidence: 0.90, description: 'Drift chat wrapper' },
  { selector: 'iframe[src*="driftt.com"]', category: 'chat_widget', confidence: 0.90, description: 'Drift iframe by src' },

  // Crisp
  { selector: '#crisp-chatbox', category: 'chat_widget', confidence: 0.95, description: 'Crisp chat box' },
  { selector: 'crisp-chatbox', category: 'chat_widget', confidence: 0.90, description: 'Crisp custom element' },
  { selector: '[data-crisp-chat]', category: 'chat_widget', confidence: 0.85, description: 'Crisp chat data attribute' },
  { selector: 'iframe[src*="crisp.chat"]', category: 'chat_widget', confidence: 0.90, description: 'Crisp iframe by src' },

  // Tidio
  { selector: '#tidio-chat-code', category: 'chat_widget', confidence: 0.95, description: 'Tidio chat code container' },
  { selector: '#tidio-chat-iframe', category: 'chat_widget', confidence: 0.95, description: 'Tidio chat iframe' },
  { selector: '.tidio-chat', category: 'chat_widget', confidence: 0.90, description: 'Tidio chat element' },

  // Zendesk
  { selector: '#zendesk-concierge', category: 'chat_widget', confidence: 0.95, description: 'Zendesk AI concierge' },
  { selector: '[data-zendesk-widget]', category: 'chat_widget', confidence: 0.90, description: 'Zendesk widget data attribute' },
  { selector: '#zopim_chat', category: 'chat_widget', confidence: 0.85, description: 'Zendesk legacy (Zopim) chat' },
  { selector: 'iframe[src*="zendesk"]', category: 'chat_widget', confidence: 0.90, description: 'Zendesk iframe by src' },

  // LiveChat
  { selector: '#livechat-compact-container', category: 'chat_widget', confidence: 0.95, description: 'LiveChat compact widget' },
  { selector: '#livechat-full', category: 'chat_widget', confidence: 0.95, description: 'LiveChat full window' },
  { selector: '.livechat-widget', category: 'chat_widget', confidence: 0.90, description: 'LiveChat widget element' },

  // Freshchat (Freshworks)
  { selector: '#fc_frame', category: 'chat_widget', confidence: 0.95, description: 'Freshchat frame' },
  { selector: '#freshworks-chat', category: 'chat_widget', confidence: 0.90, description: 'Freshworks chat container' },
  { selector: '.freshchat-widget', category: 'chat_widget', confidence: 0.90, description: 'Freshchat widget element' },

  // Help Scout
  { selector: '#beacon-container', category: 'chat_widget', confidence: 0.95, description: 'Help Scout Beacon' },
  { selector: '.BeaconFabButton', category: 'chat_widget', confidence: 0.90, description: 'Help Scout Beacon FAB' },
  { selector: 'iframe[src*="helpscout"]', category: 'chat_widget', confidence: 0.90, description: 'Help Scout iframe by src' },

  // ChatGPT Embed
  { selector: '[data-chatgpt-widget]', category: 'chat_widget', confidence: 0.95, description: 'ChatGPT embedded widget' },
  { selector: '.chatgpt-embed', category: 'chat_widget', confidence: 0.95, description: 'ChatGPT embed container' },
  { selector: 'iframe[src*="embed.chatgpt.com"]', category: 'chat_widget', confidence: 0.95, description: 'ChatGPT embed iframe' },
  { selector: '[data-gpt-widget]', category: 'chat_widget', confidence: 0.90, description: 'Custom GPT widget' },

  // HubSpot
  { selector: '#hubspot-messages-iframe-container', category: 'chat_widget', confidence: 0.95, description: 'HubSpot chat iframe' },
  { selector: '.hubspot-chat-widget', category: 'chat_widget', confidence: 0.90, description: 'HubSpot chat widget' },

  // Ada
  { selector: '#ada-chat-container', category: 'chat_widget', confidence: 0.90, description: 'Ada AI chatbot' },
  { selector: '[data-ada-bot]', category: 'chat_widget', confidence: 0.85, description: 'Ada bot data attribute' },

  // Botpress
  { selector: '#botpress-webchat', category: 'chat_widget', confidence: 0.90, description: 'Botpress webchat' },
  { selector: '.bp-widget', category: 'chat_widget', confidence: 0.85, description: 'Botpress widget class' },

  // Kommunicate
  { selector: '#kommunicate-widget-iframe', category: 'chat_widget', confidence: 0.90, description: 'Kommunicate chat iframe' },

  // Landbot
  { selector: '#LandbotFrameContainer', category: 'chat_widget', confidence: 0.90, description: 'Landbot chat container' },

  // Chatlio
  { selector: '#chatlio-widget', category: 'chat_widget', confidence: 0.90, description: 'Chatlio Slack chat widget' },

  // Qualified
  { selector: '#qualified-embed', category: 'chat_widget', confidence: 0.90, description: 'Qualified AI chatbot' },

  // Gorgias
  { selector: '#gorgias-chat-container', category: 'chat_widget', confidence: 0.90, description: 'Gorgias chat container' },
];

// ═══════════════════════════════════════════════════════════════
// SEARCH OVERLAY SELECTORS (20+)
// ═══════════════════════════════════════════════════════════════

const SEARCH_OVERLAY_RULES: StaticRule[] = [
  // Google AI Overviews
  { selector: '[data-attrid="Semanticish"]', category: 'search_overlay', confidence: 0.90, description: 'Google AI Overview semantic result' },
  { selector: '[data-snc="AI Overview"]', category: 'search_overlay', confidence: 0.90, description: 'Google AI Overview data attribute' },
  { selector: '[data-hveid*="ai"]', category: 'search_overlay', confidence: 0.70, description: 'Google AI-enhanced result attribute' },
  { selector: 'div[data-content*="ai-overview"]', category: 'search_overlay', confidence: 0.85, description: 'Google AI overview content' },
  { selector: 'g-inner-card[class*="zGMFhb"]', category: 'search_overlay', confidence: 0.80, description: 'Google AI card inner element' },

  // Bing Copilot
  { selector: '.b_algo_chat', category: 'search_overlay', confidence: 0.90, description: 'Bing Copilot chat answer' },
  { selector: '#bnp_bee', category: 'search_overlay', confidence: 0.85, description: 'Bing Copilot container' },
  { selector: '[data-tag="copilot-answer"]', category: 'search_overlay', confidence: 0.90, description: 'Bing Copilot answer tag' },
  { selector: 'cib-serp', category: 'search_overlay', confidence: 0.95, description: 'Bing AI SERP component' },

  // DuckDuckGo AI
  { selector: '[data-result="ai-chat"]', category: 'search_overlay', confidence: 0.90, description: 'DDG AI chat result' },
  { selector: '.result--ai', category: 'search_overlay', confidence: 0.85, description: 'DDG AI result class' },
  { selector: '#ai-chat-button', category: 'search_overlay', confidence: 0.80, description: 'DDG AI chat trigger' },

  // Perplexity
  { selector: '[data-testid="pro-search"]', category: 'search_overlay', confidence: 0.85, description: 'Perplexity Pro search' },

  // Brave Search AI
  { selector: '[data-component="summarizer"]', category: 'search_overlay', confidence: 0.90, description: 'Brave Search AI summarizer' },

  // Kagi AI
  { selector: '[data-kagi-quick-answer]', category: 'search_overlay', confidence: 0.85, description: 'Kagi Quick Answer' },

  // Generic search AI patterns
  { selector: '[data-ai-search-result]', category: 'search_overlay', confidence: 0.80, description: 'Generic AI search result attribute' },
  { selector: '.ai-generated-answer', category: 'search_overlay', confidence: 0.80, description: 'Generic AI-generated answer class' },
  { selector: '[data-ai-summary]', category: 'search_overlay', confidence: 0.75, description: 'Generic AI summary attribute' },
  { selector: '.ai-answer-panel', category: 'search_overlay', confidence: 0.75, description: 'Generic AI answer panel' },
  { selector: '[data-ai-overview]', category: 'search_overlay', confidence: 0.80, description: 'Generic AI overview attribute' },
];

// ═══════════════════════════════════════════════════════════════
// CONTENT INJECTOR SELECTORS (20+)
// ═══════════════════════════════════════════════════════════════

const CONTENT_INJECTOR_RULES: StaticRule[] = [
  // Grammarly
  { selector: '[data-grammarly-shadow-host]', category: 'content_injector', confidence: 0.95, description: 'Grammarly shadow DOM host' },
  { selector: '.grammarly-GEM', category: 'content_injector', confidence: 0.90, description: 'Grammarly ghost editor module' },
  { selector: '#grammarly-extension', category: 'content_injector', confidence: 0.95, description: 'Grammarly extension container' },
  { selector: '[data-grammarly-parts="ai"]', category: 'content_injector', confidence: 0.90, description: 'Grammarly AI-specific parts' },

  // Notion AI
  { selector: '[data-content-editable-leaf="ai"]', category: 'content_injector', confidence: 0.90, description: 'Notion AI content leaf' },
  { selector: '.notion-ai-button', category: 'content_injector', confidence: 0.85, description: 'Notion AI action button' },
  { selector: '[data-ai-block="true"]', category: 'content_injector', confidence: 0.85, description: 'Notion AI block attribute' },

  // WordPress AI
  { selector: '.jetpack-ai-assistant', category: 'content_injector', confidence: 0.90, description: 'Jetpack AI Assistant' },
  { selector: '#wp-ai-content-generator', category: 'content_injector', confidence: 0.85, description: 'WordPress AI content generator' },

  // Jasper
  { selector: '[data-jasper-sidebar]', category: 'content_injector', confidence: 0.90, description: 'Jasper AI sidebar' },
  { selector: '.jasper-chrome-extension', category: 'content_injector', confidence: 0.85, description: 'Jasper Chrome extension' },

  // GitHub Copilot
  { selector: '[data-copilot-sidebar]', category: 'content_injector', confidence: 0.95, description: 'GitHub Copilot sidebar' },
  { selector: '.copilot-panel', category: 'content_injector', confidence: 0.90, description: 'Copilot panel' },
  { selector: '#copilot-chat-panel', category: 'content_injector', confidence: 0.90, description: 'Copilot chat panel ID' },

  // Cursor
  { selector: '[data-cursor-ai-panel]', category: 'content_injector', confidence: 0.90, description: 'Cursor AI panel' },
  { selector: '.cursor-ai-suggestion', category: 'content_injector', confidence: 0.85, description: 'Cursor AI inline suggestion' },

  // ChatGPT integration in editors
  { selector: '[data-chatgpt-inline]', category: 'content_injector', confidence: 0.85, description: 'ChatGPT inline suggestion' },
  { selector: '.ai-writing-assistant', category: 'content_injector', confidence: 0.80, description: 'Generic AI writing assistant' },

  // Microsoft Copilot (Word/Excel/Outlook)
  { selector: '[data-copilot-draft]', category: 'content_injector', confidence: 0.90, description: 'Microsoft Copilot draft UI' },
  { selector: '.copilot-floating-button', category: 'content_injector', confidence: 0.85, description: 'Microsoft Copilot floating button' },

  // Google Workspace AI
  { selector: '[data-ve-ai="help-me-write"]', category: 'content_injector', confidence: 0.90, description: 'Google Help Me Write' },
  { selector: '.google-ai-draft', category: 'content_injector', confidence: 0.85, description: 'Google AI draft element' },
];

// ═══════════════════════════════════════════════════════════════
// SOCIAL FEATURE SELECTORS (15+)
// ═══════════════════════════════════════════════════════════════

const SOCIAL_FEATURE_RULES: StaticRule[] = [
  // X/Twitter Grok
  { selector: '[data-testid="grok-inline"]', category: 'social_feature', confidence: 0.95, description: 'X/Twitter Grok inline element' },
  { selector: '[data-testid="grok-card"]', category: 'social_feature', confidence: 0.90, description: 'X/Twitter Grok card' },
  { selector: '.grok-summary', category: 'social_feature', confidence: 0.85, description: 'X/Twitter Grok summary' },
  { selector: '[data-grok-answer]', category: 'social_feature', confidence: 0.85, description: 'Grok answer attribute' },

  // Meta AI
  { selector: '[data-metai-sidebar]', category: 'social_feature', confidence: 0.90, description: 'Meta AI sidebar' },
  { selector: '.meta-ai-chat-bubble', category: 'social_feature', confidence: 0.85, description: 'Meta AI chat bubble' },
  { selector: '[data-testid="meta-ai-button"]', category: 'social_feature', confidence: 0.90, description: 'Meta AI button test ID' },

  // LinkedIn AI
  { selector: '[data-ai-writing-assistant]', category: 'social_feature', confidence: 0.90, description: 'LinkedIn AI writing assistant' },
  { selector: '.linkedin-ai-suggestions', category: 'social_feature', confidence: 0.85, description: 'LinkedIn AI suggestions panel' },
  { selector: '[data-ai-collaborative-article]', category: 'social_feature', confidence: 0.85, description: 'LinkedIn AI collaborative article' },

  // Reddit AI
  { selector: '[data-testid="reddit-ai-summary"]', category: 'social_feature', confidence: 0.90, description: 'Reddit AI summary' },
  { selector: '.reddit-ai-recap', category: 'social_feature', confidence: 0.85, description: 'Reddit AI recap' },
  { selector: 'shreddit-ai-summary', category: 'social_feature', confidence: 0.95, description: 'Reddit AI summary component' },
  { selector: '[data-ai-summary-section]', category: 'social_feature', confidence: 0.80, description: 'Reddit AI summary section' },

  // Snapchat My AI
  { selector: '[data-my-ai-chat]', category: 'social_feature', confidence: 0.90, description: 'Snapchat My AI chat' },

  // Pinterest AI
  { selector: '[data-pinterest-ai-recommendation]', category: 'social_feature', confidence: 0.80, description: 'Pinterest AI recommendation' },
];

// ═══════════════════════════════════════════════════════════════
// POPUP SELECTORS (15+)
// ═══════════════════════════════════════════════════════════════

const POPUP_RULES: StaticRule[] = [
  // AI upgrade banners
  { selector: '[data-ai-upgrade-banner]', category: 'popup', confidence: 0.95, description: 'AI upgrade banner' },
  { selector: '.ai-upsell-modal', category: 'popup', confidence: 0.90, description: 'AI upsell modal' },
  { selector: '[data-testid="ai-pro-banner"]', category: 'popup', confidence: 0.90, description: 'AI Pro upgrade banner' },
  { selector: '.copilot-upgrade-banner', category: 'popup', confidence: 0.85, description: 'Copilot upgrade banner' },

  // "Try AI" prompts
  { selector: '[data-ai-onboarding-prompt]', category: 'popup', confidence: 0.95, description: 'AI onboarding prompt' },
  { selector: '.try-ai-popup', category: 'popup', confidence: 0.90, description: 'Try AI popup' },
  { selector: '[data-ai-tooltip="try"]', category: 'popup', confidence: 0.85, description: 'AI try-it tooltip' },
  { selector: '.ai-feature-discovery', category: 'popup', confidence: 0.85, description: 'AI feature discovery popup' },

  // AI onboarding modals
  { selector: '[data-ai-onboarding-modal]', category: 'popup', confidence: 0.95, description: 'AI onboarding modal' },
  { selector: '.ai-welcome-modal', category: 'popup', confidence: 0.90, description: 'AI welcome modal' },
  { selector: '[data-testid="ai-intro-dialog"]', category: 'popup', confidence: 0.90, description: 'AI intro dialog' },

  // Notification badges / nudges
  { selector: '[data-ai-notification-badge]', category: 'popup', confidence: 0.80, description: 'AI notification badge' },
  { selector: '.ai-whats-new-popup', category: 'popup', confidence: 0.85, description: 'AI whats new popup' },

  // General AI popup patterns
  { selector: '[data-ai-prompt="upgrade"]', category: 'popup', confidence: 0.85, description: 'AI upgrade prompt' },
  { selector: '.ai-callout-banner', category: 'popup', confidence: 0.80, description: 'AI callout banner' },
];

// ═══════════════════════════════════════════════════════════════
// TRACKER DOMAIN RULES (20+)
// ═══════════════════════════════════════════════════════════════

const TRACKER_RULES: StaticRule[] = [
  // AI analytics
  { selector: 'script[src*="analytics.openai.com"]', category: 'tracker', confidence: 0.95, description: 'OpenAI analytics tracker' },
  { selector: 'img[src*="analytics.openai.com"]', category: 'tracker', confidence: 0.95, description: 'OpenAI analytics pixel' },
  { selector: 'script[src*="analytics.anthropic.com"]', category: 'tracker', confidence: 0.95, description: 'Anthropic analytics tracker' },

  // AI session recorders
  { selector: 'script[src*="fullstory.com"]', category: 'tracker', confidence: 0.70, description: 'FullStory session recorder (AI-enhanced)' },
  { selector: 'script[src*="logrocket.com"]', category: 'tracker', confidence: 0.70, description: 'LogRocket session recorder (AI-enhanced)' },
  { selector: 'script[src*="hotjar.com"]', category: 'tracker', confidence: 0.65, description: 'HotJar heatmap (AI-enhanced)' },
  { selector: 'script[src*="clarity.ms"]', category: 'tracker', confidence: 0.70, description: 'Microsoft Clarity (AI session analysis)' },

  // AI heatmap scripts
  { selector: 'script[src*="mouseflow.com"]', category: 'tracker', confidence: 0.65, description: 'Mouseflow AI session tracker' },
  { selector: 'script[src*="smartlook.com"]', category: 'tracker', confidence: 0.65, description: 'Smartlook AI session recorder' },

  // ChatGPT embed trackers
  { selector: 'script[src*="cdn.mosaicagent.com"]', category: 'tracker', confidence: 0.90, description: 'Mosaic AI agent tracker' },
  { selector: 'script[src*="widget.intercom.io"]', category: 'tracker', confidence: 0.90, description: 'Intercom widget tracker' },
  { selector: 'script[src*="js.driftt.com"]', category: 'tracker', confidence: 0.90, description: 'Drift AI tracker script' },

  // Voice/speech AI trackers
  { selector: 'script[src*="api.deepgram.com"]', category: 'tracker', confidence: 0.80, description: 'Deepgram speech AI tracker' },
  { selector: 'script[src*="api.assemblyai.com"]', category: 'tracker', confidence: 0.80, description: 'AssemblyAI speech tracker' },

  // AI A/B testing
  { selector: 'script[src*="optimizely.com"]', category: 'tracker', confidence: 0.60, description: 'Optimizely AI-powered A/B testing' },

  // AI-powered customer data platforms
  { selector: 'script[src*="segment.com"]', category: 'tracker', confidence: 0.65, description: 'Segment AI-enhanced CDP' },
  { selector: 'script[src*="mixpanel.com"]', category: 'tracker', confidence: 0.65, description: 'Mixpanel AI-enhanced analytics' },
  { selector: 'script[src*="amplitude.com"]', category: 'tracker', confidence: 0.65, description: 'Amplitude AI-enhanced analytics' },

  // AI session/interaction tracking
  { selector: '[data-ai-session-tracker]', category: 'tracker', confidence: 0.90, description: 'AI session tracker attribute' },
  { selector: '.ai-beacon', category: 'tracker', confidence: 0.80, description: 'AI analytics beacon element' },
  { selector: 'img[src*="ai-track"]', category: 'tracker', confidence: 0.80, description: 'AI tracking pixel' },
];

// ═══════════════════════════════════════════════════════════════
// AGGREGATED RULE DATABASE
// ═══════════════════════════════════════════════════════════════

/**
 * The complete static rules database, organized by category.
 * Total: 130+ rules across all six categories.
 */
export const STATIC_RULES: StaticRule[] = [
  ...CHAT_WIDGET_RULES,
  ...SEARCH_OVERLAY_RULES,
  ...CONTENT_INJECTOR_RULES,
  ...SOCIAL_FEATURE_RULES,
  ...POPUP_RULES,
  ...TRACKER_RULES,
];

/**
 * Rules indexed by category for efficient per-category lookups.
 */
export const RULES_BY_CATEGORY: Record<AICategory, StaticRule[]> = {
  chat_widget: CHAT_WIDGET_RULES,
  search_overlay: SEARCH_OVERLAY_RULES,
  content_injector: CONTENT_INJECTOR_RULES,
  social_feature: SOCIAL_FEATURE_RULES,
  popup: POPUP_RULES,
  tracker: TRACKER_RULES,
};

// ═══════════════════════════════════════════════════════════════
// ADDITIONAL PATTERN MATCHERS
// ═══════════════════════════════════════════════════════════════

/**
 * AI-related data attributes that strongly indicate an AI element.
 * Checked in addition to CSS selector rules.
 */
const AI_DATA_ATTRIBUTES: ReadonlyArray<{
  attr: string;
  category: AICategory;
  confidence: number;
  description: string;
}> = [
  { attr: 'data-ai', category: 'chat_widget', confidence: 0.80, description: 'data-ai attribute' },
  { attr: 'data-chatbot', category: 'chat_widget', confidence: 0.85, description: 'data-chatbot attribute' },
  { attr: 'data-bot-id', category: 'chat_widget', confidence: 0.85, description: 'data-bot-id attribute' },
  { attr: 'data-ai-widget', category: 'chat_widget', confidence: 0.85, description: 'data-ai-widget attribute' },
  { attr: 'data-chat-widget', category: 'chat_widget', confidence: 0.80, description: 'data-chat-widget attribute' },
  { attr: 'data-ai-generated', category: 'content_injector', confidence: 0.90, description: 'data-ai-generated attribute' },
  { attr: 'data-ai-assistant', category: 'content_injector', confidence: 0.85, description: 'data-ai-assistant attribute' },
  { attr: 'data-ai-suggestion', category: 'content_injector', confidence: 0.80, description: 'data-ai-suggestion attribute' },
  { attr: 'data-copilot', category: 'content_injector', confidence: 0.85, description: 'data-copilot attribute' },
  { attr: 'data-ai-overlay', category: 'search_overlay', confidence: 0.80, description: 'data-ai-overlay attribute' },
  { attr: 'data-ai-popup', category: 'popup', confidence: 0.85, description: 'data-ai-popup attribute' },
  { attr: 'data-ai-promo', category: 'popup', confidence: 0.80, description: 'data-ai-promo attribute' },
  { attr: 'data-ai-tracker', category: 'tracker', confidence: 0.90, description: 'data-ai-tracker attribute' },
];

/**
 * Class name substrings that indicate AI elements.
 * Used for fuzzy matching when exact selectors do not match.
 */
const AI_CLASS_PATTERNS: ReadonlyArray<{
  pattern: string;
  category: AICategory;
  confidence: number;
  description: string;
}> = [
  { pattern: 'ai-chat', category: 'chat_widget', confidence: 0.80, description: 'Class contains ai-chat' },
  { pattern: 'chatbot', category: 'chat_widget', confidence: 0.85, description: 'Class contains chatbot' },
  { pattern: 'ai-widget', category: 'chat_widget', confidence: 0.80, description: 'Class contains ai-widget' },
  { pattern: 'ai-overlay', category: 'search_overlay', confidence: 0.75, description: 'Class contains ai-overlay' },
  { pattern: 'ai-summary', category: 'search_overlay', confidence: 0.80, description: 'Class contains ai-summary' },
  { pattern: 'ai-inject', category: 'content_injector', confidence: 0.85, description: 'Class contains ai-inject' },
  { pattern: 'copilot', category: 'content_injector', confidence: 0.75, description: 'Class contains copilot' },
  { pattern: 'ai-popup', category: 'popup', confidence: 0.80, description: 'Class contains ai-popup' },
  { pattern: 'ai-upgrade', category: 'popup', confidence: 0.85, description: 'Class contains ai-upgrade' },
  { pattern: 'grok', category: 'social_feature', confidence: 0.80, description: 'Class contains grok' },
  { pattern: 'ai-track', category: 'tracker', confidence: 0.85, description: 'Class contains ai-track' },
];

// ═══════════════════════════════════════════════════════════════
// MATCHING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Match a DOM element against all static rules.
 *
 * Evaluates CSS selectors, data attributes, and class name patterns
 * to find every rule that matches the given element. Returns all
 * matches ranked by confidence (highest first).
 *
 * @param element - The DOM element to test against rules
 * @returns Array of matches, sorted by confidence descending
 */
export function matchStaticRules(element: Element): StaticRuleMatch[] {
  if (!element || !(element instanceof Element)) {
    return [];
  }

  const matches: StaticRuleMatch[] = [];

  // Phase 1: Direct CSS selector matching
  for (const rule of STATIC_RULES) {
    try {
      if (element.matches(rule.selector)) {
        matches.push({
          rule,
          matchDetail: `selector: ${rule.selector}`,
        });
      }
    } catch {
      // Invalid selector — skip silently. Some selectors use
      // syntax not supported by element.matches().
    }
  }

  // Phase 2: Data attribute matching
  for (const attrDef of AI_DATA_ATTRIBUTES) {
    if (element.hasAttribute(attrDef.attr)) {
      const attrValue = element.getAttribute(attrDef.attr) ?? '';
      matches.push({
        rule: {
          selector: `[${attrDef.attr}]`,
          category: attrDef.category,
          confidence: attrDef.confidence,
          description: attrDef.description,
        },
        matchDetail: `${attrDef.attr}="${attrValue}"`,
      });
    }
  }

  // Phase 3: Class name fuzzy matching
  const classList = element.classList;
  if (classList && classList.length > 0) {
    for (const pattern of AI_CLASS_PATTERNS) {
      for (let i = 0; i < classList.length; i++) {
        const className = classList.item(i);
        if (className && className.toLowerCase().includes(pattern.pattern)) {
          matches.push({
            rule: {
              selector: `[class*="${pattern.pattern}"]`,
              category: pattern.category,
              confidence: pattern.confidence,
              description: pattern.description,
            },
            matchDetail: `class: ${className}`,
          });
          // One match per pattern is enough — avoid double-counting
          break;
        }
      }
    }
  }

  // Sort by confidence (highest first) and return
  matches.sort((a, b) => b.rule.confidence - a.rule.confidence);
  return matches;
}

/**
 * Get all rules for a specific category.
 *
 * Useful for per-category scanning and UI display of rule counts.
 *
 * @param category - The AI category to filter by
 * @returns All static rules matching the given category
 */
export function getRulesForCategory(category: AICategory): StaticRule[] {
  return RULES_BY_CATEGORY[category] ?? [];
}

/**
 * Check if any static rule matches a given CSS selector string.
 *
 * Used for quick pre-filter checks before expensive DOM operations.
 *
 * @param selector - A CSS selector to look up
 * @returns True if any static rule uses this exact selector
 */
export function isKnownSelector(selector: string): boolean {
  return STATIC_RULES.some((rule) => rule.selector === selector);
}

/**
 * Get the highest-confidence match for an element,
 * or null if no rules match.
 *
 * @param element - The DOM element to test
 * @returns The best match, or null if nothing matched
 */
export function getBestMatch(element: Element): StaticRuleMatch | null {
  const matches = matchStaticRules(element);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Get the total count of rules per category.
 *
 * @returns Record mapping each AICategory to its rule count
 */
export function getRuleCount(): Record<AICategory, number> {
  return {
    chat_widget: CHAT_WIDGET_RULES.length,
    search_overlay: SEARCH_OVERLAY_RULES.length,
    content_injector: CONTENT_INJECTOR_RULES.length,
    social_feature: SOCIAL_FEATURE_RULES.length,
    popup: POPUP_RULES.length,
    tracker: TRACKER_RULES.length,
  };
}
