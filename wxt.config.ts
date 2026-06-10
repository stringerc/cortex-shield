import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'CortexShield — The AI Blocker',
    description: 'Detect, flag, and block AI-powered elements on any webpage. Like uBlock Origin for AI.',
    version: '1.0.0',
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'declarativeNetRequest',
      'declarativeNetRequestFeedback',
    ],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'icon/shield-16.png',
      32: 'icon/shield-32.png',
      48: 'icon/shield-48.png',
      128: 'icon/shield-128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_icon: {
        16: 'icon/shield-16.png',
        32: 'icon/shield-32.png',
        48: 'icon/shield-48.png',
        128: 'icon/shield-128.png',
      },
      default_title: 'CortexShield',
    },
    declarative_net_request: {
      rule_resources: [
        { id: 'ai_chat_widgets', enabled: true, path: 'rules/ai_chat_widgets.json' },
        { id: 'ai_search_overlays', enabled: true, path: 'rules/ai_search_overlays.json' },
        { id: 'ai_content_injectors', enabled: true, path: 'rules/ai_content_injectors.json' },
        { id: 'ai_social_features', enabled: true, path: 'rules/ai_social_features.json' },
        { id: 'ai_popups', enabled: true, path: 'rules/ai_popups.json' },
        { id: 'ai_trackers', enabled: true, path: 'rules/ai_trackers.json' },
      ],
    },
    // Firefox-specific: requires a stable add-on ID for AMO listing
    browser_specific_settings: {
      gecko: {
        id: 'cortex-shield@syncscript.app',
        strict_min_version: '113.0',
      },
    },
  },
  runner: {
    disabled: false,
    endpoints: ['http://localhost:8142'],
  },
});
