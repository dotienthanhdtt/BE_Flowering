# Phase 3 — Service Layer

**Status:** pending
**Priority:** high
**Effort:** M
**Depends on:** Phase 2

## Goal

- New `DeviceEventService` for inserting telemetry rows.
- Extend `UserService.getProfile` to include subscription, mapped to new response shape.

## Files

**New:**
- `src/modules/user/services/device-event.service.ts`

**Modified:**
- `src/modules/user/user.service.ts` — replace `getProfile` return shape with `MeResponseDto`. Inject `Subscription` repo. Map enums.
- `src/modules/user/user.module.ts` — register `DeviceEventService` provider/exports.

**Deprecated (delete in Phase 4):**
- `src/modules/user/dto/user-profile.dto.ts` (only if no other consumers — grep first).

## Implementation Steps

### 1. `DeviceEventService`

```ts
@Injectable()
export class DeviceEventService {
  private readonly logger = new Logger(DeviceEventService.name);

  constructor(
    @InjectRepository(UserDeviceEvent)
    private readonly repo: Repository<UserDeviceEvent>,
  ) {}

  async record(userId: string, dto: DeviceTelemetryDto): Promise<void> {
    try {
      await this.repo.insert({
        userId,
        platform: dto.platform,
        deviceModel: dto.device_model,
        clientTimestamp: new Date(dto.time_stamp),
        timeZone: dto.time_zone,
        idfa: dto.IDFA ?? undefined,
        enableNoti: dto.enable_noti,
      });
    } catch (err) {
      // Telemetry write failure must NOT fail the request.
      this.logger.warn(`device event insert failed for user=${userId}: ${(err as Error).message}`);
    }
  }
}
```

### 2. `UserService` changes

Replace `getProfile(userId)` to return `MeResponseDto`:

```ts
async getMe(userId: string): Promise<MeResponseDto> {
  const user = await this.userRepo.findOne({
    where: { id: userId },
    relations: ['nativeLanguage'],
  });
  if (!user) throw new NotFoundException('User not found');

  const sub = await this.subscriptionRepo.findOne({ where: { userId } });

  return {
    profile: {
      display_name: user.displayName ?? null,
      email: user.email,
      avatar_url: user.avatarUrl ?? null,
      native_language: user.nativeLanguage?.code ?? null,
    },
    subscription: this.mapSubscription(sub),
  };
}

private mapSubscription(sub: Subscription | null): MeSubscriptionDto {
  if (!sub) {
    return { status: 'ACTIVE', type: 'FREE', end_date: null };
  }
  return {
    status: this.mapStatus(sub.status),
    type:   this.mapTier(sub.tier),
    end_date: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
  };
}

private mapStatus(s: SubscriptionStatus): MeSubscriptionStatus {
  switch (s) {
    case SubscriptionStatus.ACTIVE:    return 'ACTIVE';
    case SubscriptionStatus.EXPIRED:   return 'EXPIRED';
    case SubscriptionStatus.CANCELLED: return 'CANCELLED';
    case SubscriptionStatus.PENDING:   return 'PENDING';
    case SubscriptionStatus.TRIAL:     return 'ACTIVE'; // TRIAL surfaces via tier, not status
  }
}

private mapTier(t: SubscriptionTier): MeSubscriptionType {
  return t as MeSubscriptionType; // enum string values match
}
```

Keep existing `findById`, `findByEmail`, `update` (for PATCH) as-is. Update `update()` to return `MeResponseDto` via new `getMe()`.

### 3. Module wiring

`user.module.ts`:
```ts
@Module({
  imports: [TypeOrmModule.forFeature([User, UserDeviceEvent, Subscription])],
  controllers: [UserController],
  providers: [UserService, DeviceEventService],
  exports: [UserService],
})
```

## Todo

- [ ] Create `DeviceEventService` with try-catch swallow
- [ ] Inject `Subscription` repo into `UserService`
- [ ] Implement `getMe()` returning `MeResponseDto`
- [ ] Implement `mapSubscription`/`mapStatus`/`mapTier` helpers
- [ ] Update `update()` to return new shape
- [ ] Wire `DeviceEventService` in `user.module.ts`
- [ ] Delete obsolete `mapToProfileDto` if no callers
- [ ] `npm run build` clean

## Success Criteria

- `getMe` returns correct shape for: no subscription, FREE, TRIAL, PREMIUM, PREMIUM_PLUS, PENDING.
- `DeviceEventService.record` returns void even when DB insert throws.
- `npm run build` passes.

## Risks

- **TRIAL collision** — `status='trial'` historical rows may also have `tier='TRIAL'`. We surface tier=TRIAL and status=ACTIVE. Confirm with mobile this is the intended display.
- **Missing subscription row** — defaulting to `{FREE, ACTIVE}` may be wrong for users mid-PENDING-purchase. Acceptable for v1; revisit after RevenueCat reconcile.

## Next

Phase 4 — controller swap GET→POST.
