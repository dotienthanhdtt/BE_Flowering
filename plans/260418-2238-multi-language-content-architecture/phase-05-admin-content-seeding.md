# Phase 5 — Admin Content Seeding Module

**Priority:** P1 · **Effort:** 4h · **Status:** complete · **Depends on:** Phase 2, 3, 4

## Context

- Brainstorm §5 Admin Content Seeding. [brainstorm](../reports/brainstorm-260418-2114-multi-language-content-architecture.md)
- Requirement: hybrid pipeline — LLM drafts per language → human reviews in DB → publish via endpoint.
- No admin role system exists today. Introduce minimal `User.isAdmin` flag + `AdminGuard`.

## Goal

Internal admin endpoints to generate drafts for `lesson` / `exercise` / `scenario` content in any supported language via the existing `UnifiedLLMService`, persist as `status='draft'`, and publish via PATCH. Review happens directly in DB (or future admin UI).

## Key Insights

- Reuse `UnifiedLLMService` + `PromptLoaderService` from `src/modules/ai`.
- Draft/published state: add `status` enum column to `lessons`, `exercises`, `scenarios` (values: `draft`, `published`, `archived`). Existing rows default `published` (preserve current visibility).
- Admin endpoints ship under `/admin/content/*` — guarded by `@UseGuards(AdminGuard)` + `@SkipLanguageContext()` (admin picks language per request via body, not header).
- Keep prompts in new folder `src/modules/admin-content/prompts/` — one per content type × skill level.

## Requirements

### Functional
- FR1: `POST /admin/content/generate` body `{ languageCode, contentType, level, count, topicHint? }` — triggers LLM, stores drafts, returns generated IDs + preview
- FR2: `GET /admin/content?status=draft&type=lesson&languageCode=es` — list drafts for review
- FR3: `PATCH /admin/content/:id/publish` — flip `status` to `published`
- FR4: `PATCH /admin/content/:id` — allow admin to edit fields before publishing
- FR5: `DELETE /admin/content/:id` — archive (soft-delete via `status='archived'`)
- FR6: Existing query-read endpoints (lessons, scenarios) must filter `status='published'` to hide drafts from end users

### Non-Functional
- Rate limited: 5 generations per minute per admin
- LLM costs tracked via existing Langfuse tracing
- Each generation is a single LLM call returning a JSON array of N items; parse + batch insert

## Related Code Files

### Create
- `src/database/migrations/1777000500000-add-status-to-content-tables.ts`
- `src/database/entities/content-status.enum.ts` — `export enum ContentStatus { DRAFT='draft', PUBLISHED='published', ARCHIVED='archived' }`
- `src/modules/admin-content/admin-content.module.ts`
- `src/modules/admin-content/admin-content.controller.ts`
- `src/modules/admin-content/admin-content.service.ts`
- `src/modules/admin-content/dto/generate-content.dto.ts`
- `src/modules/admin-content/dto/list-content-query.dto.ts`
- `src/modules/admin-content/dto/update-content.dto.ts`
- `src/modules/admin-content/prompts/lesson-draft.md`
- `src/modules/admin-content/prompts/exercise-draft.md`
- `src/modules/admin-content/prompts/scenario-draft.md`
- `src/common/guards/admin.guard.ts`
- `src/common/decorators/require-admin.decorator.ts`
- `src/database/migrations/1777000600000-add-is-admin-to-users.ts`

### Modify
- `src/database/entities/user.entity.ts` — add `isAdmin: boolean`
- `src/database/entities/lesson.entity.ts` — add `status: ContentStatus`
- `src/database/entities/exercise.entity.ts` — add `status`
- `src/database/entities/scenario.entity.ts` — add `status`
- `src/database/database.module.ts` — no change (entities already listed)
- `src/app.module.ts` — import `AdminContentModule`
- `src/modules/lesson/lesson.service.ts` — `andWhere('scenario.status = :status', { status: 'published' })` where applicable
- `src/modules/scenario/services/scenario-access.service.ts` — include status filter

## Implementation Steps

### Step 1 — Migrations
1. `1777000500000-add-status-to-content-tables.ts`:
   ```sql
   CREATE TYPE content_status AS ENUM ('draft','published','archived');
   ALTER TABLE lessons ADD COLUMN status content_status NOT NULL DEFAULT 'published';
   ALTER TABLE exercises ADD COLUMN status content_status NOT NULL DEFAULT 'published';
   ALTER TABLE scenarios ADD COLUMN status content_status NOT NULL DEFAULT 'published';
   CREATE INDEX idx_lessons_status ON lessons(status);
   CREATE INDEX idx_exercises_status ON exercises(status);
   CREATE INDEX idx_scenarios_status ON scenarios(status);
   ```
