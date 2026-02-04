# API Documentation

**Last Updated:** 2026-02-04
**Base URL:** `http://localhost:3000` (development)
**API Version:** 1.0

## Overview

RESTful API for AI-powered language learning application. All endpoints except webhooks require JWT authentication via Bearer token in the Authorization header.

## Authentication

### Bearer Token Format
```
Authorization: Bearer <jwt_token>
```

### Token Expiration
Default: 7 days (configurable via `JWT_EXPIRES_IN`)

## Response Format

### Success Response
```json
{
  "data": { ... },
  "statusCode": 200
}
```

### Error Response
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

## Endpoints

### Authentication

#### POST /auth/signup
Register a new user account.

**Authentication:** Not required

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Validation:**
- `email`: Valid email format, required
- `password`: Minimum 8 characters, required
- `name`: String, optional

**Success Response (201):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": false
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `409 Conflict` - Email already registered

---

#### POST /auth/login
Login with email and password.

**Authentication:** Not required

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid credentials

---

#### POST /auth/google
Google OAuth authentication.

**Authentication:** Not required

**Request Body:**
```json
{
  "token": "google_oauth_token"
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@gmail.com",
    "name": "John Doe",
    "profilePicture": "https://..."
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid Google token

---

#### POST /auth/apple
Apple Sign-In authentication.

**Authentication:** Not required

**Request Body:**
```json
{
  "identityToken": "apple_identity_token",
  "user": {
    "email": "user@privaterelay.appleid.com",
    "name": "John Doe"
  }
}
```

**Success Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@privaterelay.appleid.com",
    "name": "John Doe"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid Apple token

---

### User Management

#### GET /users/me
Get current authenticated user profile.

**Authentication:** Required

**Success Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "profilePicture": null,
  "emailVerified": true,
  "createdAt": "2026-02-04T00:00:00.000Z",
  "updatedAt": "2026-02-04T00:00:00.000Z"
}
```

**Error Responses:**
- `401 Unauthorized` - Missing or invalid token

---

#### PATCH /users/me
Update current user profile.

**Authentication:** Required

**Request Body:**
```json
{
  "name": "Jane Doe",
  "profilePicture": "https://example.com/avatar.jpg"
}
```

**Validation:**
- `name`: String, optional
- `profilePicture`: Valid URL, optional

**Success Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "Jane Doe",
  "profilePicture": "https://example.com/avatar.jpg",
  "emailVerified": true
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token

---

### Subscriptions

#### GET /subscriptions/me
Get current user's subscription status.

**Authentication:** Required

**Success Response (200):**
```json
{
  "id": "uuid",
  "plan": "monthly",
  "status": "active",
  "currentPeriodStart": "2026-02-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-03-01T00:00:00.000Z",
  "cancelAtPeriodEnd": false
}
```

**Response when no subscription:**
```json
null
```

**Plan Types:**
- `free` - Free tier
- `monthly` - Monthly subscription
- `yearly` - Annual subscription
- `lifetime` - One-time purchase

**Status Types:**
- `active` - Active subscription
- `expired` - Subscription expired
- `cancelled` - Subscription cancelled
- `trial` - Trial period

**Error Responses:**
- `401 Unauthorized` - Missing or invalid token

---

#### POST /webhooks/revenuecat
RevenueCat webhook endpoint for subscription lifecycle events.

**Authentication:** Bearer token in Authorization header (webhook secret)

**Request Headers:**
```
Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
Content-Type: application/json
```

**Request Body:**
```json
{
  "event": {
    "type": "INITIAL_PURCHASE",
    "app_user_id": "user_uuid",
    "product_id": "monthly_subscription",
    "period_type": "NORMAL",
    "purchased_at_ms": 1706976000000,
    "expiration_at_ms": 1709654400000,
    "store": "APP_STORE",
    "environment": "PRODUCTION"
  }
}
```

**Event Types:**
- `INITIAL_PURCHASE` - First subscription purchase
- `RENEWAL` - Subscription renewed
- `CANCELLATION` - Subscription cancelled
- `EXPIRATION` - Subscription expired
- `PRODUCT_CHANGE` - Plan changed

**Success Response (200):**
```json
{
  "status": "received"
}
```

**Response Time:** < 60 seconds (processes asynchronously)

**Error Responses:**
- `401 Unauthorized` - Invalid webhook secret
- `400 Bad Request` - Invalid payload format

**Note:** This endpoint is excluded from Swagger documentation.

---

### Push Notifications

#### POST /notifications/devices
Register device token for push notifications.

**Authentication:** Required

