# CortexShield — The AI Blocker

> You choose what runs in your browser.

CortexShield detects, flags, and blocks AI-powered elements on any webpage. Like uBlock Origin for AI.

## What It Blocks

| Category | Examples |
|----------|----------|
| 💬 **Chat Widgets** | Intercom, Drift, Crisp, ChatGPT embeds, Tidio, Zendesk AI |
| 🔍 **Search Overlays** | Google AI Overviews, Bing Copilot, DDG AI |
| ✍️ **Content Injectors** | Grammarly overlays, Notion AI, WordPress AI, Copilot sidebar |
| 📱 **Social AI** | X/Twitter Grok, Meta AI, LinkedIn AI, Reddit AI summaries |
| 🔔 **AI Popups** | "Try AI!" banners, upgrade nags, onboarding modals |
| 📊 **AI Trackers** | AI analytics, AI heatmaps, AI session recorders |

## Three Modes

| Mode | Behavior |
|------|----------|
| 👻 **Ghost** | Detect and log only. No UI changes. Learn what's on your sites. |
| 🛡️ **Sentry** | Detect and flag AI with yellow borders. You choose what to block. |
| 🛑 **Guardian** | Auto-block. AI elements replaced with "blocked" placeholders. |

## 5 Detection Vectors

Unlike simple rule-based blockers, CortexShield uses **5 detection vectors** simultaneously:

1. **Static Rules** — 130+ known AI widget CSS selectors
2. **Network Interception** — DNR rules block AI domains at the network level
3. **DOM Analysis** — MutationObserver + shadow DOM traversal for dynamic injection
4. **Runtime Hooks** — window.ai, fetch, WebSocket, SSE, postMessage monitoring
5. **Behavioral Patterns** — AI streaming text timing, mutation bursts, WebSocket patterns

The **CortexShield Engine** (adapted from the CortexNudgeEngine) combines all 5 vectors with adaptive weights that **learn from your feedback**. When you allow or override a block, the engine adjusts — catching AI that nobody has written a rule for yet.

## Install

### Chrome (Manifest V3)
```bash
# From source
git clone https://github.com/stringerc/cortex-shield.git
cd cortex-shield
npm install
npx wxt build
# Load .output/chrome-mv3/ as unpacked extension in chrome://extensions
```

### Firefox (Manifest V2)
```bash
npx wxt build -b firefox
# Load .output/firefox-mv2/ as temporary add-on in about:debugging
```

### Development
```bash
npx wxt          # Dev mode with HMR
npx wxt build    # Production build
npx wxt zip      # Package for distribution
```

## Architecture

```
cortex-shield/
├── entrypoints/
│   ├── content.ts          # Content script — DOM scanning, runtime hooks
│   ├── background.ts       # Service worker — settings, stats, self-repair
│   ├── popup/              # React popup UI
│   └── options/            # React settings page
├── lib/
│   ├── detection/          # 6 detection files (4,312 lines)
│   ├── engine/             # CortexShield Engine (5 files)
│   ├── action/             # Element blocker, flag marker, site policy
│   ├── persistence/        # chrome.storage abstraction
│   └── shared/             # Types, constants, messaging, utils
├── public/
│   ├── icon/               # Shield PNG icons (3 modes × 4 sizes)
│   └── rules/              # DNR network blocking rules (6 categories)
├── landing/                # Product landing page
└── PRIVACY.md              # Privacy policy (we collect nothing)
```

## Zero Data Collection

CortexShield collects **zero user data**. All detection runs locally. Settings stay in `chrome.storage` on your device. No telemetry. No phoning home. No analytics.

See [PRIVACY.md](PRIVACY.md) for the full policy.

## Contributing

1. Add new AI widget selectors to `lib/detection/static-rules.ts`
2. Add new DNR rules to `public/rules/*.json`
3. Open a PR with the site you tested against

## License

MIT