2. `1777000600000-add-is-admin-to-users.ts`:
   ```sql
   ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
   -- seed admins from env on app boot (not in migration)
   ```

### Step 2 — `AdminGuard`
```ts
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as User | undefined;
    if (!user?.isAdmin) throw new ForbiddenException('Admin only');
    return true;
  }
}
```
Bootstrap admin seeding: in `AppModule.onModuleInit`, read `ADMIN_EMAILS` env (comma-separated), `UPDATE users SET is_admin = true WHERE email = ANY($1)` on boot.

### Step 3 — `AdminContentService`
Pseudocode:
```ts
async generateDrafts(adminId: string, dto: GenerateContentDto) {
  const language = await this.languageRepo.findOneByOrFail({ code: dto.languageCode, isActive: true });
  const promptTpl = this.promptLoader.loadPrompt(`${dto.contentType}-draft.md`, {
    languageName: language.name, languageCode: language.code, level: dto.level, count: dto.count, topicHint: dto.topicHint ?? '',
  });
  const raw = await this.llm.chat([new SystemMessage(promptTpl)], { metadata: { adminId, ... } });
  const items = this.parseJson(raw.content); // array of N items
  const rows = items.map(item => ({ ...item, languageId: language.id, status: ContentStatus.DRAFT }));
  return this.repoFor(dto.contentType).save(rows);
}
```

### Step 4 — Filter drafts from public reads
Grep `LessonService`, `ScenarioAccessService`, `lesson.service.ts` (home), scenario queries — add `.andWhere('... .status = :status', { status: ContentStatus.PUBLISHED })`.

### Step 5 — Controller endpoints
```ts
@Controller('admin/content')
@UseGuards(AdminGuard)
@SkipLanguageContext()
@ApiTags('admin-content')
export class AdminContentController {
  @Post('generate') generate(@Body() dto, @CurrentUser() admin) { … }
  @Get() list(@Query() q) { … }
  @Patch(':id/publish') publish(@Param('id') id) { … }
  @Patch(':id') update(@Param('id') id, @Body() dto) { … }
  @Delete(':id') archive(@Param('id') id) { … }
}
```

## Todo

- [x] Write 2 migrations (status enum + is_admin)
- [x] Update Lesson/Exercise/Scenario entities with `status`
- [x] Update User entity with `isAdmin`
- [x] Create `AdminGuard` + admin email bootstrap in `AppModule`
- [x] Create `AdminContentModule` (controller + service + DTOs)
- [x] Create 3 prompt markdown files
- [x] Inject draft-exclusion `status='published'` filter in Lesson + Scenario services
- [x] Rate-limit generation endpoint (Throttle 5/min)
- [x] Unit tests: `AdminGuard`, `AdminContentService.generateDrafts` (mock LLM)
- [x] `npm run build` clean; `npm test` green

## Success Criteria

- `POST /admin/content/generate` (as admin) returns N drafts in specified language, stored with `status='draft'`
- Non-admin receives 403
- User-facing endpoints continue to return only `published` content
- Drafts visible in admin listing; publish flips status

## Risk Assessment

- **LLM JSON parse failures** — wrap in try/catch, retry once with stricter prompt, bubble error with raw snippet on second failure.
- **Scope creep** — resist building full CMS UI; endpoints + DB review only.
- **Env misconfig** — empty `ADMIN_EMAILS` → no admins bootstrapped → 403 everywhere. Warn at boot if empty in non-test env.
- **Data safety** — publish is a one-click action; add `confirm?: boolean` body param to publish endpoint to prevent accidental mass-publish in future.

## Security Considerations

- `AdminGuard` must run AFTER JWT global guard — NestJS order: `APP_GUARD` JWT first, per-route `AdminGuard` second ✓
- Admin endpoints not exposed in Swagger production (config gate `if (process.env.NODE_ENV !== 'production') …` OR tag `admin-content` + separate Swagger doc)
- LLM prompts never accept user-supplied instructions beyond `topicHint` (max 200 chars), preventing prompt injection that could leak unrelated data

## Next Steps

Phase 6 — tests + docs + release cutover. Mobile update to always send header.
