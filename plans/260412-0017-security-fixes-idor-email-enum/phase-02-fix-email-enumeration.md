## Phase 2: Fix Email Enumeration via Forgot-Password

### Context
- Security review: [Vuln 2 — Email enumeration](../../plans/reports/)
- Severity: **MEDIUM** | Confidence: 9/10

### Overview
- **Priority:** High
- **Status:** Pending
- `forgotPassword()` in `auth.service.ts` returns 404 for non-existent emails and 200 with masked email for existing ones
- Allows unauthenticated enumeration of registered emails
- Rate limit (3/hour) only applies AFTER user-existence check — non-existent email probes are unlimited

### Key Insights
- Line 233: `throw new NotFoundException('Email not found')` — distinct 404 vs 200 leaks registration status
- Line 236-241: Rate limit checks `passwordResetRepository.count()` only after confirming user exists
- Line 259: Returns `{ email: this.maskEmail(email) }` — masked email also confirms registration
- Swagger (controller line 67): explicitly documents 404 for "Email not found"

### Requirements
- Always return HTTP 200 with identical response regardless of email existence
- Apply rate limiting BEFORE user lookup (by email, not by user)
- Remove 404 response from Swagger docs

### Related Code Files
**Modify:**
- `src/modules/auth/auth.service.ts` — fix `forgotPassword()` method
- `src/modules/auth/auth.controller.ts` — remove 404 ApiResponse decorator

### Implementation Steps

1. **Rewrite `forgotPassword()` in `auth.service.ts`** (lines 231-260):
   ```typescript
   async forgotPassword(email: string): Promise<{ message: string }> {
     // Rate limit FIRST — by email, before user lookup
     const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
     const recentCount = await this.passwordResetRepository.count({
       where: { email, createdAt: MoreThan(oneHourAgo) },
     });
     if (recentCount >= 3) {
       throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
     }

     const user = await this.userRepository.findOne({ where: { email } });

     if (user) {
       const otp = crypto.randomInt(100000, 999999).toString();
       const otpHash = this.sha256(otp);
       const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

       await this.passwordResetRepository.save(
         this.passwordResetRepository.create({ email, otpHash, expiresAt }),
       );

       try {
         await this.emailService.sendOtp(email, otp);
       } catch (error) {
         this.logger.warn('Failed to send OTP email', { email: this.maskEmail(email), error });
       }
     }

     // Always return same response
     return { message: 'If that email is registered, you will receive an OTP' };
   }
   ```

2. **Update controller** in `auth.controller.ts`:
   - Remove `@ApiResponse({ status: 404, description: 'Email not found' })` (line 67)
   - Update return type annotation to match new response shape

3. **Run `npm run build`** to verify compilation.

### Todo
- [ ] Rewrite `forgotPassword()` — generic response, rate limit before lookup
- [ ] Remove 404 ApiResponse from controller
- [ ] Verify build passes

### Success Criteria
- `POST /auth/forgot-password` returns identical 200 response for both existing and non-existing emails
- Rate limiting applies before user existence check
- Existing OTP flow still works for valid users
- Swagger no longer advertises 404 for this endpoint

### Risk Assessment
- **Low risk:** Single method rewrite, same OTP generation logic
- **Breaking change:** Frontend may rely on 404 to show "email not found" — needs coordination
  - Mitigation: Flutter app should show generic "check your email" message anyway

### Security Considerations
- Eliminates timing side-channel: rate limit query runs regardless of email existence
- Generic response prevents user enumeration
- Rate limit by email (not by user) prevents unlimited probing of non-existent addresses
