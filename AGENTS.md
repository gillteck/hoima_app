<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## System access
- Operational system access is enforced by `system_access_allowed` in restrictive database policies and `requireSystemAccess` on every operational server function; no role may transact while locked. Only the lock/reopen action uses an authenticated recovery boundary verified by `get_system_access.can_manage`.
- Lock/reopen operations invalidate non-super-admin sessions by their managed session creation time, not JWT issue time, so token refresh cannot revive a revoked session; super admins retain recovery access.
- Keep global locks separate from individual device/deadline locks, and do not erase offline payment queues when signing out.
- Each content route declares unique metadata through `pageHead` or its own `head`; shared root metadata alone does not describe the current page.
- Licence expiry notices and messages share terms from `src/lib/licence.ts`; renewal is informational, and only the existing super-admin control reopens access.
- Suspend ordinary sign-ins through the Auth admin API after closing operational access; persist service-only prior-ban snapshots and restore only owned suspensions before reopening, preserving independent account bans.
- Operational table write triggers serialize against the system lock and reject writes even with service-role access; auth, account-restoration snapshots and lock audit records remain outside this operational write guard.
