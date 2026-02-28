---
---
status: completed
---

**Parent plan:** [plan.md](./plan.md)
**Research:** [researcher-email-otp-report.md](./research/researcher-email-otp-report.md)
**Docs:** [code-standards.md](../../docs/code-standards.md)

---

# Phase 01: Email Module + SMTP Config

**Priority:** P1 | **Status:** completed | **Est:** 0.5h
**Blocks:** Phase 03 (AuthModule needs EmailModule)

## Overview

Create a minimal `EmailModule` with Nodemailer SMTP transport for sending OTP emails. Wire SMTP credentials via ConfigService following existing `app-configuration.ts` pattern.

## Key Insights

- Existing `app-configuration.ts` maps env vars into typed config — follow exact same pattern
- `environment-validation-schema.ts` uses Joi — add SMTP fields there
- Nodemailer is NOT yet installed — need `npm install nodemailer @types/nodemailer`
- Module must be `@Global()` or explicitly imported by AuthModule — prefer explicit import (KISS)

## Architecture

```
src/modules/email/
├── email.module.ts          # NestJS module, exports EmailService
└── email.service.ts         # Nodemailer transport, sendOtp() method
```

Config additions:
```
src/config/app-configuration.ts       # add smtp block
src/config/environment-validation-schema.ts  # add SMTP_* Joi rules
.env.example                          # add SMTP_* vars
```

## Related Code Files

- `src/config/app-configuration.ts` — add `smtp: { host, port, user, pass, from }`
- `src/config/environment-validation-schema.ts` — add Joi validation for SMTP vars
- `src/modules/email/email.service.ts` — **create**
- `src/modules/email/email.module.ts` — **create**
- `.env.example` — add SMTP vars

## Implementation Steps

### Step 1: Install Nodemailer
```bash
npm install nodemailer @types/nodemailer
```

### Step 2: Extend AppConfiguration (`app-configuration.ts`)
Add smtp block to config interface and factory:
```ts
smtp: {
  host: config.get<string>('SMTP_HOST'),
  port: config.get<number>('SMTP_PORT', 587),
  user: config.get<string>('SMTP_USER'),
  pass: config.get<string>('SMTP_PASS'),
  from: config.get<string>('SMTP_FROM'),
},
```

### Step 3: Add Joi validation (`environment-validation-schema.ts`)
```ts
SMTP_HOST: Joi.string().required(),
SMTP_PORT: Joi.number().default(587),
SMTP_USER: Joi.string().required(),
SMTP_PASS: Joi.string().required(),
SMTP_FROM: Joi.string().email().required(),
```

### Step 4: Create `email.service.ts`
```ts
@Injectable()
export class EmailService {
  private transporter: Transporter;

  constructor(private configService: ConfigService<AppConfiguration>) {
    const smtp = this.configService.get('smtp', { infer: true });
    this.transporter = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get('smtp.from', { infer: true }),
      to,
      subject: 'Your password reset code',
      text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.`,
      html: `<p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 10 minutes.</p>`,
    });
  }
}
```

### Step 5: Create `email.module.ts`
```ts
@Module({
  imports: [ConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

### Step 6: Update `.env.example`
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@flowering.app
```

### Step 7: Verify compile
```bash
npm run build
```

## Todo List

- [ ] Install nodemailer + @types/nodemailer
- [ ] Extend AppConfiguration with smtp block
- [ ] Add Joi SMTP validation rules
- [ ] Create `email.service.ts`
- [ ] Create `email.module.ts`
- [ ] Update `.env.example`
- [ ] Verify `npm run build` passes

## Success Criteria

- `EmailService` injectable with `sendOtp(to, otp)` method
- SMTP config type-safe via ConfigService
- Build compiles with no errors
- EmailModule exported and ready for AuthModule import

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Missing SMTP env in dev | Document in .env.example; service fails early with clear ConfigService error |
| nodemailer types mismatch | Use @types/nodemailer matching nodemailer version |

## Security Considerations

- Never log OTP value in email service
- SMTP credentials only from env, never hardcoded
