# GET /lessons — Mobile Integration Guide

## Overview

Returns scenarios grouped by category for the home screen.
Each scenario includes a `status` field that drives the UI lock/trial/available state.

**Base URL:** `https://<your-api-host>`  
**Auth:** Bearer JWT (Firebase ID token exchange via `POST /auth/firebase`)

---

## Endpoint

```
GET /lessons
```

### Headers

| Header | Value | Required |
|--------|-------|----------|
| `Authorization` | `Bearer <jwt_token>` | Yes |
| `Content-Type` | `application/json` | No |

---

## Query Parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `language` | UUID string | No | — | Filter to language-specific + global scenarios |
| `level` | `beginner` \| `intermediate` \| `advanced` | No | — | Filter by difficulty |
| `search` | string (max 100) | No | — | Case-insensitive title search |
| `page` | integer (min 1) | No | `1` | Pagination page |
| `limit` | integer (1–50) | No | `20` | Items per page |

---

## Response Format

All responses are wrapped in the standard envelope:

```json
{
  "code": 1,
  "message": "...",
  "data": { ... }
}
```

`code: 1` = success, `code: 0` = error.

### `data` shape

```typescript
{
  categories: Array<{
    id: string;           // UUID
    name: string;         // e.g. "Daily Life"
    icon: string | null;  // emoji or URL
    scenarios: Array<{
      id: string;                                               // UUID
      title: string;
      imageUrl: string | null;
      difficulty: "beginner" | "intermediate" | "advanced";
      status: "available" | "trial" | "locked" | "learned";
    }>;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;        // total scenarios (before grouping)
  };
}
```

### `status` field logic

| status | Meaning | UI action |
|--------|---------|-----------|
| `available` | Free or user has premium | Tap to start |
| `trial` | Premium but free-preview allowed | Show "Try" badge |
| `locked` | Premium, user is on free tier | Show lock icon + upsell |
| `learned` | Reserved for future progress tracking | — |

---

## cURL Examples

### 1. Basic — all scenarios (first page)

```bash
curl -X GET "https://<host>/lessons" \
  -H "Authorization: Bearer <jwt_token>"
```

### 2. Filter by language

```bash
curl -X GET "https://<host>/lessons?language=<language_uuid>" \
  -H "Authorization: Bearer <jwt_token>"
```

### 3. Filter by difficulty

```bash
curl -X GET "https://<host>/lessons?level=beginner" \
  -H "Authorization: Bearer <jwt_token>"
```

### 4. Search + pagination

```bash
curl -X GET "https://<host>/lessons?search=airport&page=1&limit=10" \
  -H "Authorization: Bearer <jwt_token>"
```

### 5. Combined filters

```bash
curl -X GET "https://<host>/lessons?language=<language_uuid>&level=intermediate&page=1&limit=20" \
  -H "Authorization: Bearer <jwt_token>"
```

---

## Sample Response

```json
{
  "code": 1,
  "message": "Success",
  "data": {
    "categories": [
      {
        "id": "a1b2c3d4-0000-0000-0000-000000000001",
        "name": "Daily Life",
        "icon": "🏠",
        "scenarios": [
          {
            "id": "s1000000-0000-0000-0000-000000000001",
            "title": "Morning Routine",
            "imageUrl": null,
            "difficulty": "beginner",
            "status": "available"
          },
          {
            "id": "s1000000-0000-0000-0000-000000000002",
            "title": "Asking for Directions",
            "imageUrl": null,
            "difficulty": "beginner",
            "status": "trial"
          },
          {
            "id": "s1000000-0000-0000-0000-000000000003",
            "title": "Making Phone Calls",
            "imageUrl": null,
            "difficulty": "intermediate",
            "status": "locked"
          }
        ]
      },
      {
        "id": "a1b2c3d4-0000-0000-0000-000000000002",
        "name": "Travel & Transportation",
        "icon": "✈️",
        "scenarios": [
          {
            "id": "s2000000-0000-0000-0000-000000000001",
            "title": "At the Airport",
            "imageUrl": null,
            "difficulty": "beginner",
            "status": "available"
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 25
    }
  }
}
```

---

## Error Responses

### 401 Unauthorized

```json
{
  "code": 0,
  "message": "Unauthorized",
  "data": null
}
```

### 400 Bad Request (invalid query param)

```json
{
  "code": 0,
  "message": "language must be a UUID",
  "data": null
}
```

---

## Mobile Integration Notes

### Flutter (Dio)

```dart
final response = await dio.get(
  '/lessons',
  queryParameters: {
    if (languageId != null) 'language': languageId,
    if (level != null) 'level': level,
    'page': page,
    'limit': 20,
  },
  options: Options(headers: {'Authorization': 'Bearer $token'}),
);

final data = GetLessonsResponse.fromJson(response.data['data']);
```

### Pagination

- Fetch page 1 on screen load
- Increment `page` on scroll-to-end, append categories/scenarios
- Stop fetching when `scenarios returned < limit`

### Scenario status → UI mapping

```dart
switch (scenario.status) {
  case 'available': // show normal card, tap to enter
  case 'trial':     // show card with "Try Free" badge
  case 'locked':    // show card with lock icon, tap → paywall
  case 'learned':   // show with checkmark (future)
}
```
