# Phase 4 — Controller GET→POST + new shape

**Status:** pending
**Priority:** high
**Effort:** S
**Depends on:** Phase 3

## Goal

- Replace `GET /users/me` with `POST /users/me` accepting `DeviceTelemetryDto`.
- Wire telemetry write + profile read.
- Keep `PATCH /users/me` for profile updates (returns new shape).

## Files

**Modified:**
- `src/modules/user/user.controller.ts`
- (Possibly) any caller of removed `UserProfileDto` — grep and update.

## Implementation Steps

### 1. Replace controller

```ts
@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@SkipLanguageContext()
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly deviceEventService: DeviceEventService,
  ) {}

  @Post('me')
  @ApiOperation({ summary: 'Get current user profile + record device telemetry' })
  @ApiBody({ type: DeviceTelemetryDto })
  async getMe(
    @CurrentUser() user: User,
    @Body() telemetry: DeviceTelemetryDto,
  ): Promise<MeResponseDto> {
    await this.deviceEventService.record(user.id, telemetry);
    return this.userService.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ): Promise<MeResponseDto> {
    return this.userService.update(user.id, dto);
  }
}
```

Remove `@Get('me')` handler entirely. Old clients that hit GET will receive 404 — acceptable per "hard break".

### 2. Validate response wrapper

`ResponseTransformInterceptor` wraps with `{code, message, data}` automatically. Confirm the DTO returned is `data` content only (it is — interceptor handles wrap).

### 3. Verify `@Public()`-ness

`/users/me` requires JWT (default global guard). No `@Public()` needed.

## Todo

- [ ] Inject `DeviceEventService` into controller
- [ ] Add `POST /users/me` handler
- [ ] Remove `GET /users/me` handler
- [ ] Update `PATCH /users/me` return type to `MeResponseDto`
- [ ] Add Swagger `@ApiBody` for telemetry
- [ ] Grep for `UserProfileDto` usages, remove/update
- [ ] `npm run build` clean
- [ ] Manual test via curl with valid JWT

## Curl examples

```bash
# Get profile + record telemetry
curl -X POST https://api/.../users/me \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "IOS",
    "device_model": "iPhone15,2",
    "time_stamp": "2026-04-25T10:30:00.000Z",
    "time_zone": "Asia/Ho_Chi_Minh",
    "IDFA": "ABCDEF12-3456-7890-ABCD-EF1234567890",
    "enable_noti": true
  }'

# Update profile
curl -X PATCH https://api/.../users/me \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "New Name"}'
```

## Success Criteria

- `POST /users/me` returns 200 with `{code, message, data: {profile, subscription}}`.
- DB has new row in `user_device_events` for that user.
- `GET /users/me` returns 404.
- `PATCH /users/me` returns new shape.
- `npm run build` passes.

## Risks

- **Hard break** — pre-deploy coordination with mobile. Force-update flag.
- **Validation rejects mobile payload** — check IDFA can be `null` literally (DTO uses `@IsOptional`). Confirm mobile sends `null` not `"null"` string.

## Next

Phase 5 — tests + docs.
