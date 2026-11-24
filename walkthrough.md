# Security Summary

**Reviewed Files**: 14 (Backend routes, security utilities, SQLite database layer, WebSocket server, API client, and UI components)
**Issues Resolved**: 4

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Private Group Authorization | `server/routes.ts` | 1299–1400 | Reaction, poll vote, and bookmark endpoints did not verify group membership before acting on or displaying saved private group posts. | Medium | Fixed | Added server-side group privacy and membership checks on `/posts/:id/react`, `/posts/:id/vote`, `POST /saved`, and `GET /saved`. |
| Restricted Account Enforcement | `server/routes.ts`, `server/ws.ts` | 186, 153 | Accounts placed in `restricted` status by moderators could still publish posts/comments or send messages. | Medium | Fixed | Added `requireActiveWriter` middleware across write endpoints and active-status verification in WebSocket `message:send`. |
| Constant-Time Secret Comparison | `server/routes.ts` | 339, 483 | OTP hash and optional admin passcode comparisons used standard string equality instead of constant-time comparison. | Low | Fixed | Replaced comparisons with `crypto.timingSafeEqual` against equal-length digests. |
| Client Link Sanitization & Input Validation | `src/api.ts`, `src/components/*.tsx`, `server/routes.ts` | 12, 2052 | Dynamic external URLs rendered directly in `href` attributes relied solely on backend checks; application tracker did not verify university IDs before insert. | Low | Fixed | Added `safeExternalUrl` validation (`http:`/`https:` only) on all dynamic UI links and validated university existence + status allowlist on `POST /applications`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Password & Token Storage | `server/security.ts` | Passwords use salted `scrypt` hashing; OTP codes and session tokens are stored only as HMAC-SHA256 digests (`SESSION_SECRET` env var or ephemeral 256-bit secret). |
| Session Cookies & CSRF | `server/security.ts`, `src/api.ts` | Auth cookies use `HttpOnly; Secure; SameSite=None; Partitioned` (HTTPS) with in-memory Bearer fallback (never `localStorage`), paired with `Origin`/`X-Requested-With` verification on cookie mutations. |
| Database Queries | `server/db.ts`, `server/routes.ts` | All SQLite operations use prepared parameterized statements with foreign keys enabled (`PRAGMA foreign_keys = ON`). |
| Role-Based Access & Moderation | `server/routes.ts`, `server/ws.ts` | Admin and moderator routes enforce `requireRole`, private group content is hidden from non-members and excluded from global search, and Buddy Match strips private scores/budgets/contact info. |
| Dependency Audit | `bun.lock` | `bun audit` found 0 production server/browser runtime vulnerabilities (2 moderate advisories exist only inside the build-time `vite-plugin-pwa > workbox-build > glob/minimatch` chain). |

## PoC Verification

### 1. Private Group Reaction & Bookmark Isolation
| Field | Value |
|---|---|
| Issue Type | Missing Membership Check on Private Group Interactions |
| Impact | Medium |
| Affected File | `server/routes.ts:1299-1400` |
| Test Scenario | Authenticated non-member calls `POST /api/v1/posts/:id/react` or `POST /api/v1/saved` targeting a post inside the private group `munich-students-verified`. |

#### How It Was Fixed
Added a query joining `posts` and `groups` to inspect `g.privacy` and require an active record in `group_memberships` whenever `privacy !== 'public'`, and filtered `GET /api/v1/saved` post lookups by public visibility or active membership.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Non-member sends `POST /api/v1/posts/:id/react` with a private post ID | `requireActiveWriter` authenticates user |
| 2 | Route queries `posts JOIN groups` and checks `group_memberships` for `(post.group_id, uid)` | No membership found for private group |
| 3 | Route returns HTTP `403` (`Private group membership required.`) | **Handled Safely** |

#### Conclusion
**Fix Verified** — Verified by `tests/api.test.ts` (`unauthReact.status === 403`, `unauthSave.status === 403`); non-members can no longer interact with or read saved metadata from private groups.

### 2. Restricted Account Write Enforcement
| Field | Value |
|---|---|
| Issue Type | Incomplete Enforcement of Account Restriction Status |
| Impact | Medium |
| Affected File | `server/routes.ts:186`, `server/ws.ts:153` |
| Test Scenario | User status is updated to `restricted` by an admin, and the user attempts `POST /api/v1/posts` or sends a WebSocket `message:send` frame. |

#### How It Was Fixed
Introduced `requireActiveWriter` on post, comment, reaction, vote, connection, and messaging REST endpoints, and added a live `users.status === 'active'` check inside the WebSocket `message:send` handler.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Restricted user submits `POST /api/v1/posts` | `attachAuth` loads `status: 'restricted'` |
| 2 | `requireActiveWriter` inspects `req.authUser.status === 'restricted'` | Request halted before route logic |
| 3 | Server returns HTTP `403` (`Your account is currently in read-only restriction.`) | **Handled Safely** |

#### Conclusion
**Fix Verified** — Verified by `tests/api.test.ts` (`restrictedPost.status === 403`); moderator-restricted accounts cannot publish content or initiate messages.
