# Mobile Adaptation Requirements — Multi-Language Content Architecture

**Target:** `app_flowering/flowering/` Flutter app
**Backend plan:** [plans/260418-2238-multi-language-content-architecture](./plan.md)
**Status:** Required before backend release to production
**Owner:** Mobile team

---

## TL;DR

Backend partitions all learning content by target learning language. Mobile **MUST**:

1. Send `X-Learning-Language: <code>` header on **every** authenticated and anonymous request
2. Persist the user's active learning language locally (Hive) and sync with `UserLanguage.isActive`
3. Drop the `targetLanguage` field from AI chat request body (backend sources from header)
4. Handle new 400/403 error codes when header is missing or language not enrolled
5. Clear local progress cache when user switches active language (fresh start per language)

---

## 1. HTTP Request Header

### Contract

| Field | Value | Example |
|---|---|---|
| Header name | `X-Learning-Language` | — |
| Header value | ISO-like language code (from `Language.code`) | `en`, `es`, `fr`, `ja`, `vi` |
| Required on | All `/lessons/*`, `/scenarios/*`, `/ai/*`, `/vocabulary/*`, `/onboarding/*`, `/progress/*` | — |
| Optional on | `/auth/*`, `/languages/*`, `/users/*` (profile), `/subscription/*`, `/admin/*` | — |
| Case | Case-insensitive; server lowercases | `EN` → `en` |

### Implementation (Dio interceptor)

Add a global interceptor to `lib/core/network/dio_client.dart` (or equivalent):

```dart
class ActiveLanguageInterceptor extends Interceptor {
  final LanguageLocalStore store;
  ActiveLanguageInterceptor(this.store);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final path = options.path;
    if (_needsLanguageHeader(path)) {
      final code = store.getActiveLanguageCode();
      if (code != null) {
        options.headers['X-Learning-Language'] = code;
      }
    }
    handler.next(options);
  }

  bool _needsLanguageHeader(String path) {
    const skip = ['/auth', '/languages', '/users/me', '/subscription', '/admin'];
    return !skip.any(path.startsWith);
  }
}
```

### Local Storage

Persist active language code in Hive box `user_prefs`:

```dart
Box<String>('user_prefs') → key: 'active_language_code' → value: 'en'
```

Initialize on login: resolve from `GET /languages/user` where `isActive: true`. Fall back to first entry if none active.

---

## 2. Active Language Switching Flow

When user toggles active language in settings:

```
1. POST /languages/user/:languageId  (existing endpoint — sets UserLanguage.isActive)
2. Local Hive: active_language_code = <new code>
3. Clear in-memory GetX controllers that hold language-scoped state:
   - HomeLessonsController.clear()
   - ProgressController.clear()
   - ChatController.clear()
   - VocabularyController.clear()  (if filter-by-language enabled)
4. Reload home screen — triggers GET /lessons with new header
```

**IMPORTANT:** Progress is isolated per language on backend. User sees empty progress when switching to a new language for the first time. UX must communicate this — recommended: first-switch modal "Starting fresh in <Language>. Progress in <Prev> is saved separately."

---

## 3. Error Handling — New Response Codes

Backend returns standard `{code: 0, message, data: null}` error envelope.

| HTTP | Backend message | Mobile handling |
|---|---|---|
| 400 | `X-Learning-Language header required` | Missing interceptor or uninitialized store — log Sentry, redirect to language picker |
| 400 | `Unknown language code` | Shouldn't happen; stale cache — refresh `/languages` list |
| 403 | `Language not enrolled` | User's active local code drifted from server enrollment — call `/languages/user` to resync |
| 400 | `Active learning language required` | Anonymous onboarding without header — block request, show language picker first |

Add to `lib/core/network/api_exception.dart`:

```dart
enum LanguageContextError { headerMissing, unknownCode, notEnrolled }
```

---

## 4. AI Chat Request Body — Breaking Change

### Before
```dart
{
  "message": "How do I say hello?",
  "context": {
    "conversationId": "uuid",
    "targetLanguage": "es",    // ← REMOVE
    "nativeLanguage": "en",
    "proficiencyLevel": "beginner",
    "lessonTopic": "Greetings"
  }
}
```

### After
```dart
{
  "message": "How do I say hello?",
  "context": {
    "conversationId": "uuid",
    "nativeLanguage": "en",
    "proficiencyLevel": "beginner",
    "lessonTopic": "Greetings"
  }
}
// Header: X-Learning-Language: es
```

