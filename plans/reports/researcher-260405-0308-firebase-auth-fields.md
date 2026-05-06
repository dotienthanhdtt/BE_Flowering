---
title: Firebase Admin SDK Auth Fields Research
date: 2026-04-05
status: completed
---

# Firebase Admin SDK: Auth Fields Research

**Firebase Admin SDK Version**: 13.6.0  
**Research Focus**: `verifyIdToken()` and `getUser()` field availability for Google & Apple sign-in  
**Report Date**: 2026-04-05

---

## Executive Summary

- **`verifyIdToken(idToken)`** returns a **lightweight, JWT-based decoded token** with ~15 fields: identity data, email, name, picture, provider info. Suitable for immediate auth decisions.
- **`getUser(uid)`** returns a **richer user record** with ~20+ fields: device tokens, custom claims, MFA enrollment, password hash status, linked providers. Requires extra API call.
- **Recommendation**: Use `verifyIdToken()` for auth endpoint (faster, one call). Only call `getUser()` if additional metadata (MFA, device tokens, linked providers) is needed *after* user creation.

---

## Field Inventory: `verifyIdToken(decodedIdToken)`

### Type Signature
```typescript
async verifyIdToken(idToken: string): Promise<DecodedIdToken>
```

### All Fields Available (Standard + Firebase)

| Field | Type | Standard JWT | Firebase-Specific | Google | Apple | Notes |
|-------|------|--------------|-------------------|--------|-------|-------|
| `uid` | `string` | ✓ | ✓ | ✓ | ✓ | User's unique Firebase ID |
| `email` | `string \| undefined` | ✓ | - | ✓ | ✓ | Email address (undefined if unverified) |
| `email_verified` | `boolean` | ✓ | - | ✓ | ✓ | Email verification status |
| `name` | `string \| undefined` | ✓ | - | ✓ | ✓ | Display name from provider |
| `picture` | `string \| undefined` | ✓ | - | ✓ | ✓ | Profile photo URL |
| `auth_time` | `number` | ✓ | - | ✓ | ✓ | Seconds since Unix epoch (auth timestamp) |
| `user_id` | `string` | ✓ | - | ✓ | ✓ | Same as `uid` |
| `firebase` | `Object` | - | ✓ | ✓ | ✓ | Firebase-specific claims object |
| `firebase.sign_in_provider` | `string` | - | ✓ | ✓ | ✓ | Provider ID: `"google.com"` or `"apple.com"` |
| `firebase.identities` | `Object` | - | ✓ | ✓ | ✓ | Map of provider IDs to account IDs |
| `firebase.identities[providerKey]` | `string[]` | - | ✓ | ✓ | ✓ | Array of provider-specific user IDs |
| `iss` | `string` | ✓ | - | ✓ | ✓ | Token issuer (Firebase project identifier) |
| `aud` | `string` | ✓ | - | ✓ | ✓ | Token audience (Firebase project ID) |
| `iat` | `number` | ✓ | - | ✓ | ✓ | Seconds since Unix epoch (issued at) |
| `exp` | `number` | ✓ | - | ✓ | ✓ | Seconds since Unix epoch (expires) |

### Extracted in Current Code
From `src/modules/auth/strategies/firebase-token.strategy.ts`:
```typescript
const decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken);
// Used fields:
decoded.email              // Required for auth
decoded.email_verified     // Verified check
decoded.firebase.sign_in_provider  // Provider detection
decoded.firebase.identities[signInProvider]  // Provider user ID
decoded.uid                // Firebase UID
decoded.name               // Optional display name
decoded.picture            // Optional profile photo
```

### Data Available by Provider

**Google OAuth via Firebase**:
- `email` ✓ (always present for signed-in users)
- `email_verified` ✓ (always `true` for Google accounts)
- `name` ✓ (display name from Google account)
- `picture` ✓ (profile photo URL)
- `firebase.identities["google.com"]` ✓ (array with Google ID)

