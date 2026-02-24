# Phase 05: Auth Linking

## Context Links
- [Parent Plan](./plan.md)
- [Brainstorm - Linking Section](../reports/brainstorm-260224-1238-anonymous-onboarding-chat.md)
- [AuthService](../../src/modules/auth/auth.service.ts)
- [AuthController](../../src/modules/auth/auth.controller.ts)
- [RegisterDto](../../src/modules/auth/dto/register.dto.ts)
- [AuthModule](../../src/modules/auth/auth.module.ts)
- [AiConversation Entity](../../src/database/entities/ai-conversation.entity.ts)

## Overview
- **Priority:** P2
- **Status:** complete
- **Effort:** 1h
- **Description:** After user registers or logs in, link their anonymous onboarding conversation to their new account. Add optional `sessionToken` param to register DTO. Update AuthService to set `userId` on the matched conversation.

## Key Insights
- Linking is a single UPDATE query: `SET user_id = :userId WHERE session_token = :token`
- Must work for all auth flows: email register, Google OAuth, Apple Sign In
- Session token should be cleared after linking (prevents re-linking)
- Linking is best-effort -- failure should NOT block registration
- AuthModule needs `TypeOrmModule.forFeature([AiConversation])` for the repo

## Requirements

### Functional
- Add optional `sessionToken` field to `RegisterDto`
- Add optional `sessionToken` param to `LoginDto` (returning users may have onboarded)
- Add optional `sessionToken` to Apple auth DTO
- After successful user creation/login, if sessionToken provided, link conversation
- Clear sessionToken + set type to 'authenticated' after linking
- Linking should be non-blocking (log warning on failure, don't throw)

### Non-Functional
- No breaking changes to existing auth API contract
- Backward compatible (sessionToken is optional)

## Architecture

```
Client (after onboarding) -> POST /auth/register { email, password, sessionToken }
                          -> AuthService.register()
                              1. Create user (existing flow)
                              2. If sessionToken -> linkOnboardingSession(userId, sessionToken)
                              3. Return tokens (existing flow)

linkOnboardingSession():
  UPDATE ai_conversations
  SET user_id = :userId,
      session_token = NULL,
      type = 'authenticated'
  WHERE session_token = :token
    AND type = 'anonymous'
```

## Related Code Files

### Files to Modify
- `src/modules/auth/dto/register.dto.ts` (add sessionToken)
- `src/modules/auth/dto/login.dto.ts` (add sessionToken)
- `src/modules/auth/dto/apple-auth.dto.ts` (add sessionToken)
- `src/modules/auth/auth.service.ts` (add linkOnboardingSession, call after register/login)
- `src/modules/auth/auth.module.ts` (add AiConversation to TypeOrmModule)

## Implementation Steps

### Step 1: Update DTOs

**`dto/register.dto.ts`** -- add:
```typescript
@ApiProperty({ required: false, description: 'Onboarding session token to link' })
@IsString()
@IsOptional()
sessionToken?: string;
```

**`dto/login.dto.ts`** -- add same field.

**`dto/apple-auth.dto.ts`** -- add same field.

### Step 2: Update AuthModule

File: `src/modules/auth/auth.module.ts`

```typescript
import { AiConversation } from '../../database/entities/ai-conversation.entity';
// ...
imports: [
  TypeOrmModule.forFeature([User, RefreshToken, AiConversation]),
  // ...rest
],
```

### Step 3: Update AuthService

Add `AiConversation` repository injection:

```typescript
import { AiConversation, AiConversationType } from '../../database/entities/ai-conversation.entity';

constructor(
  // ...existing deps
  @InjectRepository(AiConversation)
  private conversationRepo: Repository<AiConversation>,
) {}
```

Add private linking method:

```typescript
/**
 * Link anonymous onboarding conversation to a user account.
 * Best-effort: logs warning on failure, never throws.
 */
private async linkOnboardingSession(
  userId: string,
  sessionToken: string,
): Promise<void> {
  try {
    const result = await this.conversationRepo.update(
      { sessionToken, type: AiConversationType.ANONYMOUS },
      {
        userId,
        sessionToken: undefined as any, // Clear token (set to NULL)
        type: AiConversationType.AUTHENTICATED,
      },
    );
    if (result.affected === 0) {
      this.logger.warn(`No onboarding session found for token: ${sessionToken}`);
    }
  } catch (error) {
    this.logger.warn('Failed to link onboarding session', { sessionToken, error });
  }
}
```

**Note:** Use `null` instead of `undefined` for clearing. TypeORM's `.update()` with `null` sets the column to NULL.

Update `register()`:
```typescript
async register(dto: RegisterDto): Promise<AuthResponseDto> {
  // ...existing user creation logic...
  await this.userRepository.save(user);

  // Link onboarding session if provided
  if (dto.sessionToken) {
    await this.linkOnboardingSession(user.id, dto.sessionToken);
  }

  return this.generateTokens(user);
}
```

Apply same pattern to `login()`, `appleLogin()` -- call `linkOnboardingSession` if sessionToken present in the DTO/params.

### Step 4: Google OAuth Session Linking

Google OAuth uses redirect flow, so sessionToken must travel through the OAuth state parameter.

**`google.strategy.ts`** — encode sessionToken in state:
```typescript
// When initiating OAuth, client passes sessionToken as query param:
// GET /auth/google?sessionToken=abc-123
// Strategy encodes it in the OAuth state parameter
authenticate(req, options) {
  const sessionToken = req.query.sessionToken;
  const state = sessionToken ? JSON.stringify({ sessionToken }) : undefined;
  super.authenticate(req, { ...options, state });
}
```

**`auth.controller.ts`** — Google callback extracts state:
```typescript
@Get('google/callback')
@Public()
async googleCallback(@Req() req) {
  // Passport populates req.user after OAuth validation
  // Extract sessionToken from OAuth state param
  const state = req.query.state ? JSON.parse(req.query.state) : {};
  return this.authService.oauthLogin(req.user, state.sessionToken);
}
```

**`auth.service.ts`** — oauthLogin accepts sessionToken:
```typescript
async oauthLogin(user: User, sessionToken?: string): Promise<AuthResponseDto> {
  // ...existing OAuth login logic...
  if (sessionToken) {
    await this.linkOnboardingSession(user.id, sessionToken);
  }
  return this.generateTokens(user);
}
```

### Step 5: Add Logger to AuthService

```typescript
private readonly logger = new Logger(AuthService.name);
```

## Todo List
- [ ] Add `sessionToken` to RegisterDto, LoginDto, AppleAuthDto
- [ ] Add AiConversation to AuthModule TypeOrmModule imports
- [ ] Inject AiConversation repo in AuthService
- [ ] Add `linkOnboardingSession` private method
- [ ] Call linking in register(), login(), oauthLogin(), appleLogin()
- [ ] Add Logger to AuthService
- [ ] Run `npm run build`
- [ ] Test: register with valid sessionToken -> verify conversation.user_id is set
- [ ] Test: register without sessionToken -> existing flow unchanged

## Success Criteria
- Registration with `sessionToken` links the onboarding conversation to the new user
- Login with `sessionToken` links conversation to existing user
- `session_token` column cleared after linking
- `type` changed to `'authenticated'` after linking
- Missing/invalid sessionToken doesn't break registration
- Existing auth flows work unchanged when sessionToken is omitted

## Risk Assessment
- **Low:** Optional field = fully backward compatible
- **Low:** Best-effort linking = no impact on auth flow if DB error
- **Medium:** Google OAuth uses redirect flow. sessionToken passed via `state` query param through the OAuth redirect. Requires encoding/decoding state in Google strategy + callback handler.

## Security Considerations
- Session token validated against `type = 'anonymous'` (can't re-link authenticated conversations)
- Token cleared after linking (one-time use)
- No information disclosure: linking failure returns 201 success (best-effort)
- sessionToken in request body (not URL) for POST endpoints

## Next Steps
- Phase 06: Testing
