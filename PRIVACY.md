# CortexShield Privacy Policy

**Last updated: June 10, 2026**

## What We Collect

**Nothing.** CortexShield does not collect, store, transmit, or share any personal data whatsoever.

## How CortexShield Works

CortexShield runs entirely in your browser. All detection and blocking happens locally on your device. No data is sent to any server.

- **Settings** are stored in your browser's local storage (`chrome.storage.local`). They never leave your device.
- **Detection results** exist only in memory during a browsing session. They are not persisted or transmitted.
- **Filter list updates** are fetched via standard HTTPS from GitHub. No user ID or browsing data is included in these requests.

## Third-Party Services

CortexShield does not use any third-party analytics, tracking, or data collection services.

- No Google Analytics
- No Mixpanel, Amplitude, or similar
- No crash reporting (Sentry, Bugsnag, etc.)
- No advertising networks
- No social media tracking

## Permissions

CortexShield requests the following browser permissions:

| Permission | Why We Need It |
|-----------|---------------|
| `storage` | Save your settings and site preferences locally |
| `activeTab` | Detect AI elements on the current page |
| `tabs` | Update the toolbar badge with detection counts |
| `declarativeNetRequest` | Block AI-related network requests at the browser level |
| `host_permissions` | Scan pages for AI elements and apply blocking rules |

None of these permissions are used to collect data.

## Pro Version

The Pro version (when available) adds advanced detection features. Payment processing is handled by Stripe. Only your email and payment information are shared with Stripe — CortexShield never sees your credit card number.

## Changes

If this policy changes, we will update this page. We will never retroactively start collecting data.

## Contact

Questions? Open an issue at [github.com/stringerc/cortex-shield](https://github.com/stringerc/cortex-shield).
