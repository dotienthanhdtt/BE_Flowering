# Unused Database Entities, Enums & DTOs

## UNUSED Entities (Registration Only)
**DeviceToken** (`src/database/entities/device-token.entity.ts`)
- Only registered in `database.module.ts`
- Zero business logic references outside registration
- Associated table `device_tokens` exists in migrations but unused by any service/controller
- Contains internal enum `DevicePlatform` (also unused)

---

## UNUSED Enums
**UserRole** (`src/database/entities/user-role.enum.ts`)
- Defined with values: `USER`, `ADMIN`, `KOL`
- Zero references across entire codebase
- No migration or entity uses this enum type
- Likely legacy or planned for future use

---

## UNUSED DTOs (By Module)

### auth (`src/modules/auth/dto/`)
- **ForgotPasswordDto** (`forgot-password.dto.ts`) – 0 refs
- **ResetPasswordDto** (`reset-password.dto.ts`) – 0 refs  
- **VerifyOtpDto** (`verify-otp.dto.ts`) – 0 refs

### ai (`src/modules/ai/dto/`)
- **TranscribeRequestDto** (`transcribe.dto.ts`) – 0 refs

### onboarding (`src/modules/onboarding/dto/`)
- **OnboardingMessageDto** (`onboarding-messages-response.dto.ts`) – 0 external refs
  - *Note: Self-referenced as property type within `OnboardingMessagesResponseDto`; parent DTO is used, but child is orphaned*

---

## Summary
- **1 unused entity** (registration only, no business logic)
- **1 unused enum** (UserRole)
- **5 unused/orphaned DTOs** (3 auth endpoints, 1 transcribe, 1 response nested class)

**Recommendation:** Remove or implement these features. DTOs suggest incomplete auth flows (forgot password, reset, OTP verification) and STT functionality.
