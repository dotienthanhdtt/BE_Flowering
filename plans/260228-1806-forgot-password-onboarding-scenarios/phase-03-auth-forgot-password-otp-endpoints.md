---
status: completed
---

**Parent plan:** [plan.md](./plan.md)
**Requires:** [Phase 01](./phase-01-email-module-smtp-config.md), [Phase 02](./phase-02-password-reset-entity-migration.md)
**Research:** [researcher-email-otp-report.md](./research/researcher-email-otp-report.md)
**Source:** `src/modules/auth/auth.service.ts`, `auth.controller.ts`, `auth.module.ts`

---

# Phase 03: Auth Forgot Password Flow

**Priority:** P1 | **Status:** completed | **Est:** 1.5h

## Overview

Add 3 new public endpoints to the auth module:
- `POST /auth/forgot-password` — send 6-digit OTP to email (rate: 3/hr per email)
- `POST /auth/verify-otp` — verify OTP, return short-lived reset token (max 5 attempts)
- `POST /auth/reset-password` — set new password, revoke all refresh tokens

## Key Insights (from reading auth.service.ts)

- `crypto` already imported in `auth.service.ts` (`import * as crypto from 'crypto'`)
- `NotFoundException`, `UnauthorizedException`, etc. already available from `@nestjs/common` — need to add `HttpException` + `HttpStatus` for 429
- Existing `logout()` uses `refreshTokenRepository.update({ userId, revoked: false }, { revoked: true })` — reuse this for token revocation after password reset
- Controller pattern: `@Public()`, `@HttpCode(HttpStatus.OK)`, `@ApiOperation`, `@ApiResponse` — follow exactly
- Auth module uses `TypeOrmModule.forFeature([User, RefreshToken, AiConversation])` — add `PasswordReset` here

## Architecture

### OTP/Token Lifecycle

```
forgot-password:
  → validate email exists (User table)
  → rate limit: count PasswordReset records WHERE email=? AND created_at > 1hr ago
  → if count >= 3: throw 429
  → generate otp = crypto.randomInt(100000, 999999).toString()
  → otpHash = sha256(otp)
  → insert PasswordReset { email, otpHash, expiresAt: +10min }
  → EmailService.sendOtp(email, otp)
  → return { email: masked }

verify-otp:
  → find latest PasswordReset WHERE email=? AND used=false AND expiresAt > now
  → if not found: throw 400 "Invalid or expired OTP"
  → increment record.attempts
  → if attempts > 5: throw 400 "Too many attempts"
  → compare sha256(otp) === record.otpHash
  → if mismatch: save incremented attempts, throw 400
  → generate resetToken = crypto.randomUUID()
  → record.resetTokenHash = sha256(resetToken)
  → record.resetTokenExpiresAt = now + 15min
  → save record
  → return { resetToken }

reset-password:
  → sha256Hash = sha256(resetToken)
  → find PasswordReset WHERE resetTokenHash=? AND used=false AND resetTokenExpiresAt > now
  → if not found: throw 400 "Invalid or expired reset token"
  → if found but used=true: throw 401 "Token already used"
  → validate newPassword min 8 chars (DTO handles this)
  → find user by record.email
  → user.passwordHash = bcrypt.hash(newPassword, 12)
  → save user
  → record.used = true; save record
  → revoke all refresh tokens: refreshTokenRepo.update({ userId, revoked: false }, { revoked: true })
  → return null
```

### SHA-256 Helper
```ts
// Pure function, add near top of auth.service.ts
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
```

### Email Masking
```ts
// u***@example.com
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}
```

## Related Code Files

### New files
- `src/modules/auth/dto/forgot-password.dto.ts`
- `src/modules/auth/dto/verify-otp.dto.ts`
- `src/modules/auth/dto/reset-password.dto.ts`

### Modified files
- `src/modules/auth/auth.service.ts` — 3 new methods + sha256/maskEmail helpers + PasswordReset repo injection
- `src/modules/auth/auth.controller.ts` — 3 new endpoints
- `src/modules/auth/auth.module.ts` — import EmailModule, add PasswordReset to TypeOrmModule.forFeature
- `src/modules/auth/dto/index.ts` — export new DTOs

## Implementation Steps

### Step 1: Create DTOs

**`forgot-password.dto.ts`**
```ts
import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}
```

**`verify-otp.dto.ts`**
```ts
import { IsEmail, IsNumberString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNumberString()
  @Length(6, 6)
  otp: string;
}
```

**`reset-password.dto.ts`**
```ts
import { IsUUID, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'uuid-reset-token' })
  @IsUUID()
  resetToken: string;

  @ApiProperty({ example: 'NewSecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
```

### Step 2: Update `dto/index.ts`
Add exports for all 3 new DTOs.

### Step 3: Update `auth.module.ts`
```ts
import { EmailModule } from '../email/email.module';
import { PasswordReset } from '../../database/entities/password-reset.entity';

// in @Module:
imports: [
  TypeOrmModule.forFeature([User, RefreshToken, AiConversation, PasswordReset]),
  EmailModule,
  // ...existing
],
```

### Step 4: Extend `auth.service.ts`

Add to constructor:
```ts
@InjectRepository(PasswordReset)
private passwordResetRepository: Repository<PasswordReset>,
private emailService: EmailService,
```

Add import: `import { PasswordReset } from '../../database/entities/password-reset.entity';`
Add import: `import { EmailService } from '../email/email.service';`
Add import: `import { MoreThan } from 'typeorm';`
Add import: `import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';` (update existing import)

