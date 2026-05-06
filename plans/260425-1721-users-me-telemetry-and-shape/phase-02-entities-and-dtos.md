# Phase 2 — Entities + DTOs

**Status:** pending
**Priority:** high
**Effort:** S
**Depends on:** Phase 1

## Goal

TypeORM entity for `user_device_events`, update `Subscription` entity, define request/response DTOs.

## Files

**New:**
- `src/database/entities/user-device-event.entity.ts`
- `src/modules/user/dto/device-telemetry.dto.ts`
- `src/modules/user/dto/me-response.dto.ts`

**Modified:**
- `src/database/entities/subscription.entity.ts` — add `tier` enum + column; add `PENDING` to status enum.
- `src/database/entities/index.ts` — export new entity.
- `src/database/database.module.ts` — register `UserDeviceEvent` in global entities array.
- `src/modules/user/user.module.ts` — register `UserDeviceEvent` in `TypeOrmModule.forFeature([...])`. Also import `Subscription` entity (for service join).

## Implementation Steps

### 1. `user-device-event.entity.ts`

```ts
export enum DeviceEventPlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
}

@Entity('user_device_events')
export class UserDeviceEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: DeviceEventPlatform })
  platform!: DeviceEventPlatform;

  @Column({ type: 'varchar', length: 120, name: 'device_model', nullable: true })
  deviceModel?: string;

  @Column({ type: 'timestamptz', name: 'client_timestamp' })
  clientTimestamp!: Date;

  @Column({ type: 'varchar', length: 64, name: 'time_zone', nullable: true })
  timeZone?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  idfa?: string;

  @Column({ type: 'boolean', name: 'enable_noti' })
  enableNoti!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

### 2. `subscription.entity.ts` updates

```ts
export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  TRIAL = 'trial',
  PENDING = 'pending',           // NEW
}

export enum SubscriptionTier {
  FREE = 'FREE',
  TRIAL = 'TRIAL',
  PREMIUM = 'PREMIUM',
  PREMIUM_PLUS = 'PREMIUM_PLUS',
}

// inside Subscription class:
@Column({ type: 'enum', enum: SubscriptionTier, default: SubscriptionTier.FREE })
tier!: SubscriptionTier;
```

### 3. `device-telemetry.dto.ts` (request body)

```ts
export class DeviceTelemetryDto {
  @IsEnum(DeviceEventPlatform)
  platform!: DeviceEventPlatform;   // "IOS" | "ANDROID"

  @IsString() @IsOptional() @MaxLength(120)
  device_model?: string;

  @IsISO8601()
  time_stamp!: string;     // client clock, ISO 8601

  @IsString() @IsOptional() @MaxLength(64)
  time_zone?: string;      // IANA, e.g. "Asia/Ho_Chi_Minh"

  @IsString() @IsOptional() @MaxLength(64)
  IDFA?: string | null;

  @IsBoolean()
  enable_noti!: boolean;
}
```

### 4. `me-response.dto.ts`

```ts
export class MeProfileDto {
  display_name!: string | null;
  email!: string;
  avatar_url!: string | null;
  native_language!: string | null;   // language.code
}

export type MeSubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'PENDING';
export type MeSubscriptionType   = 'FREE' | 'TRIAL' | 'PREMIUM' | 'PREMIUM_PLUS';

export class MeSubscriptionDto {
  status!: MeSubscriptionStatus;
  type!: MeSubscriptionType;
  end_date!: string | null;          // ISO 8601 date
}

export class MeResponseDto {
  profile!: MeProfileDto;
  subscription!: MeSubscriptionDto;
}
```

Decorate with `@ApiProperty` for Swagger.

### 5. Module registration (CRITICAL — both places)

`src/database/database.module.ts`:
```ts
entities: [..., UserDeviceEvent]
```

`src/modules/user/user.module.ts`:
```ts
TypeOrmModule.forFeature([User, UserDeviceEvent, Subscription])
```

## Todo

- [ ] Create `UserDeviceEvent` entity (incl. `DeviceEventPlatform` enum, `platform` column)
- [ ] Add `tier` enum + column to `Subscription` entity
- [ ] Add `PENDING` to `SubscriptionStatus` enum
- [ ] Create `DeviceTelemetryDto` with class-validator decorators
- [ ] Create `MeResponseDto` (profile + subscription nested)
- [ ] Register `UserDeviceEvent` in `database.module.ts` global entities
- [ ] Register `UserDeviceEvent` + `Subscription` in `user.module.ts` `forFeature`
- [ ] Export from `entities/index.ts`
- [ ] `npm run build` clean

## Success Criteria

- `npm run build` passes.
- No `EntityMetadataNotFoundError` on app boot.
- Swagger renders new DTOs at `/api/docs`.

## Risks

- **Forgetting one of the two TypeORM registrations** — see CLAUDE.md "Entity Registration" rule.
- **Status enum ordering** — `'pending'` must already exist in DB (Phase 1) before entity rebuilds with it.

## Next

Phase 3 — services consume these entities/DTOs.
