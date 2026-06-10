/**
 * CortexShield — Options Page
 *
 * Full settings page for detailed configuration.
 * Accessible via popup footer "Settings" button or chrome://extensions options.
 */

import React, { useState, useEffect } from 'react';
import type { ShieldMode, AICategory, GlobalSettings, BlockStats } from '../../lib/shared/types';
import { CATEGORY_LABELS, CATEGORY_ICONS, ALL_CATEGORIES } from '../../lib/shared/types';
import { MODE_CONFIG } from '../../lib/shared/constants';
import { sendFromPopup } from '../../lib/shared/messaging';

type Tab = 'general' | 'categories' | 'sites' | 'stats' | 'about';

export default function OptionsApp() {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [stats, setStats] = useState<BlockStats | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [exportData, setExportData] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [s, st] = await Promise.all([
      sendFromPopup<GlobalSettings>({ type: 'GET_SETTINGS' }),
      sendFromPopup<BlockStats>({ type: 'GET_STATS' }),
    ]);
    setSettings(s);
    setStats(st);
  };

  if (!settings) return <div style={loadingStyle}>Loading...</div>;

  return (
    <div style={rootStyle}>
      {/* Sidebar */}
      <nav style={sidebarStyle}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid #252538' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e4e4f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            🛡️ CortexShield
          </div>
          <div style={{ fontSize: 11, color: '#555570', marginTop: 4 }}>The AI Blocker — Settings</div>
        </div>
        {([
          { id: 'general' as Tab, icon: '⚙️', label: 'General' },
          { id: 'categories' as Tab, icon: '📂', label: 'Categories' },
          { id: 'sites' as Tab, icon: '🌐', label: 'Site Rules' },
          { id: 'stats' as Tab, icon: '📊', label: 'Statistics' },
          { id: 'about' as Tab, icon: 'ℹ️', label: 'About' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '12px 16px',
              border: 'none',
              background: activeTab === tab.id ? '#1a1a2e' : 'transparent',
              color: activeTab === tab.id ? '#e4e4f0' : '#8888a0',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              textAlign: 'left',
              borderLeft: activeTab === tab.id ? '3px solid #3b82f6' : '3px solid transparent',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main style={mainStyle}>
        {activeTab === 'general' && (
          <div>
            <h2 style={sectionTitleStyle}>General Settings</h2>

            {/* Global Mode */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Default Mode</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {(['ghost', 'sentry', 'guardian'] as ShieldMode[]).map((mode) => {
                  const config = MODE_CONFIG[mode];
                  const isActive = settings.mode === mode;
                  return (
                    <button key={mode} onClick={async () => {
                      const s = await sendFromPopup<GlobalSettings>({ type: 'SET_MODE', data: { mode } });
                      setSettings(s);
                    }} style={{
                      flex: 1, padding: '12px 8px', borderRadius: 8,
                      border: `1px solid ${isActive ? config.color + '66' : '#252538'}`,
                      background: isActive ? config.color + '15' : 'transparent',
                      color: isActive ? config.color : '#8888a0',
                      cursor: 'pointer', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 20 }}>{config.icon}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{config.label}</div>
                      <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7 }}>{config.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sensitivity Slider */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Detection Sensitivity</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                <span style={{ fontSize: 11, color: '#555570' }}>Low (fewer false positives)</span>
                <input
                  type="range"
                  min="0" max="100"
                  value={Math.round(settings.sensitivity * 100)}
                  onChange={async (e) => {
                    const s = await sendFromPopup<GlobalSettings>({
                      type: 'GET_SETTINGS',
                    });
                    // Use updateSettings instead
                    const { updateSettings } = await import('../../lib/persistence/storage');
                    const updated = await updateSettings({ sensitivity: parseInt(e.target.value) / 100 });
                    setSettings(updated);
                  }}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 11, color: '#555570' }}>High (catches more AI)</span>
              </div>
              <div style={{ fontSize: 11, color: '#8888a0', marginTop: 4 }}>
                Current: {Math.round(settings.sensitivity * 100)}%
              </div>
            </div>

            {/* Toggles */}
            <div style={sectionStyle}>
              <ToggleRow label="Show notifications when AI is detected" checked={settings.showNotifications} onChange={async (v) => {
                const { updateSettings } = await import('../../lib/persistence/storage');
                const updated = await updateSettings({ showNotifications: v });
                setSettings(updated);
              }} />
              <ToggleRow label="Auto-update filter lists" checked={settings.autoUpdateFilterLists} onChange={async (v) => {
                const { updateSettings } = await import('../../lib/persistence/storage');
                const updated = await updateSettings({ autoUpdateFilterLists: v });
                setSettings(updated);
              }} />
              <ToggleRow label="Debug logging" checked={settings.debugLogging} onChange={async (v) => {
                const { updateSettings } = await import('../../lib/persistence/storage');
                const updated = await updateSettings({ debugLogging: v });
                setSettings(updated);
              }} />
              <ToggleRow label="Extension enabled" checked={settings.enabled} onChange={async () => {
                const s = await sendFromPopup<GlobalSettings>({ type: 'TOGGLE_ENABLED' });
                setSettings(s);
              }} />
            </div>

            {/* Export/Import */}
            <div style={sectionStyle}>
              <label style={labelStyle}>Backup & Restore</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={async () => {
                  const data = await sendFromPopup<string>({ type: 'EXPORT_SETTINGS' });
                  setExportData(data);
                }} style={buttonStyle}>Export Settings</button>
                <button onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json';
                  input.onchange = async (e: any) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    await sendFromPopup({ type: 'IMPORT_SETTINGS', data: text });
                    loadData();
                  };
                  input.click();
                }} style={buttonStyle}>Import Settings</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'categories' && (
          <div>
            <h2 style={sectionTitleStyle}>Category Settings</h2>
            <p style={{ fontSize: 12, color: '#8888a0', marginBottom: 16 }}>
              Enable or disable detection for each AI category. Disabled categories are completely ignored.
            </p>
            {ALL_CATEGORIES.map((category) => (
              <div key={category} style={{
                ...sectionStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
              }}>
                <span style={{ fontSize: 20 }}>{CATEGORY_ICONS[category]}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#e4e4f0' }}>{CATEGORY_LABELS[category]}</div>
                  <div style={{ fontSize: 11, color: '#555570', marginTop: 2 }}>
                    {stats?.byCategory[category]
                      ? `${stats.byCategory[category].detected} detected, ${stats.byCategory[category].blocked} blocked`
                      : 'No data yet'}
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.enabledCategories[category] ?? true}
                  onChange={async () => {
                    const s = await sendFromPopup<GlobalSettings>({
                      type: 'TOGGLE_CATEGORY',
                      data: { category, enabled: !settings.enabledCategories[category] },
                    });
                    setSettings(s);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'stats' && (
          <div>
            <h2 style={sectionTitleStyle}>Statistics</h2>
            {stats && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <StatCard label="Total Detected" value={stats.totalDetected} color="#3b82f6" />
                  <StatCard label="Total Blocked" value={stats.totalBlocked} color="#22c55e" />
                  <StatCard label="Total Flagged" value={stats.totalFlagged} color="#f59e0b" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                  <StatCard label="User Overrides" value={stats.userOverrides} color="#a855f7" />
                  <StatCard label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} color="#06b6d4" />
                </div>
                <div style={sectionStyle}>
                  <h3 style={labelStyle}>By Category</h3>
                  {ALL_CATEGORIES.map((cat) => (
                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #252538' }}>
                      <span style={{ fontSize: 13, color: '#e4e4f0' }}>{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
                      <span style={{ fontSize: 12, color: '#8888a0' }}>
                        {stats.byCategory[cat]?.detected ?? 0} detected · {stats.byCategory[cat]?.blocked ?? 0} blocked
                      </span>
                    </div>
                  ))}
                </div>
                <button onClick={async () => {
                  const s = await sendFromPopup<BlockStats>({ type: 'RESET_STATS' });
                  setStats(s);
                }} style={{ ...buttonStyle, color: '#ef4444', borderColor: '#ef444444' }}>
                  Reset All Statistics
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'about' && (
          <div>
            <h2 style={sectionTitleStyle}>About CortexShield</h2>
            <div style={sectionStyle}>
              <p style={{ fontSize: 14, color: '#e4e4f0', lineHeight: 1.6 }}>
                <strong>CortexShield</strong> is the AI Blocker — detect, flag, and block AI-powered elements on any webpage. Like uBlock Origin for AI.
              </p>
              <p style={{ fontSize: 13, color: '#8888a0', lineHeight: 1.6, marginTop: 12 }}>
                Powered by the CortexShield Engine: 5-vector adaptive detection that learns from your feedback.
                Unlike rule-only blockers, CortexShield gets smarter over time — catching AI that no one has written a rule for yet.
              </p>
              <div style={{ marginTop: 16, padding: 12, background: '#14141f', borderRadius: 8, fontSize: 12, color: '#8888a0' }}>
                <div>Version: 1.0.0</div>
                <div>Engine: CortexShield v1</div>
                <div>Detection Vectors: 5 (Static, Network, DOM, Runtime, Behavioral)</div>
                <div>Mode: Ghost → Sentry → Guardian</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sites' && (
          <div>
            <h2 style={sectionTitleStyle}>Site Rules</h2>
            <p style={{ fontSize: 12, color: '#8888a0', marginBottom: 16 }}>
              Per-site mode and category overrides. Visit a site and change its mode in the popup to create a rule.
            </p>
            {stats?.bySite && Object.keys(stats.bySite).length > 0 ? (
              Object.entries(stats.bySite).map(([domain, siteStats]) => (
                <div key={domain} style={{
                  ...sectionStyle, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4f0' }}>{domain}</div>
                    <div style={{ fontSize: 11, color: '#555570', marginTop: 2 }}>
                      {siteStats.detected} detected · {siteStats.blocked} blocked · {siteStats.flagged} flagged
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 13, color: '#555570', padding: 20, textAlign: 'center' }}>
                No site-specific data yet. Browse with CortexShield enabled to build site statistics.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Reusable Components ──────────────────────────────────────────

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #252538' }}>
      <span style={{ fontSize: 13, color: '#e4e4f0' }}>{label}</span>
      <ToggleSwitch checked={checked} onChange={() => onChange(!checked)} />
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      style={{
        width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
        border: 'none', position: 'relative',
        background: checked ? '#22c55e' : '#333340',
        transition: 'background 0.15s ease',
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 9,
        background: 'white', position: 'absolute', top: 2,
        left: checked ? 20 : 2, transition: 'left 0.15s ease',
      }} />
    </button>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{
      padding: 16, borderRadius: 8, background: '#14141f',
      border: '1px solid #252538', textAlign: 'center',
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#555570', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  display: 'flex', height: '100vh', minHeight: 500,
  background: '#0a0a0f', color: '#e4e4f0',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const sidebarStyle: React.CSSProperties = {
  width: 200, background: '#0f0f18',
  borderRight: '1px solid #252538', flexShrink: 0,
  overflowY: 'auto',
};

const mainStyle: React.CSSProperties = {
  flex: 1, padding: '32px 40px', overflowY: 'auto',
  maxWidth: 700,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, marginBottom: 20, color: '#e4e4f0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#8888a0',
  textTransform: 'uppercase', letterSpacing: 1,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8,
  border: '1px solid #252538', background: '#14141f',
  color: '#8888a0', cursor: 'pointer', fontSize: 12,
};

const loadingStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  height: '100vh', background: '#0a0a0f', color: '#8888a0',
  fontFamily: '-apple-system, sans-serif',
};
