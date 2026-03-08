# API Documentation

**Last Updated:** 2026-03-08
**Base URL:** `http://localhost:3000` (development)
**API Version:** 1.0

## Overview

RESTful API for AI-powered language learning application. All endpoints except webhooks and public auth require JWT authentication via Bearer token. All responses wrapped in standard format: `{code: 1, message, data}` (code 1 = success, 0 = error).

## Response Format

### Success Response (code: 1)
```json
{
  "code": 1,
  "message": "Success message",
  "data": {...}
}
```

### Error Response (code: 0)
```json
{
  "code": 0,
  "message": "Error description",
  "data": null
}
```

## Authentication

### Bearer Token Format
```
Authorization: Bearer <jwt_token>
```

### Token Details
- Default expiry: 7 days
- Algorithm: HS256
- Public routes: Use @Public() decorator

## Endpoints

### Authentication (POST /auth/*)

#### POST /auth/register
Register new user account.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response (201):** `{code: 1, message: "User registered", data: {access_token, user: {id, email, name}}}`

**Errors:** 400 (invalid input), 409 (email exists)

---

#### POST /auth/login
Login with email and password.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200):** `{code: 1, message: "Logged in", data: {access_token, user: {...}}}`

**Errors:** 401 (invalid credentials)

---

#### POST /auth/google
Google ID token authentication.

**Auth:** Not required | **Request:**
```json
{
  "idToken": "google_id_token",
  "displayName": "John Doe",
  "sessionToken": "optional_session_id"
}
```

**Response (200):** `{code: 1, message: "Authenticated", data: {access_token, user: {...}}}`

**Behavior:**
- Verifies ID token via Google Auth Library
- Auto-links to existing email
- Creates new account if email not found
- Stores googleProviderId

**Errors:** 401 (invalid token), 400 (missing idToken)

---

#### POST /auth/apple
Apple Sign-In authentication.

**Auth:** Not required | **Request:**
```json
{
  "identityToken": "apple_identity_token",
  "user": {
    "email": "user@privaterelay.appleid.com",
    "name": "John Doe"
  }
}
```

**Response (200):** `{code: 1, message: "Authenticated", data: {access_token, user: {...}}}`

**Errors:** 401 (invalid token)

---

#### POST /auth/refresh
Refresh access token.

**Auth:** Not required | **Request:**
```json
{
  "refreshToken": "uuid:hex"
}
```

**Response (200):** `{code: 1, message: "Token refreshed", data: {access_token, refreshToken}}`

**Errors:** 401 (invalid/expired token)

---

#### POST /auth/logout
Invalidate refresh token.

**Auth:** Required | **Response (200):** `{code: 1, message: "Logged out", data: null}`

---

#### POST /auth/forgot-password
Request password reset via OTP.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):** `{code: 1, message: "OTP sent to email", data: null}`

---

#### POST /auth/verify-otp
Verify OTP code.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Response (200):** `{code: 1, message: "OTP verified", data: {resetToken}}`

**Errors:** 400 (invalid/expired OTP), 429 (too many attempts)

---

#### POST /auth/reset-password
Reset password with reset token.

**Auth:** Not required | **Request:**
```json
{
  "email": "user@example.com",
  "resetToken": "token_from_verify_otp",
  "newPassword": "NewPassword123!"
}
```

**Response (200):** `{code: 1, message: "Password reset", data: null}`

**Errors:** 400 (invalid token/password)

---

### User Management (GET/PATCH /users/me)

#### GET /users/me
Get current user profile.

**Auth:** Required | **Response (200):** `{code: 1, message: "User found", data: {id, email, name, profilePicture, emailVerified, createdAt, updatedAt}}`

---

#### PATCH /users/me
Update user profile.

**Auth:** Required | **Request:**
```json
{
  "name": "Jane Doe",
  "profilePicture": "https://example.com/avatar.jpg"
}
```

**Response (200):** `{code: 1, message: "Profile updated", data: {...}}`

---

### Subscriptions

#### GET /subscriptions/me
Get subscription status.

**Auth:** Required | **Response (200):** `{code: 1, message: "Subscription found", data: {id, plan, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd}}`

**Plan types:** free, monthly, yearly, lifetime
**Status types:** active, trial, expired, cancelled

---

#### POST /webhooks/revenuecat
RevenueCat webhook endpoint.

**Auth:** Bearer token (REVENUECAT_WEBHOOK_SECRET) | **Request:**
```json
{
  "event": {
    "type": "INITIAL_PURCHASE|RENEWAL|CANCELLATION|EXPIRATION|PRODUCT_CHANGE",
    "app_user_id": "user_uuid",
    "product_id": "monthly_subscription",
    "purchased_at_ms": 1706976000000,
    "expiration_at_ms": 1709654400000
  }
}
```

**Response (200):** `{code: 1, message: "Webhook received", data: {status: "received"}}`

**Processing:** Async (responds <60s)

---

### Push Notifications

#### POST /notifications/devices
Register FCM device token.

**Auth:** Required | **Request:**
```json
{
  "token": "firebase_fcm_token",
  "platform": "ios|android|web",
  "deviceName": "iPhone 15 Pro"
}
```

**Response (200):** `{code: 1, message: "Device registered", data: null}`

---

#### DELETE /notifications/devices/:token
Unregister device.

**Auth:** Required | **Response (200):** `{code: 1, message: "Device unregistered", data: null}`

---

### Languages

#### GET /languages
List available languages (public).

**Auth:** Not required | **Query params:** type=native|learning

**Response (200):** `{code: 1, message: "Languages found", data: [{id, code, name, nativeName, flagUrl, isActive}]}`

---

#### GET /languages/user
Get user's learning languages.

