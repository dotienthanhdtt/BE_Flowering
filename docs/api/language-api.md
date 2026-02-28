# Language API

## GET /languages

List available languages. Optionally filter by native/learning availability.

**Auth:** Public (no JWT required)

**Query Params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| type | `native` \| `learning` | No | Filter by availability type |

**Response:** `200 OK`

```json
{
  "code": 1,  
  "message": "Success",
  "data": [
    {
      "id": "uuid",
      "code": "en",
      "name": "English",
      "nativeName": "English",
      "flagUrl": "https://...",
      "isNativeAvailable": true,
      "isLearningAvailable": true
    }
  ]
}
```

**curl:**

```bash
# All languages
curl -X GET 'https://api.example.com/languages'

# Native languages only
curl -X GET 'https://api.example.com/languages?type=native'

# Learning languages only
curl -X GET 'https://api.example.com/languages?type=learning'
```

---

## PATCH /languages/user/native

Set the authenticated user's native language.

**Auth:** Bearer JWT

**Request Body:**

```json
{ "languageId": "uuid" }
```

**Response:** `200 OK`

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "id": "uuid",
    "code": "en",
    "name": "English",
    "nativeName": "English",
    "flagUrl": "https://...",
    "isNativeAvailable": true,
    "isLearningAvailable": true
  }
}
```

**Errors:**
- `404` Language not found
- `400` Language not available as native

**curl:**

```bash
curl -X PATCH 'https://api.example.com/languages/user/native' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"languageId": "uuid"}'
```

---

## GET /languages/user

Get authenticated user's learning languages.

**Auth:** Bearer JWT

**Response:** `200 OK` -- array of UserLanguageDto

---

## POST /languages/user

Add language to user's learning list. Validates `isLearningAvailable`.

**Auth:** Bearer JWT

**Request Body:**

```json
{ "languageId": "uuid", "proficiencyLevel": "beginner" }
```

**Errors:**
- `404` Language not found
- `400` Language not available for learning
- `409` Language already in learning list

---

## PATCH /languages/user/:languageId

Update proficiency or active status.

**Auth:** Bearer JWT

**Request Body:**

```json
{ "proficiencyLevel": "intermediate", "isActive": true }
```

---

## DELETE /languages/user/:languageId

Remove language from learning list.

**Auth:** Bearer JWT
