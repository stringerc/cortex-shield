# Contributing to CortexShield

Thanks for helping make the web less AI-cluttered. Here's how to contribute.

## Quick Start

```bash
git clone https://github.com/stringerc/cortex-shield.git
cd cortex-shield
npm install
npx wxt          # dev mode with HMR
npx wxt build    # production build
```

Load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions` to test.

## Ways to Contribute

### 1. Report an AI widget we don't catch

The most valuable contribution. Open a **"New AI Widget"** issue with:
- The website URL
- What AI element you see (chat widget, popup, overlay, etc.)
- A screenshot if possible

We'll add a static rule and release an update.

### 2. Add new detection rules

Edit `lib/detection/static-rules.ts` and add your rule to the appropriate category array:

```typescript
{ selector: '##div.your-ai-widget', category: 'chat_widget', confidence: 0.90, description: 'Your AI widget' },
```

Or add a network-level block in `public/rules/ai_chat_widgets.json`:

```json
{
  "id": 11,
  "priority": 1,
  "action": { "type": "block" },
  "condition": {
    "urlFilter": "||cdn.your-ai-widget.com^",
    "resourceTypes": ["script"]
  }
}
```

### 3. Add filter list rules

Edit the EasyList-format text files in `docs/filters/`:

```
! Your AI Widget
||cdn.your-ai-widget.com^
##div.your-ai-widget-class
```

### 4. Code contributions

- Follow the existing TypeScript patterns
- Run `npx wxt build` before committing — zero errors required
- Don't modify protected files (engine thresholds, constants) without discussion
- One PR per feature/fix — keep diffs small and reviewable

## Pull Request Process

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-widget`)
3. Make your changes
4. Verify: `npx wxt build` passes
5. Push and open a PR
6. Describe what AI element you're blocking and where you tested it

## Code Style

- TypeScript strict mode
- Match existing patterns in the file you're editing
- Comments are welcome — explain *why*, not *what*
- No hardcoded secrets or API keys

## License

By contributing, you agree your code will be licensed under MIT.
