/**
 * CortexShield — Popup UI
 *
 * The popup that appears when clicking the shield icon.
 * Layout:
 * ┌──────────────────────────────────┐
 * │ 🛡️ CortexShield  ·  Sentry  ▾  │
 * ├──────────────────────────────────┤
 * │ 📊 12 blocked · 3 flagged       │
 * ├──────────────────────────────────┤
 * │ THIS SITE: example.com          │
 * │ Mode: [Ghost] [Sentry✓] [Guard] │
 * ├──────────────────────────────────┤
 * │ CATEGORIES                       │
 * │ 💬 Chat Widgets    ✅ 12 blocked │
 * │ 🔍 Search AI       ✅  3 blocked │
 * │ ✍️ Content AI      ✅  0        │
 * │ 📱 Social AI       ✅  0        │
 * │ 🔔 AI Popups       ✅  2 flagged │
 * │ 📊 AI Trackers     ✅  5 blocked │
 * ├──────────────────────────────────┤
 * │ [⚙️ Settings] [📊 All Stats]    │
 * └──────────────────────────────────┘
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { ShieldMode, AICategory, GlobalSettings, SitePolicy, BlockStats } from '../../lib/shared/types';
import { CATEGORY_LABELS, CATEGORY_ICONS, ALL_CATEGORIES } from '../../lib/shared/types';
import { MODE_CONFIG } from '../../lib/shared/constants';
import { sendFromPopup } from '../../lib/shared/messaging';
import { formatNumber } from '../../lib/shared/utils';

interface TabState {
  session: {
    domain: string;
    blockedCount: number;
    flaggedCount: number;
    effectiveMode: ShieldMode;
    detections: any[];
  } | null;
  settings: GlobalSettings | null;
  sitePolicy: SitePolicy | null;
  stats: BlockStats | null;
}

// ═══════════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════════

const C = {
  bg: '#0a0a0f',
  surface: '#14141f',
  surfaceHover: '#1a1a2e',
  border: '#252538',
  text: '#e4e4f0',
  textSecondary: '#8888a0',
  textDim: '#555570',
  ghost: '#6b7280',
  sentry: '#3b82f6',
  guardian: '#ef4444',
  green: '#22c55e',
  amber: '#f59e0b',
  blue: '#3b82f6',
};

// ═══════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════

export default function PopupApp() {
  const [state, setState] = useState<TabState>({
    session: null,
    settings: null,
    sitePolicy: null,
    stats: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const [tabState, settings, stats] = await Promise.all([
        sendFromPopup<any>({ type: 'GET_CURRENT_TAB_STATE' }),
        sendFromPopup<GlobalSettings>({ type: 'GET_SETTINGS' }),
        sendFromPopup<BlockStats>({ type: 'GET_STATS' }),
      ]);

      setState({
        session: tabState?.session ?? null,
        settings: tabState?.settings ?? settings,
        sitePolicy: tabState?.sitePolicy ?? null,
        stats,
      });
    } catch (err) {
      console.error('[CortexShield Popup] Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Mode change ──────────────────────────────────────────

  const setGlobalMode = useCallback(async (mode: ShieldMode) => {
    const settings = await sendFromPopup<GlobalSettings>({ type: 'SET_MODE', data: { mode } });
    setState((prev) => ({ ...prev, settings }));
  }, []);

  const setSiteMode = useCallback(async (mode: ShieldMode | 'use-global') => {
    if (!state.session?.domain) return;
    const sitePolicy = await sendFromPopup<SitePolicy>({
      type: 'SET_SITE_MODE',
      data: { domain: state.session.domain, mode },
    });
    setState((prev) => ({ ...prev, sitePolicy }));
  }, [state.session?.domain]);

  // ── Category toggle ──────────────────────────────────────

  const toggleCategory = useCallback(async (category: AICategory) => {
    if (!state.settings) return;
    const enabled = !state.settings.enabledCategories[category];
    const settings = await sendFromPopup<GlobalSettings>({
      type: 'TOGGLE_CATEGORY',
      data: { category, enabled },
    });
    setState((prev) => ({ ...prev, settings }));
  }, [state.settings]);

  // ── Enable/disable ───────────────────────────────────────

  const toggleEnabled = useCallback(async () => {
    const settings = await sendFromPopup<GlobalSettings>({ type: 'TOGGLE_ENABLED' });
    setState((prev) => ({ ...prev, settings }));
  }, []);

  // ── Computed ─────────────────────────────────────────────

  const effectiveMode: ShieldMode = state.sitePolicy?.mode !== 'use-global'
    ? (state.sitePolicy?.mode as ShieldMode) ?? 'sentry'
    : state.settings?.mode ?? 'sentry';

  const domain = state.session?.domain ?? '';
  const totalBlocked = state.stats?.totalBlocked ?? 0;
  const totalFlagged = state.stats?.totalFlagged ?? 0;
  const isEnabled = state.settings?.enabled ?? true;

  if (loading) {
    return (
      <div style={{ ...rootStyle, justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ color: C.textSecondary, fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      {/* ═══ HEADER ═══ */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🛡️</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>CortexShield</span>
        </div>
        {/* Enable/disable toggle */}
        <button
          onClick={toggleEnabled}
          style={{
            padding: '3px 10px',
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            border: `1px solid ${isEnabled ? C.green + '44' : C.guardian + '44'}`,
            background: isEnabled ? C.green + '15' : C.guardian + '15',
            color: isEnabled ? C.green : C.guardian,
          }}
        >
          {isEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* ═══ MODE SELECTOR ═══ */}
      <div style={modeRowStyle}>
        {(['ghost', 'sentry', 'guardian'] as ShieldMode[]).map((mode) => {
          const config = MODE_CONFIG[mode];
          const isActive = effectiveMode === mode;
          return (
            <button
              key={mode}
              onClick={() => setGlobalMode(mode)}
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${isActive ? config.color + '66' : C.border}`,
                background: isActive ? config.color + '15' : 'transparent',
                color: isActive ? config.color : C.textSecondary,
                textAlign: 'center',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 2 }}>{config.icon}</div>
              <div>{config.label}</div>
            </button>
          );
        })}
      </div>

      {/* ═══ STATS BAR ═══ */}
      <div style={statsBarStyle}>
        <span style={{ color: C.green, fontWeight: 600 }}>{formatNumber(totalBlocked)} blocked</span>
        <span style={{ color: C.textDim }}>·</span>
        <span style={{ color: C.amber, fontWeight: 600 }}>{formatNumber(totalFlagged)} flagged</span>
        <span style={{ color: C.textDim }}>·</span>
        <span style={{ color: C.textSecondary }}>{formatNumber(totalBlocked + totalFlagged)} total</span>
      </div>

      {/* ═══ SITE SECTION ═══ */}
      {domain && (
        <div style={siteSectionStyle}>
          <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            This Site
          </div>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 500, marginBottom: 8 }}>
            {domain}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['use-global', 'ghost', 'sentry', 'guardian'] as const).map((mode) => {
              const isActive = (state.sitePolicy?.mode ?? 'use-global') === mode;
              const label = mode === 'use-global' ? 'Auto' : MODE_CONFIG[mode as ShieldMode]?.label ?? mode;
              const color = mode === 'use-global' ? C.textSecondary
                : MODE_CONFIG[mode as ShieldMode]?.color ?? C.textSecondary;
              return (
                <button
                  key={mode}
                  onClick={() => setSiteMode(mode)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 9,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? color + '55' : C.border}`,
                    background: isActive ? color + '15' : 'transparent',
                    color: isActive ? color : C.textDim,
                    transition: 'all 0.1s ease',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ CATEGORIES ═══ */}
      <div style={categoriesSectionStyle}>
        <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Categories
        </div>
        {ALL_CATEGORIES.map((category) => {
          const catStats = state.stats?.byCategory[category];
          const blocked = catStats?.blocked ?? 0;
          const flagged = catStats?.flagged ?? 0;
          const enabled = state.settings?.enabledCategories[category] ?? true;

          return (
            <div key={category} style={categoryRowStyle}>
              <button
                onClick={() => toggleCategory(category)}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  border: `1px solid ${enabled ? C.green + '66' : C.border}`,
                  background: enabled ? C.green + '25' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: enabled ? C.green : C.textDim,
                  flexShrink: 0,
                  transition: 'all 0.1s ease',
                }}
              >
                {enabled ? '✓' : ''}
              </button>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{CATEGORY_ICONS[category]}</span>
              <span style={{
                fontSize: 12,
                color: enabled ? C.text : C.textDim,
                flex: 1,
                fontWeight: 500,
              }}>
                {CATEGORY_LABELS[category]}
              </span>
              {(blocked > 0 || flagged > 0) && (
                <span style={{ fontSize: 10, color: C.textSecondary, flexShrink: 0 }}>
                  {blocked > 0 && <span style={{ color: C.green }}>{blocked}🚫</span>}
                  {blocked > 0 && flagged > 0 && ' '}
                  {flagged > 0 && <span style={{ color: C.amber }}>{flagged}⚠️</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ FOOTER ═══ */}
      <div style={footerStyle}>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          style={footerButtonStyle}
        >
          ⚙️ Settings
        </button>
        <button
          onClick={async () => {
            const stats = await sendFromPopup<BlockStats>({ type: 'GET_STATS' });
            setState((prev) => ({ ...prev, stats }));
          }}
          style={footerButtonStyle}
        >
          🔄 Refresh
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const rootStyle: React.CSSProperties = {
  width: 340,
  minHeight: 420,
  maxHeight: 540,
  background: C.bg,
  color: C.text,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: `1px solid ${C.border}`,
};

const modeRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '10px 16px',
  borderBottom: `1px solid ${C.border}`,
};

const statsBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12,
};

const siteSectionStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderBottom: `1px solid ${C.border}`,
};

const categoriesSectionStyle: React.CSSProperties = {
  padding: '10px 16px',
  flex: 1,
  overflowY: 'auto',
};

const categoryRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '10px 16px',
  borderTop: `1px solid ${C.border}`,
};

const footerButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.textSecondary,
  transition: 'all 0.1s ease',
};
