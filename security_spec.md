# Plus AI Firestore Security Specification

## 1. Data Invariants
1. **Strict Admin Gate**: Only an authenticated user with verified email `poppqwe9k@gmail.com` (`request.auth.token.email == 'poppqwe9k@gmail.com' && request.auth.token.email_verified == true`) is authorized to read `/analytics/site`, list `/users`, or modify another user's `plan`, `dailyLimit`, or `remainingCredits`.
2. **Account Ownership & Anti-Escalation**: Regular users may only `get`, `create`, and perform bounded self-updates on `/users/{uid}` where `uid == request.auth.uid`. On self-creation, `plan` MUST equal `'free'`, `dailyLimit` MUST equal `3`, and `remainingCredits` MUST equal `3`.
3. **Immutable Audit Fields**: `uid` and `createdAt` on `/users/{uid}` are immutable after creation, and `updatedAt` / `lastActiveAt` MUST equal `request.time`.
4. **Action-Bounded Mutations**: Regular users cannot modify `plan` or `dailyLimit` and cannot increase `remainingCredits` in any way outside of a verified 24h cycle renewal back to their `dailyLimit`; only the verified admin can increase a user's quota or credits.
5. **Private Per-User Chat Isolation**: Conversations under `/users/{uid}/chats/{chatId}` belong strictly to `ownerUid == uid == request.auth.uid` with parent existence verified via Master Gate (`get(/databases/$(database)/documents/users/$(uid)).data.uid == request.auth.uid` on single-doc ops) and `resource.data.ownerUid == request.auth.uid` on `list`. No other user (not even another signed-in account) may read, list, create, modify, or delete another account's chats.
6. **Analytics Privacy & Delta Integrity**: `/analytics/site` cannot be read or listed by non-admins. Authenticated users may only increment `totalVisits` or `registeredUsersCount` by at most `+1` per operation.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read of `/users/{uid}` or `/users/{uid}/chats/{chatId}`**: `request.auth == null` attempting `get` or `list`.
2. **Cross-User PII & Chat Read**: Authenticated `userA` attempting `get` or `list` on `/users/userB` or `/users/userB/chats`.
3. **Cross-User Chat Injection**: Authenticated `userA` attempting `create` on `/users/userB/chats/c1` or setting `ownerUid: 'userB'` on `/users/userA/chats/c1`.
4. **Email Spoofing Admin Bypass**: Authenticated user with `email: 'poppqwe9k@gmail.com'` and `email_verified: false` attempting `list` on `/users` or `get` on `/analytics/site`.
5. **Self-Privilege Escalation on Create**: New user creating `/users/{uid}` with `plan: 'vip'`, `dailyLimit: 999`, or `remainingCredits: 500`.
6. **Shadow Field Injection**: User creating or updating `/users/{uid}` or `/users/{uid}/chats/{chatId}` with extra field `isAdmin: true` or `role: 'admin'`.
7. **Self-Plan Upgrade on Update**: User updating own `/users/{uid}` changing `plan` from `'free'` to `'vip'` or `dailyLimit` from `3` to `100`.
8. **Arbitrary Credit Inflation**: User updating own `/users/{uid}` attempting to increase `remainingCredits` (e.g., from `0` to `5` or `999`).
9. **Client Timestamp Forgery**: User creating `/users/{uid}` or `/users/{uid}/chats/{chatId}` with past/future client-supplied `createdAt` instead of `request.time`.
10. **Immutable Ownership / Audit Mutation**: User updating `/users/{uid}/chats/{chatId}` trying to alter `id`, `ownerUid`, `createdAt`, or `createdAtMs`.
11. **Non-Admin Analytics Read**: Authenticated regular user attempting `get` on `/analytics/site`.
12. **Analytics Counter Flooding / Tampering**: Regular user attempting to update `/analytics/site` setting `totalVisits: 999999` or resetting `totalVisits: 0`.
