# Android/POS system lock integration

The management button and backend access gate are implemented. Native Android sign-out UI and offline enforcement require an Android app update; this repository cannot modify the separate Android app.

## Contract

Call the existing backend RPC `get_system_access` with the officer's bearer token. It returns a single JSON object:

```json
{"locked": false, "version": 0, "can_manage": false, "session_revoked": false, "allowed": true}
```

- Check after sign-in, on foreground/resume, before collection/invoice/payment/printing operations, and before starting or draining a sync queue.
- Subscribe to `public.system_control` using authenticated Realtime, and re-fetch this RPC after each change. Poll every five seconds while foregrounded as a fallback.
- If `locked` or `session_revoked` is true, or `allowed` is false, stop collection and sync, clear the current officer's UI state and local auth session. When `locked` is true, display only “The system licence has expired. Pay 60 USD to renew.” Otherwise display a session-ended screen. Keep pending payment/invoice records in encrypted durable storage; never delete money records on logout.
- While locked, allow no operational access. Refreshing an old token cannot restore a revoked session: the backend checks the original managed session's creation time. After reopening, require a fresh sign-in before restoring the user's own pending queue.
- Use a typed DTO and single-object decoding, not an array or `Any`.
- Do not expose a lock/unlock button to officers or ordinary administrators. The backend independently authorizes the super admin.

## Important boundaries

The global lock is separate from `pos_devices.locked`, handover deadlines, cash balances and device pairing. Reopening global access must not unlock overdue devices or reset their collected cash.

Backend policies deny operational reads and writes immediately when locked and deny previously revoked sessions after reopening. The management site clears local sessions automatically. A device that is offline cannot receive a remote command until it reconnects; Android must explicitly disable its offline workflow when it detects the lock and must not treat a failed access check as an unlocked system.

Session invalidation is enforced for application data; managed auth tokens are not deleted from auth tables. Ordinary accounts are suspended through the Auth admin API while locked; password sign-in and refresh must be rejected. The app must clear its local session on the access result above. No role may make transactions while locked. Do not show any message about privileged recovery access.