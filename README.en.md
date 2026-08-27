# OnprsEmail_GUI

[简体中文](README.md) | **English**

[![CI](https://github.com/onprs/OnprsEmail_GUI/actions/workflows/ci.yml/badge.svg)](https://github.com/onprs/OnprsEmail_GUI/actions/workflows/ci.yml)

OnprsEmail_GUI is a Windows client for the `onprs.online` mail system. It sends and receives mail using JMAP over HTTPS and displays catch-all messages, verification codes, and links extracted by the Ingress API.

## Features

### Accounts and mail

- Sign in with an existing JMAP account, or create an `@onprs.online` mailbox with a server registration code and sign in automatically.
- Manage multiple accounts, browse mailboxes and paginated message lists, and locate messages with server-side search.
- Safely read plain-text and HTML messages. Opening an unread message marks it as read; messages can also be starred, moved, sent to trash, replied to, and forwarded.
- Compose rich-text messages, manually save server-side drafts, upload or download attachments, and send through JMAP Submission.

### Catch-all inbox and contacts

- Group and filter catch-all messages by recipient, copy verification codes, and open extracted links in the system browser.
- Ingress v2 can download attachments and raw `.eml` files and delete individual messages; Ingress v1 supports reading messages and clearing all messages for a recipient.
- When the account supports JMAP Contacts, contacts can be searched, created, edited, and deleted.
- Check service status and configure system, light, or dark themes and privacy preferences.

### Security

- Electron `safeStorage` (backed by DPAPI on Windows) encrypts remembered account passwords, the Ingress secret, and optionally saved registration codes.
- The app uses a sandboxed preload, context isolation, validated typed IPC, HTML sanitization, and an iframe CSP.
- Remote images are blocked by default, and external links are delegated to the system browser.

## Requirements

- Target platform: Windows x64.
- Node.js `22.13.0` or later in the 22.x line, or Node.js `24.0.0` or later. CI uses Node.js 24.
- npm `11.16.0`, recorded in the `packageManager` field.
- Python 3 and the Pillow version in `requirements-icon.txt` are only required when regenerating application icons.

Client development does not require a project-level `.env`. Never place account passwords, registration codes, Ingress secrets, or real message data in the repository.

## Getting started

```bash
git clone https://github.com/onprs/OnprsEmail_GUI.git
cd OnprsEmail_GUI
npm ci
npm run dev
```

## Commands

| Command                     | Purpose                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`               | Start the Electron Vite development environment                                     |
| `npm run build`             | Build the main, preload, and renderer processes                                     |
| `npm run format`            | Format managed files with Prettier                                                  |
| `npm run lint`              | Run ESLint and fail on warnings                                                     |
| `npm run audit:prod`        | Audit production dependencies against the official npm advisory database            |
| `npm run typecheck`         | Strictly type-check the Node/Electron and renderer projects                         |
| `npm test`                  | Run Node unit tests and jsdom component tests                                       |
| `npm run test:unit`         | Run tests for the main process, storage, and shared contracts                       |
| `npm run test:renderer`     | Run Renderer component tests in jsdom                                               |
| `npm run test:coverage`     | Run both test suites and enforce their separate coverage thresholds                 |
| `npm run test:e2e`          | Build and run end-to-end tests against a real Electron process                      |
| `npm run test:e2e:packaged` | Build the Windows unpacked app and run its startup test                             |
| `npm run check`             | Run formatting checks, linting, type checks, coverage tests, and a production build |
| `npm run dist:dir`          | Build the unpacked app in `release/win-unpacked/`                                   |
| `npm run dist:win`          | Build the Windows x64 NSIS installer                                                |

`npm run test:e2e` uses an isolated user directory and local JMAP/registration contract servers to cover secure startup, account creation and login, reading, sending, and submission recovery. `npm run test:e2e:packaged` runs only on Windows and verifies the unpacked application's `app://` page, preload bridge, and secure startup; it does not exercise the NSIS installation flow.

GitHub Actions runs the quality gate and source Electron E2E suite for pull requests and pushes to `main`. Pushes to `main` also run the packaged startup test. Playwright reports, traces, and screenshots are retained on failure.

## Project structure

| Path              | Responsibility                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- |
| `src/main/`       | Electron main process, JMAP/Ingress services, security policies, and local storage |
| `src/preload/`    | Minimal typed IPC bridge exposed to the renderer                                   |
| `src/renderer/`   | React UI, application state, and interaction flows                                 |
| `src/shared/`     | Types, schemas, and IPC channels shared across process boundaries                  |
| `tests/unit/`     | Unit tests for services, storage, security handling, and input contracts           |
| `tests/renderer/` | jsdom component tests for Renderer state transitions and critical interactions     |
| `tests/e2e/`      | Source Electron flows and Windows packaged startup tests                           |

## Windows packaging

Application icons are already committed and normally do not need to be regenerated. To update them:

```bash
python -m pip install -r requirements-icon.txt
npm run icon
```

Build the unpacked app or installer:

```bash
npm run dist:dir
npm run dist:win
```

The installer is written to `release/Onprs-Mail-<version>-x64.exe`. The repository does not configure a Windows code-signing certificate, so generated installers may be reported as coming from an unknown publisher by Windows SmartScreen.

## Companion server

The full catch-all inbox and mailbox creation workflows depend on Ingress v2 in [OnprsEmail](https://github.com/onprs/OnprsEmail). They use two separate credentials:

- Catch-all access uses `INGRESS_SECRET_KEY` from the server `.env`; the Cloudflare Worker secret named `INGRESS_SECRET` must contain the same value, with a minimum length of 32 characters.
- Mailbox creation uses a separate `ACCOUNT_REGISTRATION_CODE` and restricted Stalwart provisioning configuration. It must not reuse the Ingress query secret.

See [Desktop mailbox creation](https://github.com/onprs/OnprsEmail/blob/main/docs/account-registration.md) for deployment and rotation instructions. The desktop client never receives or stores Stalwart administrator credentials.

## Contributing and security

Read the [contribution guide](CONTRIBUTING.md) before submitting changes. Report security issues privately by following the [security policy](SECURITY.md).