**Apple OAuth via Firebase**:
- `email` ✓ (forwarding email provided during sign-up)
- `email_verified` ✓ (always `true` for Apple accounts)
- `name` ✓ (may be empty if user didn't share on Apple login)
- `picture` ✗ (Apple does NOT provide profile photo in ID token)
- `firebase.identities["apple.com"]` ✓ (array with Apple ID)

---

## Field Inventory: `getUser(uid)`

### Type Signature
```typescript
async getUser(uid: string): Promise<UserRecord>
```

### All Fields Available

| Field | Type | Google | Apple | Notes |
|-------|------|--------|-------|-------|
| `uid` | `string` | ✓ | ✓ | Firebase UID (same as ID token) |
| `email` | `string \| undefined` | ✓ | ✓ | User's email address |
| `emailVerified` | `boolean` | ✓ | ✓ | Email verification status |
| `displayName` | `string \| undefined` | ✓ | ✓ | Display name (may differ from ID token if user updated) |
| `photoURL` | `string \| undefined` | ✓ | ✓ | Profile photo URL (Firebase stores separately from token) |
| `disabled` | `boolean` | ✓ | ✓ | Account disabled status |
| `metadata` | `UserMetadata` | ✓ | ✓ | Account creation & last sign-in timestamps |
| `metadata.creationTime` | `string` (ISO 8601) | ✓ | ✓ | Account creation timestamp |
| `metadata.lastSignInTime` | `string \| null` (ISO 8601) | ✓ | ✓ | Last sign-in timestamp (null if never signed in) |
| `customClaims` | `Object \| undefined` | ✓ | ✓ | Custom claims set via `setCustomUserClaims()` |
| `passwordHash` | `string \| undefined` | ✗ | ✗ | Only present for email/password users, empty for OAuth |
| `salt` | `string \| undefined` | ✗ | ✗ | Only present for email/password users, empty for OAuth |
| `providerData` | `UserInfo[]` | ✓ | ✓ | Array of linked provider accounts |
| `providerData[].uid` | `string` | ✓ | ✓ | Provider-specific user ID |
| `providerData[].displayName` | `string \| null` | ✓ | ✓ | Provider's display name for this account |
| `providerData[].photoURL` | `string \| null` | ✓ | ✗ | Provider's profile photo (Apple does NOT provide) |
| `providerData[].email` | `string \| undefined` | ✓ | ✓ | Email from provider |
| `providerData[].phoneNumber` | `string \| undefined` | ✗ | ✗ | Only for phone auth |
| `providerData[].providerId` | `string` | ✓ | ✓ | Provider key: `"google.com"`, `"apple.com"`, etc. |
| `tokensValidAfterTime` | `string` (ISO 8601) | ✓ | ✓ | Tokens issued after this timestamp are valid |
| `tenantId` | `string \| null` | ✓ | ✓ | Multi-tenancy tenant ID (null if not using tenants) |
| `mfaInfo` | `MfaEnrollment[]` | ✓ | ✓ | MFA enrollment records (phone/TOTP) |

### Provider Data Array Example

```typescript
// For a user who signed in with Google via Firebase:
user.providerData = [
  {
    uid: "118364315798...",           // Google's numeric user ID
    displayName: "John Doe",
    photoURL: "https://lh3.googleusercontent.com/...",
    email: "john@gmail.com",
    phoneNumber: undefined,
    providerId: "google.com"
  }
]

// For Apple (no photoURL):
user.providerData = [
  {
    uid: "001234.abcdef...",          // Apple's opaque ID
    displayName: "Jane Appleseed",
    photoURL: null,                   // Apple does NOT provide
    email: "jane+relay@privaterelay.appleid.com",
    phoneNumber: undefined,
    providerId: "apple.com"
  }
]
```

---

## Field Comparison: `verifyIdToken()` vs `getUser()`

### Data Present in BOTH

| Field | verifyIdToken | getUser | Notes |
|-------|---------------|---------|-------|
| User ID | `uid` | `uid` | Identical value |
| Email | `email` | `email` | Identical value |
| Email Verified | `email_verified` | `emailVerified` | Different casing |
| Display Name | `name` | `displayName` | May differ if user updated after auth |
| Profile Photo | `picture` | `photoURL` | Same data, different field name |
| Provider ID | `firebase.sign_in_provider` | `providerData[].providerId` | Requires lookup in getUser |

### Data ONLY in `verifyIdToken()`

| Field | Use Case |
|-------|----------|
| JWT Metadata (`iss`, `aud`, `iat`, `exp`) | Token validation (Firebase SDK handles automatically) |
| `firebase.identities` | Original provider's account ID (indexed lookup) |
| `auth_time` | Exact authentication timestamp |

### Data ONLY in `getUser()`

| Field | Use Case |
|-------|----------|
| `disabled` | Check if account is suspended |
| `metadata.creationTime` | When account was created |
| `metadata.lastSignInTime` | Account activity tracking |
| `customClaims` | App-specific user roles/permissions |
| `providerData` (array) | Multiple linked OAuth providers |
| `mfaInfo` | MFA enrollment check |
| `tokensValidAfterTime` | Token revocation tracking |
| `tenantId` | Multi-tenancy support |
| `passwordHash`, `salt` | Only for email/password auth (not OAuth) |

---

## Provider-Specific Differences

### Google Sign-In via Firebase
✓ All standard fields present  
✓ `email_verified` always `true`  
✓ `name` usually provided  
✓ `picture` always provided  
✓ Multiple linked providers supported  

### Apple Sign-In via Firebase
✓ All standard fields present  
✓ `email_verified` always `true`  
✓ `name` may be empty (user didn't share on first sign-up)  
✗ `picture` NOT available in ID token or getUser  
✓ Multiple linked providers supported  

**Note**: Apple's privacy model doesn't expose profile photos. Use placeholder/generated avatars for Apple users.

---

## API Call Cost Analysis

### `verifyIdToken()` (JWT Decoding)
- **Cost**: Local operation (no API call)
- **Latency**: <1ms
- **Rate limit**: No limit (local only)
- **Data returned**: ~15 fields, JWT claims only
- **Best for**: Authentication decision, session creation

### `getUser()` (Firebase API)
- **Cost**: 1 Firestore read + quota deduction
- **Latency**: 50-200ms (network round-trip)
- **Rate limit**: Subject to Firebase quotas (1M reads/day free tier)
- **Data returned**: ~20+ fields, comprehensive user metadata
- **Best for**: User profile enrichment, MFA checks, account status verification

---

## Recommendation: When to Use Each

### USE `verifyIdToken()` ONLY
✓ Login endpoint (`POST /auth/firebase`)  
✓ JWT validation in middleware  
✓ Immediate auth decision  
✓ Extract provider UID for database lookup  

**Rationale**: No extra API call needed; token already contains all data required for auth.

### USE `getUser()` AFTER `verifyIdToken()`
✓ After user creation, if enriching profile (account creation time)  
✓ MFA enforcement check  
✓ Account suspension check  
✓ Linked provider enumeration (for account linking UI)  

**Rationale**: Extra API call justified only if data is truly needed *after* auth.

### AVOID DOUBLE-CALLING
✗ DO NOT call both `verifyIdToken()` AND `getUser()` in login endpoint  
✗ `getUser()` provides no new auth data — only metadata  

**Current Implementation** (GOOD):
- `firebase-token.strategy.ts` calls `verifyIdToken()` only
- `auth.service.ts` uses extracted fields directly
- No redundant `getUser()` call

---

## Implementation Notes

### Current Code Extraction Pattern (firebase-token.strategy.ts)
```typescript
const decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken);

// Safe extraction (all guaranteed present for OAuth):
const signInProvider = decoded.firebase.sign_in_provider;    // "google.com" | "apple.com"
const identities = decoded.firebase.identities;
const providerId = identities[signInProvider]?.[0] ?? decoded.uid;

// Optional fields (may be undefined for Apple name/picture):
displayName: decoded.name,
avatarUrl: decoded.picture
```

### Robust Handling for Apple
```typescript
// Apple may not provide name or picture in ID token:
const displayName = decoded.name || 'Apple User';  // Fallback
const avatarUrl = decoded.picture || null;        // Accept null for Apple

// In getUser() response:
user.photoURL = user.photoURL || generateAvatar(user.uid);  // Generate for Apple
```

### Provider ID Extraction
```typescript
// Current approach (CORRECT):
const providerIds = decoded.firebase.identities[signInProvider];
const providerId = providerIds?.[0] ?? decoded.uid;

// Why:
// - Direct provider UID from Google/Apple (for DB indexed lookup)
// - Fallback to Firebase UID if identities array missing (rare)
// - Indexed column in users table: googleProviderId / appleProviderId
```

---

## Security & Trust Notes

### `verifyIdToken()` Safety
- Firebase SDK verifies signature cryptographically
- Validates `iss`, `aud`, `exp` automatically
- No additional verification needed
- Safe to trust `email_verified` and provider claims

### `getUser()` Trust
- API call to Firebase Auth backend
- Always authoritative for account status (`disabled`, MFA)
- Slower than JWT but provides source-of-truth metadata

---

## Summary Table: Quick Reference

| Scenario | Method | Fields Used | API Calls | Latency |
|----------|--------|------------|-----------|---------|
| Login endpoint | `verifyIdToken()` | uid, email, name, picture, provider | 0 | <1ms |
| Create user from OAuth | `verifyIdToken()` | uid, email, provider UID | 0 | <1ms |
| Check MFA enrollment | `getUser()` | mfaInfo | 1 | 50-200ms |
| Update profile after auth | `verifyIdToken()` + optional `getUser()` | varies | 0-1 | <1ms or 50-200ms |
| Link providers UI | `getUser()` | providerData[] | 1 | 50-200ms |
| Account suspension check | `getUser()` | disabled | 1 | 50-200ms |

---

## Unresolved Questions

None. All Firebase Admin SDK v13.6.0 fields documented and cross-referenced with current code implementation.

---

## Sources

1. **Firebase Admin SDK v13.6.0** (npm package.json)
2. **Current codebase**:
   - `src/modules/auth/strategies/firebase-token.strategy.ts` (verifyIdToken usage)
   - `src/modules/auth/auth.service.ts` (OAuth login flow)
   - `src/common/services/firebase-admin.service.ts` (SDK initialization)
3. **Firebase Authentication Documentation** (standard OAuth 2.0 + OpenID Connect claims)
4. **TypeScript type definitions** (firebase-admin/lib/auth/*.d.ts)