Backend ignores body `targetLanguage` and overrides from header. Safe to send both during transition window, but drop when backend is deployed.

Affected files (likely):
- `lib/features/chat/controllers/chat_controller.dart`
- `lib/features/chat/models/chat_request.dart`
- Any generated DTOs from `build_runner`

---

## 5. Anonymous Onboarding Flow

Onboarding is `@Public()` but backend still requires `X-Learning-Language` header on POST:

```
Step 1 (client): User picks target learning language
Step 2 (client): Persist code to Hive BEFORE first API call
Step 3: POST /onboarding/start  (interceptor adds header from Hive)
```

Without header → 400. Current flow that sends `targetLanguage` in body still works (backend reads body as fallback), but migration: read from header going forward.

Note: existing anonymous sessions without languageId will be backfilled on backend to `en`. If your app caches onboarding session IDs across the cutover, no action needed.

---

## 6. Vocabulary List — Optional Filter

`GET /vocabulary` now supports `?language=<code>` query filter:

```
GET /vocabulary?language=es     → Spanish vocabulary only
GET /vocabulary                  → all user vocabulary (backward compat)
```

Recommendation: default to filtered view matching active language; offer "Show all" toggle in UI.

---

## 7. Per-Language Progress Cache Invalidation

`GET /progress`, `GET /lessons`, attempt submissions are now partitioned by language. Local Hive caches keyed by lesson/scenario ID must include language dimension OR flush on language switch.

Recommended Hive key pattern:

```dart
// Before
Box<LessonProgress>('progress')  // key: lessonId

// After
Box<LessonProgress>('progress_$activeLanguageCode')  // key: lessonId
```

Alternative (simpler): flush single `progress` box on language switch. Requires network roundtrip after switch.

---

## 8. Backward Compatibility Window

Backend supports DB fallback (`UserLanguage.isActive`) when header is missing **for authenticated requests only**. This covers old mobile versions during rollout.

- Old mobile (no header) + authenticated → works via fallback, logs warning on backend
- Old mobile (no header) + anonymous `/onboarding/*` → **fails with 400** (no fallback possible)
- Forcing an app update: recommended for anonymous flow users

**SLA:** Fallback retained for 2 releases. After that, header becomes mandatory everywhere.

---

## 9. Testing Checklist (Mobile QA)

- [ ] Fresh install → language picker → onboarding → header present on all requests
- [ ] Authenticated user switches active language → home screen shows new language lessons
- [ ] Switch language twice, return to first → progress preserved per language
- [ ] Offline mode → queued requests still attach header from Hive
- [ ] Clear app data → no crashes, language picker shown
- [ ] 403 "Language not enrolled" → app recovers via `/languages/user` resync
- [ ] AI chat: `targetLanguage` removed from body, response still localized correctly
- [ ] Switching language while chat session open → new chat context, old conversation archived server-side

---

## 10. Deployment Coordination

| Step | Backend | Mobile |
|---|---|---|
| 1 | Deploy migrations + guard + services to staging | — |
| 2 | Mobile test build against staging | Implement interceptor, test E2E |
| 3 | Backend production deploy | Submit app store build |
| 4 | Monitor backend warning logs for missing-header requests | Roll out forced update (anonymous users) |
| 5 | After 2 releases: remove `UserLanguage.isActive` fallback | All mobile versions send header |

---

## 11. Dependencies on Backend Endpoints (unchanged, for reference)

- `GET /languages?type=learning` — list available learning languages
- `GET /languages/user` — user's enrolled languages
- `POST /languages/user` — add learning language
- `PATCH /languages/user/:id` — set `isActive: true` (also becomes the source for header)

No changes to these endpoints. Mobile continues using them for language enrollment UI.

---

## Unresolved Questions (mobile side)

1. Does Hive migration strategy exist for keyed-box rename (`progress` → `progress_<code>`)? If not, plan a one-time wipe + resync on first launch of new version.
2. Localization of error messages — backend returns English; mobile should translate codes/keys to user's UI locale.
3. Does the current Flutter HTTP client layer support per-request header override? Verify interceptor order (auth + language both global).
4. Anonymous onboarding: should language picker run BEFORE the chat, or can first user message include an implicit language declaration? (Backend requires header on `/start`.)
