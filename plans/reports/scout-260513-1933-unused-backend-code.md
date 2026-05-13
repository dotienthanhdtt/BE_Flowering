# Backend Code Usage Scout Report
**Date:** 2025-05-13 | **Scope:** Flutter Mobile App Endpoint Analysis  
**Report:** Identify backend routes/modules NOT called by Flutter

---

## Summary

**Entirely Unused Modules:** 4  
- admin-content (all 5 routes)
- kol-bundle (all 3 routes)
- lesson (all 1 route)
- progress (no controller; service only)

**Partially Used Modules:** 2
- scenario (1 unused route: POST /scenario/redeem)
- vocabulary (1 unused route: POST /vocabulary/review/*, GET /vocabulary/:id)

**Server-Internal / Webhooks:** 1
- subscription/revenuecat-webhook (non-Flutter but required)

---

## Detailed Route Analysis

### ✅ FULLY USED MODULES (All routes match Flutter requirements)

#### auth.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /auth/firebase | POST | firebaseAuth | 41 | ✅ USED |
| /auth/refresh | POST | refresh | 51 | ✅ USED |
| /auth/logout | POST | logout | 87 | ✅ USED (internal) |

**Note:** /auth/register, /auth/login, /auth/forgot-password, /auth/verify-otp, /auth/reset-password all return 410 GONE (disabled).

---

#### user.controller.ts (⚠️ Implementation Mismatch)
| Route | Method | Handler | Line | Status | Note |
|-------|--------|---------|------|--------|------|
| /users/me | POST | getProfile | 22 | ✅ USED | Decorator says @Post but docstring says GET |
| /users/me | PATCH | updateProfile | 28 | ✅ USED | Correct |

**Issue:** GET /users/me is documented but implemented as POST /users/me. Flutter likely calls POST.

---

#### language.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /languages | GET | getLanguages | 38 | ✅ USED |
| /languages/user | GET | getUserLanguages | 45 | ✅ USED |
| /languages/user | POST | addUserLanguage | 52 | ✅ USED |
| /languages/user/native | PATCH | setNativeLanguage | 62 | ✅ USED |
| /languages/user/:languageId | PATCH | updateUserLanguage | 72 | ❌ UNUSED |
| /languages/user/:languageId | DELETE | removeUserLanguage | 86 | ❌ UNUSED |

**Unused sub-routes:** PATCH/DELETE on /languages/user/:languageId (proficiency mgmt).

---

#### onboarding.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /onboarding/chat | POST | chat | 63 | ✅ USED |
| /onboarding/complete | POST | complete | 76 | ✅ USED |
| /onboarding/conversations/:conversationId/messages | GET | getMessages | 93 | ✅ USED |

---

#### ai.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /ai/chat | POST | chat | 59 | ❌ UNUSED |
| /ai/chat/stream | SSE | streamChat | 74 | ❌ UNUSED |
| /ai/chat/correct | POST | checkCorrection | 102 | ✅ USED |
| /ai/translate | POST | translate | 120 | ✅ USED |
| /ai/translate/word | POST | translateChunk | 153 | ✅ USED |
| /ai/transcribe | POST | transcribe | 174 | ✅ USED |

**Unused sub-routes:** POST /ai/chat and SSE /ai/chat/stream (AI tutor modes not called by Flutter).

---

#### scenarios.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /scenarios/default | GET | listDefault | 53 | ✅ USED |
| /scenarios/personal | GET | listPersonal | 67 | ✅ USED |
| /scenarios/:id | GET | getById | 83 | ✅ USED |
| /scenarios/redeem | POST | redeem | 101 | ⚠️ USED (KOL gifting) |

**Note:** redeem is a KOL gift code feature. Flutter list doesn't explicitly show it, but it's scenario-related. Likely used in production (mark as potentially used).

---

#### scenario-chat.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /scenario/chat | POST | chat | 45 | ✅ USED |
| /scenario/conversations/:id | GET | getConversation | 64 | ❌ UNUSED |
| /scenario/:scenarioId/conversations | GET | listConversations | 76 | ❌ UNUSED |

**Unused sub-routes:** GET /scenario/conversations/:id and GET /scenario/:scenarioId/conversations (transcript endpoints).

---

#### vocabulary.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /vocabulary | GET | list | 34 | ✅ USED |
| /vocabulary/:id | GET | findOne | 45 | ❌ UNUSED |
| /vocabulary/:id | DELETE | remove | 56 | ❌ UNUSED |

**Unused sub-routes:** GET and DELETE on individual vocab items.

---

#### subscription.controller.ts
| Route | Method | Handler | Line | Status |
|-------|--------|---------|------|--------|
| /subscriptions/me | GET | getSubscription | 21 | ✅ USED |

---

### ❌ ENTIRELY UNUSED MODULES

#### admin-content.controller.ts (5 routes)
| Route | Method | Handler | Line |
|-------|--------|---------|------|
| /admin/content/generate | POST | generate | 36 |
| /admin/content | GET | list | 41 |
| /admin/content/:id/publish | PATCH | publish | 46 |
| /admin/content/:id | PATCH | update | 54 |
| /admin/content/:id | DELETE | archive | 63 |

**Requires:** admin role. No Flutter call paths.  
**Orphaned Entities:** Exercise, Lesson (only referenced by admin-content).  
**Safe to Delete:** Yes (admin-only content generation/publishing).

---

#### kol-bundle.controller.ts (3 routes)
| Route | Method | Handler | Line |
|-------|--------|---------|------|
| /admin/kol-bundles | POST | create | 37 |
| /admin/kol-bundles | GET | list | 46 |
| /admin/kol-bundles/:id/scenarios | POST | attachScenarios | 58 |

**Requires:** admin role. Manages KOL gifting bundles.  
**Dependencies:** KolBundle, KolBundleScenario entities.  
**Safe to Delete:** Conditional — only if KOL gifting is not production-critical. Verify with business first.

---

#### lesson.controller.ts (1 route)
| Route | Method | Handler | Line |
|-------|--------|---------|------|
| /lessons | GET | getLessons | 32 |

**Requires:** authenticated, X-Learning-Language header.  
**Status:** Not called by Flutter. Legacy or internal use only.  
**Orphaned Entities:** ScenarioCategory (only referenced by lesson module).  
**Safe to Delete:** Verify that scenario listing doesn't replace this before deletion.

---

#### progress.service.ts (no controller)
**Status:** Service-only module; no HTTP endpoints exposed.  
**Orphaned Entities:** UserProgress, UserExerciseAttempt.  
**Current Use:** Not called by any public API routes observed.  
**Safe to Delete:** Only if progress tracking is truly unused (verify with analytics/backend requirements).

---

### 🔧 SERVER-INTERNAL / WEBHOOKS (Keep, Not Flutter-driven)

#### revenuecat-webhook.controller.ts (1 route)
| Route | Method | Handler | Line |
|-------|--------|---------|------|
| /webhooks/revenuecat | POST | handleWebhook | 58 |

**Status:** External webhook from RevenueCat (subscription provider).  
**Use Case:** Handles subscription lifecycle events (purchase, renewal, cancellation).  
**Required:** YES — subscription data sync depends on this.  
**NOT called by Flutter app, but server-to-server critical.**

---

## Orphaned Entities Summary

**Only used by unused modules:**
- Exercise (admin-content only)
- Lesson (admin-content only)
- ScenarioCategory (lesson only)
- KolBundle, KolBundleScenario (kol-bundle only)
- UserProgress, UserExerciseAttempt (progress service only)

**Used by both used + unused:**
- Vocabulary (vocabulary.controller ✅ + vocabulary-review.controller ❌)
- Scenario (scenarios ✅ + scenario-chat ✅)

---

## Unresolved Questions

1. **User endpoint mismatch:** Is GET /users/me a mistake in the comment or actual requirement? Verify Flutter implementation.
2. **KOL gifting (scenarios/redeem):** Is this actively used in production? Check RevenueCat integration + app usage logs.
3. **Progress service:** Is user progress tracking (UserProgress, UserExerciseAttempt) required for any feature? Or is it legacy?
4. **Scenario transcript endpoints:** Are /scenario/conversations/:id and /scenario/:scenarioId/conversations truly unused, or cached elsewhere (e.g., local DB)?
5. **AI chat endpoints:** Are /ai/chat and /ai/chat/stream intentionally disabled, or placeholders for future tutor mode?
6. **Lesson module:** Is this replaced by scenario system, or should it coexist?

---

## Recommendations

### Safe to delete (low risk):
- **admin-content** — Pure admin tooling, no user-facing reliance. Exercise + Lesson entities are orphaned.
- **progress** — No public endpoints; if analytics/tracking not needed, safe to remove.

### Conditional delete (needs business validation):
- **kol-bundle** — Only if KOL gifting is not core monetization.
- **lesson** — Only if scenario listing fully replaces it.

### Keep (even if not Flutter-driven):
- **scenario/redeem** — Monitor production usage; may be critical for gifting/promotions.
- **revenuecat-webhook** — REQUIRED for subscription sync.
- **vocabulary-review** — May be in-app analytics or future feature.

### Fix before deletion:
- User controller: Resolve GET vs POST discrepancy.

---

**Report generated:** 2025-05-13 19:33  
**Tools used:** grep, ast analysis, controller inspection  
**Next steps:** Cross-check with Firebase Analytics, ask product team about kol-bundle/lesson usage.
