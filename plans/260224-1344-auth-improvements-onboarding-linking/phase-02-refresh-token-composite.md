# Phase 02: Refresh Token Composite Format

## Context Links
- [Plan overview](plan.md)
- [Brainstorm](../reports/brainstorm-260224-1322-auth-improvements-onboarding-linking.md)
- [auth.service.ts](../../src/modules/auth/auth.service.ts)
- [refresh-token.entity.ts](../../src/database/entities/refresh-token.entity.ts)

## Overview
- **Priority:** CRITICAL
- **Status:** completed
- **Description:** Change refresh token from plain random string to composite `{tokenId}:{secret}` format for O(1) lookup

## Key Insights
- Current `refreshTokens()` loads ALL non-revoked tokens and iterates with bcrypt.compare — O(n) complexity
- RefreshToken entity already has UUID `id` as PK — use this as the tokenId for O(1) indexed lookup
- Composite format: `{entity.id}:{randomSecret}`, store `bcrypt(randomSecret)` in `tokenHash`
- Since Phase 01 revokes all tokens, no backward compatibility needed
- `generateTokens()` creates the composite token; `refreshTokens()` splits and does single lookup

## Requirements
### Functional
- `generateTokens()`: create composite token `{uuid}:{hex}`, store uuid as entity id, bcrypt(hex) as tokenHash
- `refreshTokens()`: split on `:`, findOne by id, single bcrypt.compare
- Return composite token to client (transparent to frontend)

### Non-functional
- O(1) token lookup (indexed PK query)
- Single bcrypt.compare per refresh request
- No change to API contract (still accepts/returns string token)

## Architecture

**Token Generation:**
```
tokenId = uuid()  (or use TypeORM auto-generated)
secret = randomBytes(32).hex()
rawToken = `${tokenId}:${secret}`
hash = bcrypt(secret, 10)
store: { id: tokenId, tokenHash: hash, userId, expiresAt }
return rawToken to client
```

**Token Verification:**
```
[tokenId, secret] = rawToken.split(':')
if (!tokenId || !secret) → UnauthorizedException
storedToken = findOne({ id: tokenId, revoked: false }, relations: ['user'])
if (!storedToken || expired) → UnauthorizedException
isValid = bcrypt.compare(secret, storedToken.tokenHash)
if (!isValid) → UnauthorizedException
revoke old token, generate new tokens
```

## Related Code Files
- **Modify:** `src/modules/auth/auth.service.ts` — `generateTokens()` and `refreshTokens()` methods

## Implementation Steps

1. Update `generateTokens()` in `auth.service.ts`:
   a. Generate `tokenId` as UUID (`crypto.randomUUID()`)
   b. Generate `secret` as `crypto.randomBytes(32).toString('hex')`
   c. Create composite `rawToken = ${tokenId}:${secret}`
   d. Hash only the secret: `bcrypt.hash(secret, 10)`
   e. Create RefreshToken entity with explicit `id: tokenId`
   f. Return `rawToken` as the refresh token

2. Update `refreshTokens()` in `auth.service.ts`:
   a. Split incoming token on `:`
   b. Validate format (must have exactly 2 parts)
   c. `findOne({ where: { id: tokenId, revoked: false }, relations: ['user'] })`
   d. Check expiry
   e. Single `bcrypt.compare(secret, storedToken.tokenHash)`
   f. Revoke and generate new tokens

3. Run `npm run build` to verify

## Todo List
- [x] Update `generateTokens()` with composite format
- [x] Update `refreshTokens()` with O(1) lookup
- [x] Verify build compiles
- [x] Manual review of token flow

## Success Criteria
- `generateTokens()` returns composite token format `uuid:hex`
- `refreshTokens()` does single DB lookup + single bcrypt compare
- No O(n) scan of all tokens
- Build compiles without errors

## Risk Assessment
- **Token format change:** All existing tokens revoked in Phase 01, so no backward compat needed
- **UUID collision:** Essentially impossible with v4 UUID
- **Split edge case:** Validate token contains exactly one `:` separator

## Security Considerations
- Secret part (32 bytes hex = 256 bits) provides sufficient entropy
- bcrypt still protects stored hash against DB compromise
- tokenId is not secret — only the secret part needs protection

## Next Steps
- Phase 05 will update tests for new token format