**Auth:** Required | **Response (200):** `{code: 1, message: "User languages found", data: [...]}`

---

#### POST /languages/user
Add language to learning list.

**Auth:** Required | **Request:**
```json
{
  "languageId": "uuid",
  "proficiencyLevel": "beginner|intermediate|advanced|native"
}
```

**Response (201):** `{code: 1, message: "Language added", data: {...}}`

---

#### PATCH /languages/user/:languageId
Update language proficiency.

**Auth:** Required | **Request:**
```json
{
  "proficiencyLevel": "intermediate"
}
```

**Response (200):** `{code: 1, message: "Language updated", data: {...}}`

---

#### PATCH /languages/user/native
Set native language.

**Auth:** Required | **Request:**
```json
{
  "languageId": "uuid"
}
```

**Response (200):** `{code: 1, message: "Native language set", data: {...}}`

---

#### DELETE /languages/user/:languageId
Remove language.

**Auth:** Required | **Response (200):** `{code: 1, message: "Language removed", data: null}`

---

### AI Features

#### POST /ai/chat
Chat with AI tutor.

**Auth:** Required | **Rate Limit:** 20 req/min, 100 req/hr | **Request:**
```json
{
  "message": "How do I use the past tense in Spanish?",
  "conversationId": "uuid",
  "language": "spanish",
  "level": "beginner",
  "model": "gpt-4o"
}
```

**Response (200):** `{code: 1, message: "Response generated", data: {conversationId, response, aiProvider, tokensUsed}}`

---

#### SSE /ai/chat/stream
Stream chat response (Server-Sent Events).

**Auth:** Required | **Request:** Same as POST /ai/chat

**Response:** Streaming text chunks

---

#### POST /ai/grammar/check
Check grammar and get feedback.

**Auth:** Required | **Request:**
```json
{
  "text": "I goed to the store yesterday",
  "language": "english",
  "targetLanguage": "english"
}
```

**Response (200):** `{code: 1, message: "Grammar checked", data: {originalText, correctedText, errors: [{type, original, correction, explanation}], score}}`

---

#### POST /ai/exercises/generate
Generate language exercises.

**Auth:** Required | **Request:**
```json
{
  "language": "spanish",
  "level": "beginner",
  "type": "vocabulary|grammar|conversation"
}
```

**Response (200):** `{code: 1, message: "Exercises generated", data: [{type, prompt, expectedAnswer, difficulty}]}`

---

#### POST /ai/pronunciation/assess
Assess pronunciation from audio.

**Auth:** Required | **Request:** Multipart form with audio file

**Response (200):** `{code: 1, message: "Pronunciation assessed", data: {score, feedback, suggestions}}`

---

#### POST /ai/conversations
Start new conversation session.

**Auth:** Required | **Request:**
```json
{
  "language": "spanish",
  "topic": "daily_life"
}
```

**Response (201):** `{code: 1, message: "Conversation started", data: {conversationId}}`

---

#### GET /ai/conversations/:id/messages
Get conversation history.

**Auth:** Required | **Response (200):** `{code: 1, message: "Messages found", data: [{role, content, model, tokensUsed, createdAt}]}`

---

### Onboarding (No Auth Required)

#### POST /onboarding/start
Start anonymous onboarding session.

**Auth:** Not required | **Request:**
```json
{
  "nativeLanguage": "english"
}
```

**Response (200):** `{code: 1, message: "Session started", data: {sessionId, expiresAt}}`

---

#### POST /onboarding/chat
Chat in onboarding session.

**Auth:** Not required | **Request:**
```json
{
  "sessionId": "session_token",
  "message": "I want to learn Spanish"
}
```

**Response (200):** `{code: 1, message: "Response generated", data: {response, turnCount, maxTurns}}`

---

#### POST /onboarding/complete
Complete onboarding and extract profile.

**Auth:** Not required | **Request:**
```json
{
  "sessionId": "session_token"
}
```

**Response (200):** `{code: 1, message: "Onboarding completed", data: {extractedProfile: {languages, interests, level}}}`

---

## Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| 200 | OK | Request successful |
| 201 | Created | Resource created |
| 400 | Bad Request | Invalid input |
| 401 | Unauthorized | Missing/invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource exists |
| 500 | Server Error | Internal error |
| 503 | Service Unavailable | External service down |

## Rate Limiting

**AI Endpoints:**
- Free users: 100 requests/hour
- Premium users: 1000 requests/hour
- Per-user rate limiting enforced

## CORS Configuration

**Allowed Origins:** Via CORS_ALLOWED_ORIGINS env var

**Allowed Methods:** GET, POST, PATCH, DELETE, OPTIONS

**Allowed Headers:** Authorization, Content-Type

## Webhook Security

**RevenueCat:** Bearer token in Authorization header with timing-safe comparison

## Example Requests

**cURL - Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

**cURL - Get Profile:**
```bash
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**cURL - AI Chat:**
```bash
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello!","language":"spanish"}'
```

## Interactive Documentation

**Swagger UI:** Available at `/api/docs` in development mode
- Interactive API testing
- Request/response examples
- Schema definitions
- Authentication testing

Access: `http://localhost:3000/api/docs`

## Troubleshooting

**401 Unauthorized:**
- Verify JWT token is valid and not expired
- Check Authorization header format: `Bearer <token>`
- Ensure token from login/signup endpoint

**400 Bad Request:**
- Verify request body matches schema
- Check all required fields present
- Validate data types and formats

**503 Service Unavailable:**
- AI providers may be temporarily down
- Check API keys in environment variables
- Review Langfuse logs for provider errors

## Support

For API issues:
- Check Swagger documentation at `/api/docs`
- Review error messages and status codes
- Check application logs
- Contact development team via GitHub Issues