**Request Body:**
```json
{
  "token": "firebase_fcm_device_token",
  "platform": "ios",
  "deviceName": "iPhone 15 Pro"
}
```

**Validation:**
- `token`: Non-empty string, required
- `platform`: Enum (`ios`, `android`, `web`), required
- `deviceName`: String, optional

**Platform Types:**
- `ios` - iOS devices
- `android` - Android devices
- `web` - Web push notifications

**Success Response (200):**
```json
{
  "message": "Device registered successfully"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token
- `409 Conflict` - Token already registered

---

#### DELETE /notifications/devices/:token
Unregister device token from push notifications.

**Authentication:** Required

**URL Parameters:**
- `token`: FCM device token to unregister

**Success Response (200):**
```json
{
  "message": "Device unregistered successfully"
}
```

**Error Responses:**
- `401 Unauthorized` - Missing or invalid token
- `404 Not Found` - Token not found for current user

---

### AI Features

#### POST /ai/conversation
Start or continue conversation with AI tutor.

**Authentication:** Required

**Request Body:**
```json
{
  "message": "How do I use the past tense in Spanish?",
  "conversationId": "uuid",
  "language": "spanish",
  "level": "beginner"
}
```

**Validation:**
- `message`: Non-empty string, required
- `conversationId`: UUID, optional (creates new if omitted)
- `language`: String, optional
- `level`: String, optional

**Success Response (200):**
```json
{
  "conversationId": "uuid",
  "response": "In Spanish, the past tense has several forms...",
  "aiProvider": "openai",
  "tokensUsed": 150
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token
- `503 Service Unavailable` - All AI providers unavailable

---

#### POST /ai/vocabulary/explain
Get AI explanation of vocabulary words.

**Authentication:** Required

**Request Body:**
```json
{
  "word": "hola",
  "language": "spanish",
  "context": "greeting someone in the morning"
}
```

**Validation:**
- `word`: Non-empty string, required
- `language`: String, required
- `context`: String, optional

**Success Response (200):**
```json
{
  "word": "hola",
  "explanation": "A common Spanish greeting meaning 'hello'...",
  "examples": [
    "Hola, ¿cómo estás? - Hello, how are you?",
    "Hola amigos - Hello friends"
  ],
  "pronunciation": "oh-lah",
  "partOfSpeech": "interjection"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token

---

#### POST /ai/grammar/check
Get grammar correction and feedback.

**Authentication:** Required

**Request Body:**
```json
{
  "text": "I goed to the store yesterday",
  "language": "english",
  "targetLanguage": "english"
}
```

**Validation:**
- `text`: Non-empty string, required
- `language`: String, required
- `targetLanguage`: String, optional

**Success Response (200):**
```json
{
  "originalText": "I goed to the store yesterday",
  "correctedText": "I went to the store yesterday",
  "errors": [
    {
      "type": "verb_conjugation",
      "original": "goed",
      "correction": "went",
      "explanation": "'Go' is an irregular verb. Past tense is 'went', not 'goed'."
    }
  ],
  "score": 85
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token

---

#### POST /ai/translate
Translate text between languages.

**Authentication:** Required

**Request Body:**
```json
{
  "text": "Hello, how are you?",
  "sourceLanguage": "english",
  "targetLanguage": "spanish"
}
```

**Validation:**
- `text`: Non-empty string, required
- `sourceLanguage`: String, required
- `targetLanguage`: String, required

**Success Response (200):**
```json
{
  "originalText": "Hello, how are you?",
  "translatedText": "Hola, ¿cómo estás?",
  "sourceLanguage": "english",
  "targetLanguage": "spanish",
  "confidence": 0.98
}
```

**Error Responses:**
- `400 Bad Request` - Invalid input data
- `401 Unauthorized` - Missing or invalid token

---

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200  | OK - Request successful |
| 201  | Created - Resource created |
| 400  | Bad Request - Invalid input |
| 401  | Unauthorized - Missing or invalid token |
| 403  | Forbidden - Insufficient permissions |
| 404  | Not Found - Resource not found |
| 409  | Conflict - Resource already exists |
| 500  | Internal Server Error - Server error |
| 503  | Service Unavailable - External service down |

### Common Error Messages

**Validation Errors:**
```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be longer than or equal to 8 characters"
  ],
  "error": "Bad Request"
}
```

**Authentication Errors:**
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**Not Found Errors:**
```json
{
  "statusCode": 404,
  "message": "Subscription not found",
  "error": "Not Found"
}
```

## Rate Limiting

**Current Status:** Not implemented

**Planned:**
- 100 requests per minute per IP
- 1000 requests per hour per user
- Separate limits for AI endpoints

## Pagination

**Current Status:** Not implemented for collection endpoints

**Planned Format:**
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

## Webhook Security

### RevenueCat Webhook Authentication

**Method:** Bearer token in Authorization header

**Validation:**
- Timing-safe comparison to prevent timing attacks
- Exact match required for webhook secret
- Invalid requests return 401 Unauthorized

**Example:**
```bash
curl -X POST https://api.example.com/webhooks/revenuecat \
  -H "Authorization: Bearer your_webhook_secret" \
  -H "Content-Type: application/json" \
  -d '{"event": {...}}'
```

## CORS Configuration

**Allowed Origins:** Configured via `CORS_ALLOWED_ORIGINS` environment variable

**Default (Development):**
```
http://localhost:3001
http://localhost:5173
```

**Allowed Methods:**
```
GET, POST, PATCH, DELETE, OPTIONS
```

**Allowed Headers:**
```
Authorization, Content-Type
```

## API Versioning

**Current:** No versioning (v1 implicit)

**Future Strategy:** URL-based versioning
```
/v1/users/me
/v2/users/me
```

## Interactive Documentation

**Swagger UI:** Available at `/api/docs` in development mode

**Features:**
- Interactive API testing
- Request/response examples
- Schema definitions
- Authentication testing

**Access:** http://localhost:3000/api/docs

## SDK Examples

### JavaScript/TypeScript

```typescript
// Authentication
const response = await fetch('http://localhost:3000/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});
const { access_token } = await response.json();

// Authenticated Request
const user = await fetch('http://localhost:3000/users/me', {
  headers: {
    'Authorization': `Bearer ${access_token}`
  }
});
const userData = await user.json();
```

### Python

```python
import requests

# Authentication
response = requests.post('http://localhost:3000/auth/login', json={
    'email': 'user@example.com',
    'password': 'password123'
})
access_token = response.json()['access_token']

# Authenticated Request
headers = {'Authorization': f'Bearer {access_token}'}
user = requests.get('http://localhost:3000/users/me', headers=headers)
user_data = user.json()
```

### Swift (iOS)

```swift
struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct AuthResponse: Codable {
    let access_token: String
    let user: User
}

// Authentication
let loginData = LoginRequest(email: "user@example.com", password: "password123")
let url = URL(string: "http://localhost:3000/auth/login")!
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try? JSONEncoder().encode(loginData)

let (data, _) = try await URLSession.shared.data(for: request)
let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)

// Authenticated Request
var userRequest = URLRequest(url: URL(string: "http://localhost:3000/users/me")!)
userRequest.setValue("Bearer \(authResponse.access_token)", forHTTPHeaderField: "Authorization")
let (userData, _) = try await URLSession.shared.data(for: userRequest)
```

### Kotlin (Android)

```kotlin
// Authentication
val client = OkHttpClient()
val json = JSONObject().apply {
    put("email", "user@example.com")
    put("password", "password123")
}

val request = Request.Builder()
    .url("http://localhost:3000/auth/login")
    .post(json.toString().toRequestBody("application/json".toMediaType()))
    .build()

val response = client.newCall(request).execute()
val accessToken = JSONObject(response.body!!.string()).getString("access_token")

// Authenticated Request
val userRequest = Request.Builder()
    .url("http://localhost:3000/users/me")
    .addHeader("Authorization", "Bearer $accessToken")
    .build()

val userResponse = client.newCall(userRequest).execute()
```

## Testing

### Postman Collection

Export Swagger spec and import into Postman:
```bash
curl http://localhost:3000/api/docs-json > api-spec.json
```

### cURL Examples

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'
```

**Get Profile:**
```bash
curl http://localhost:3000/users/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Register Device:**
```bash
curl -X POST http://localhost:3000/notifications/devices \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"fcm_token","platform":"ios","deviceName":"iPhone 15"}'
```

## Troubleshooting

### Common Issues

**401 Unauthorized:**
- Verify JWT token is valid and not expired
- Check Authorization header format: `Bearer <token>`
- Ensure token was obtained from login/signup

**400 Bad Request:**
- Check request body matches schema
- Verify all required fields are present
- Validate data types and formats

**503 Service Unavailable:**
- AI providers may be temporarily unavailable
- Check provider API keys in environment variables
- Review Langfuse logs for provider errors

## Support

For API issues or questions:
- Check Swagger documentation at `/api/docs`
- Review error messages and status codes
- Check application logs for detailed error information
- Contact development team via GitHub Issues