Add sha256 and maskEmail private helpers (top of file or private methods).

Add 3 new methods (full implementation):

```ts
async forgotPassword(email: string): Promise<{ email: string }> {
  const user = await this.userRepository.findOne({ where: { email } });
  if (!user) throw new NotFoundException('Email not found');

  // Rate limit: max 3 requests per hour per email
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await this.passwordResetRepository.count({
    where: { email, createdAt: MoreThan(oneHourAgo) },
  });
  if (recentCount >= 3) {
    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpHash = this.sha256(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // +10min

  await this.passwordResetRepository.save(
    this.passwordResetRepository.create({ email, otpHash, expiresAt }),
  );

  await this.emailService.sendOtp(email, otp);

  return { email: this.maskEmail(email) };
}

async verifyOtp(email: string, otp: string): Promise<{ resetToken: string }> {
  const record = await this.passwordResetRepository.findOne({
    where: { email, used: false, expiresAt: MoreThan(new Date()) },
    order: { createdAt: 'DESC' },
  });
  if (!record) throw new BadRequestException('Invalid or expired OTP');

  record.attempts += 1;
  if (record.attempts > 5) {
    await this.passwordResetRepository.save(record);
    throw new BadRequestException('Too many attempts');
  }

  if (record.otpHash !== this.sha256(otp)) {
    await this.passwordResetRepository.save(record);
    throw new BadRequestException('Invalid or expired OTP');
  }

  const resetToken = crypto.randomUUID();
  record.resetTokenHash = this.sha256(resetToken);
  record.resetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // +15min
  await this.passwordResetRepository.save(record);

  return { resetToken };
}

async resetPassword(resetToken: string, newPassword: string): Promise<void> {
  const tokenHash = this.sha256(resetToken);
  const record = await this.passwordResetRepository.findOne({
    where: { resetTokenHash: tokenHash },
  });

  if (!record || record.used) {
    throw new UnauthorizedException('Token already used');
  }
  if (!record.resetTokenExpiresAt || record.resetTokenExpiresAt < new Date()) {
    throw new BadRequestException('Invalid or expired reset token');
  }

  const user = await this.userRepository.findOne({ where: { email: record.email } });
  if (!user) throw new NotFoundException('User not found');

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await this.userRepository.save(user);

  record.used = true;
  await this.passwordResetRepository.save(record);

  // Revoke all refresh tokens (force re-login on all devices)
  await this.refreshTokenRepository.update({ userId: user.id, revoked: false }, { revoked: true });
}

private sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

private maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}
```

### Step 5: Add 3 endpoints to `auth.controller.ts`

```ts
@Public()
@Post('forgot-password')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Send OTP to email for password reset' })
@ApiResponse({ status: 200, description: 'OTP sent to email' })
@ApiResponse({ status: 404, description: 'Email not found' })
@ApiResponse({ status: 429, description: 'Too many requests' })
async forgotPassword(@Body() dto: ForgotPasswordDto) {
  return this.authService.forgotPassword(dto.email);
}

@Public()
@Post('verify-otp')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Verify OTP and get password reset token' })
@ApiResponse({ status: 200, description: 'OTP verified, reset token returned' })
@ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
async verifyOtp(@Body() dto: VerifyOtpDto) {
  return this.authService.verifyOtp(dto.email, dto.otp);
}

@Public()
@Post('reset-password')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Reset password using reset token' })
@ApiResponse({ status: 200, description: 'Password reset successfully' })
@ApiResponse({ status: 400, description: 'Invalid or expired reset token' })
@ApiResponse({ status: 401, description: 'Token already used' })
async resetPassword(@Body() dto: ResetPasswordDto) {
  await this.authService.resetPassword(dto.resetToken, dto.newPassword);
  return null;
}
```

### Step 6: Verify compile
```bash
npm run build
```

## Todo List

- [ ] Create `forgot-password.dto.ts`
- [ ] Create `verify-otp.dto.ts`
- [ ] Create `reset-password.dto.ts`
- [ ] Export new DTOs from `dto/index.ts`
- [ ] Add PasswordReset + EmailModule to `auth.module.ts`
- [ ] Add `sha256()` and `maskEmail()` helpers to `auth.service.ts`
- [ ] Add `forgotPassword()` method
- [ ] Add `verifyOtp()` method
- [ ] Add `resetPassword()` method
- [ ] Add 3 endpoints to `auth.controller.ts`
- [ ] Verify `npm run build` passes

## Success Criteria

- All 3 endpoints respond correctly per spec
- Rate limit returns 429 after 3 requests/hr
- OTP expires after 10 min
- Reset token expires after 15 min and is single-use
- Password reset revokes all refresh tokens
- All endpoints decorated `@Public()`

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `HttpStatus.TOO_MANY_REQUESTS` (429) not in older NestJS | Verify it exists; fallback to `HttpException('...', 429)` |
| BadRequestException import missing | Add to `@nestjs/common` import destructure |
| verifyOtp finds old non-expired records | Query by `order: { createdAt: 'DESC' }` to get latest |

## Security Considerations

- SHA-256 for all token hashing (never store OTP or reset token in plaintext)
- `crypto.randomInt()` for OTP (CSPRNG, not Math.random)
- `crypto.randomUUID()` for reset token (UUID v4, CSPRNG)
- Revoke all refresh tokens after password reset (prevent session hijacking)
- Never expose whether email exists via timing attacks in OTP response — but spec requires 404 for missing email
