# Chrome Web Store Listing Copy — CortexShield

## Name (max 45 chars)
CortexShield — The AI Blocker

## Short Description (max 132 chars)
Detect, flag, and block AI-powered elements on any webpage. Like uBlock Origin for AI.

## Detailed Description

CortexShield gives you control over AI on the web.

AI chat widgets track you. AI search overlays replace real results. AI content injectors modify your writing. AI social features you can't opt out of. AI popups nag you. AI trackers watch everything.

CortexShield detects all of it — and lets you choose what to block.

🛡️ THREE MODES

• Ghost Mode — Detects AI silently. Logs stats but never changes the page. See what's watching you.
• Sentry Mode — Detects and flags AI with yellow borders. You see exactly what's AI. Default mode.
• Guardian Mode — Auto-blocks AI elements. Replaces them with "blocked" placeholders. Click to reveal, right-click to allow.

💬 WHAT GETS BLOCKED (6 Categories)

• Chat Widgets — Intercom, Drift, Crisp, ChatGPT embeds, Tidio, Zendesk AI, LiveChat, Freshchat, Help Scout Beacon, HubSpot chat, Ada, Botpress
• Search AI — Google AI Overviews, Bing Copilot, DuckDuckGo AI, Perplexity
• Content AI — Grammarly overlays, Notion AI, WordPress AI, Jasper sidebar, Copilot sidebar, Google "Help me write"
• Social AI — X/Twitter Grok, Meta AI, LinkedIn AI suggestions, Reddit AI summaries
• AI Popups — "Try AI!" banners, AI upgrade prompts, AI onboarding modals, "Powered by AI" badges
• AI Trackers — AI-powered heatmaps, session recorders, behavioral analytics (Clarity, Hotjar, FullStory, Mixpanel, Amplitude, Segment)

🔬 5 DETECTION VECTORS

Unlike simple rule-based blockers, CortexShield uses 5 detection methods simultaneously:

1. Static Rules — 130+ known AI widget CSS selectors
2. Network Blocking — Blocks AI domains at the network level (like an ad blocker)
3. DOM Analysis — Catches AI injected after page load via MutationObserver + shadow DOM traversal
4. Runtime Hooks — Monitors window.ai, fetch, WebSocket, SSE, and postMessage for AI behavior
5. Behavioral Patterns — Detects AI token streaming, mutation bursts, and WebSocket chat patterns

The CortexShield Engine combines all 5 vectors and learns from your feedback. When you allow or override a block, it adjusts — catching AI that nobody has written a rule for yet.

⚙️ FULL CONTROL

• Per-site mode — Guardian on shopping sites, Sentry on work sites, Ghost everywhere else
• Per-category toggle — Block chat widgets but allow content AI, or vice versa
• One-click allow — Click a blocked placeholder to temporarily reveal AI, right-click to allow always
• Export/import settings — Backup and restore your configuration

🔒 ZERO DATA COLLECTION

CortexShield collects nothing. All detection runs locally in your browser. Settings stay in chrome.storage on your device. No telemetry. No analytics. No tracking. No phoning home.

The only network requests are filter list updates from GitHub — standard HTTPS GETs with no user data.

PRIVACY FIRST:

• No Google Analytics, Mixpanel, Amplitude, or any analytics
• No crash reporting
• No advertising
• No social media tracking
• Extension data never leaves your device

EFFICIENT:

• ~150 KB installed — smaller than a single image
• Zero performance impact on pages without AI
• Throttled scanning — never freezes or slows your page
• Only scans when new elements appear

Open source: github.com/stringerc/cortex-shield

## Category
Privacy & Security

## Language
English

## Search Keywords (max 10)
ai blocker, block ai, remove ai, ai overlay, chat widget blocker, intercom blocker, grammarly blocker, ai detector, anti ai, privacy

## Homepage URL
https://github.com/stringerc/cortex-shield

## Support URL
https://github.com/stringerc/cortex-shield/issues

## Privacy Policy URL
https://github.com/stringerc/cortex-shield/blob/main/PRIVACY.md
