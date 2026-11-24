# Firestore Security Specification — AbroadConnect India

## 1. Data Invariants
1. **Owner-Only PII Isolation**: Email and language settings in `/users/{userId}/private/info` can only be read or written by the authenticated, email-verified user whose `request.auth.uid == userId`.
2. **Public Profile Separation**: Public cards in `/users/{userId}/public/card` contain zero PII (no email, phone, or budget) and can only be written by the owner.
3. **Checklist Ownership & Terminal State**: Documents in `/users/{userId}/journeyItems/{itemId}` belong strictly to `userId`, require `data.uid == request.auth.uid` matching `userId`, validate against strict `maxLength`/`enum`/`pattern` bounds synced from `firebase-blueprint.json`, enforce server timestamps (`request.time`), and lock updates once `status == 'archived'`.
4. **Path Hardening**: Every single-document path variable (`userId`, `itemId`) must match `^[a-zA-Z0-9_-]+$` and length `<= 128`.
5. **Default-Deny Safety Net**: Any unmatched collection path is unconditionally denied (`allow read, write: if false`).

## 2. "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)
1. **Unauthenticated Write**: Create `journeyItems/item1` with `request.auth == null`.
2. **Unverified Email Write**: Create `journeyItems/item1` with `request.auth.token.email_verified == false`.
3. **Cross-Tenant Identity Spoof**: Signed in as `userA`, write `/users/userB/journeyItems/item1` with `uid: "userB"`.
4. **UID Payload Mismatch**: Signed in as `userA`, write `/users/userA/journeyItems/item1` with `uid: "userB"`.
5. **Shadow Ghost Field Injection**: Write `journeyItems/item1` including extra field `isAdmin: true`.
6. **PII Cross-User Read**: Signed in as `userA`, read `/users/userB/private/info`.
7. **ID Poisoning (>128 chars or special chars)**: Create `/users/userA/journeyItems/bad$id..slash`.
8. **Value Poisoning / Oversized Notes**: Write `journeyItems/item1` with `notes` > 600 chars.
9. **Invalid Enum Status**: Write `journeyItems/item1` with `status: "hacked_status"`.
10. **Forged Client Timestamp**: Create `journeyItems/item1` with `createdAt` not equal to `request.time`.
11. **Immortal Field Mutation**: Update `journeyItems/item1` attempting to modify `createdAt` or `uid`.
12. **Terminal State Bypass**: Update `journeyItems/item1` after `existing().status == 'archived'`.
