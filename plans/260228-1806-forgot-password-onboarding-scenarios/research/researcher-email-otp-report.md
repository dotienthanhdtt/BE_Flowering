# NestJS Nodemailer & OTP Security Research Report

**Research Date:** 2026-02-28 | **Focus:** Practical code patterns for password reset flows

---

## Topic 1: NestJS Nodemailer Email Module Patterns

### EmailModule Architecture
```typescript
// email.module.ts - NestJS module following project pattern
@Module({
  imports: [ConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

### EmailService with ConfigService Injection
```typescript
@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: true,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendPasswordReset(email: string, resetLink: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM'),
      to: email,
      subject: 'Reset Your Password',
      text: `Click here: ${resetLink}`,
      html: `<a href="${resetLink}">Reset Password</a>`,
    });
  }
}
```

**Integration Pattern:** Add SMTP_* to `app-configuration.ts` config interface following existing pattern.

---

## Topic 2: OTP Security for Password Reset

### 1. Secure 6-Digit OTP Generation
```typescript
// Cryptographically secure using crypto module
const otp = crypto.randomInt(100000, 999999);
// Result: integer 100000-999999, suitable for numeric OTP
```

### 2. SHA-256 Hashing Pattern (No Bcrypt for OTPs)
```typescript
import * as crypto from 'crypto';

// Hash OTP before storing in DB
const otpString = String(otp).padStart(6, '0');
const hashedOtp = crypto
  .createHash('sha256')
  .update(otpString + salt)
  .digest('hex');

// On verification, hash incoming OTP and compare
const incomingHashed = crypto
  .createHash('sha256')
  .update(incomingOtp + salt)
  .digest('hex');

const isValid = incomingHashed === hashedOtp;
```

**Why SHA-256 not Bcrypt:** OTPs are short-lived, hashing provides timing consistency. Bcrypt designed for passwords with slow iterations (unnecessary here).

### 3. TypeORM Rate Limiting via DB Count
```typescript
// PasswordResetAttempt entity
@Entity('password_reset_attempts')
export class PasswordResetAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  email: string;

  @Column()
  createdAt: Date;
}

// Rate limiting in service
async validateRateLimit(email: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAttempts = await this.attemptRepository.count({
    where: {
      email,
      createdAt: MoreThan(oneHourAgo),
    },
  });
  return recentAttempts < 3; // Max 3 attempts per hour
}
```

### 4. One-Time-Use Token Pattern
```typescript
// PasswordResetToken entity - UUID + SHA-256 + used flag
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  hashedToken: string;

  @Column()
  email: string;

  @Column({ default: false })
  used: boolean;

  @Column({ type: 'timestamp' })
  expiresAt: Date;
}

// Generation
const token = crypto.randomUUID(); // Cryptographically secure
const hashedToken = crypto
  .createHash('sha256')
  .update(token)
  .digest('hex');

// Store hashedToken in DB, return plain token to user
// Verification checks hashedToken != used && expiresAt > now
```

---

## Key Implementation Notes

1. **Rate Limiting:** Use database count with `MoreThan(date)` to enforce max attempts per time window
2. **Token Expiry:** Always verify `expiresAt` timestamp before allowing reset
3. **Used Flag:** Prevent token reuse—set `used = true` after successful validation
4. **Hash Salt:** Use email or unique value to prevent rainbow tables
5. **Config Pattern:** Follow existing `AppConfiguration` interface for SMTP settings
6. **Injection:** Use `@InjectRepository()` for database access like existing auth module

---

## Security Checklist
- [ ] OTP transmitted via HTTPS only
- [ ] Hashed tokens stored in DB, never plaintext
- [ ] Rate limiting enforced at service layer
- [ ] Token expiry always validated
- [ ] Tokens marked as used after consumption
- [ ] SMTP credentials in environment variables
