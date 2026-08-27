# Onprs Mail Desktop

A Windows desktop client for the `onprs.online` mail system. The app sends and receives email over HTTPS JMAP and provides catch-all inbox, verification-code extraction, and link-viewing capabilities through the Ingress API.

## Features

- Create an `@onprs.online` mailbox in-app using a server registration code and log in automatically; after the first success, the code can be remembered encrypted with Windows DPAPI so future creation requires no re-entry.
- Multi-account JMAP login, mailbox folders, paginated lists, server-side search, and safe body rendering.
- Read, star, move, trash, reply, and forward.
- Rich-text composition, server-side drafts, attachment upload/download, and sending via JMAP Submission.
- Catch-all inbox stream, verification-code copy, link viewing, attachments, raw `.eml`, and fine-grained deletion.
- JMAP contacts, service status check, light/dark themes, and privacy settings.
- Windows DPAPI protects account passwords, the Ingress key, and optionally saved registration codes; sandboxed preload, typed IPC, HTML sanitization, and remote-image blocking.

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run typecheck
npm test
npm run test:e2e
npm run test:e2e:packaged
```

E2E tests launch a real Electron process with an isolated user directory and verify login, reading, and sending flows against a local JMAP contract server.

## Windows Packaging

```bash
npm run icon
npm run dist:dir
npm run dist:win
```

The installer is output to `release/Onprs-Mail-0.1.1-x64.exe`. The current development build is not signed with a commercial code-signing certificate, so Windows SmartScreen may show an unknown publisher warning.

## Server Companion

Full catch-all inbox and mailbox creation depend on Ingress v2 in `Onprs_Email`. Before deployment, update both the server `.env` and the `INGRESS_SECRET` in the Cloudflare Worker; the key must be at least 32 characters. See `Onprs_Email/docs/account-registration.md` for the mailbox creation service configuration.
