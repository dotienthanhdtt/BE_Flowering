# Phase 4: Tests & API Docs

## Context Links

- [Phase 3](phase-03-service-and-controller-logic.md) (dependency)
- Test pattern: `src/modules/auth/auth.service.spec.ts` (existing reference)
- API docs: `docs/api/` directory

## Overview

- **Priority:** P2
- **Status:** pending
- **Description:** Write unit tests for new/modified service methods. Create API documentation for all language endpoints.

## Key Insights

- No existing tests for language module -- creating from scratch
- Test pattern: use `Test.createTestingModule`, mock repositories via `getRepositoryToken`
- API docs follow markdown format in `docs/api/` per CLAUDE.md rules

## Requirements

**Functional:**
- Test `findAll()` with no filter, native filter, learning filter
- Test `setNativeLanguage()` success, not found, not native-available
- Test `addUserLanguage()` rejects non-learning-available language
- API doc covers all `/languages` endpoints

**Non-functional:**
- Tests use mock repos, no DB dependency
- Tests follow existing `describe/it` pattern

## Architecture

```
language.service.spec.ts -- unit tests for service
docs/api/language-api.md -- client-facing API doc
```

## Related Code Files

| Action | File |
|--------|------|
| Create | `src/modules/language/language.service.spec.ts` |
| Create | `docs/api/language-api.md` |

## Implementation Steps

### 1. Create language.service.spec.ts

Create `src/modules/language/language.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { LanguageService } from './language.service';
import { Language } from '../../database/entities/language.entity';
import { UserLanguage } from '../../database/entities/user-language.entity';
import { User } from '../../database/entities/user.entity';
import { LanguageType } from './dto/language-query.dto';

const mockLanguageRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
});

const mockUserLanguageRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

const mockUserRepo = () => ({
  update: jest.fn(),
});

describe('LanguageService', () => {
  let service: LanguageService;
  let languageRepo: ReturnType<typeof mockLanguageRepo>;
  let userLanguageRepo: ReturnType<typeof mockUserLanguageRepo>;
  let userRepo: ReturnType<typeof mockUserRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageService,
        { provide: getRepositoryToken(Language), useFactory: mockLanguageRepo },
        { provide: getRepositoryToken(UserLanguage), useFactory: mockUserLanguageRepo },
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
      ],
    }).compile();

    service = module.get<LanguageService>(LanguageService);
    languageRepo = module.get(getRepositoryToken(Language));
    userLanguageRepo = module.get(getRepositoryToken(UserLanguage));
    userRepo = module.get(getRepositoryToken(User));
  });

  // ... test cases below
});
```

### Key test cases

#### findAll()

```typescript
describe('findAll', () => {
  const mockLang = {
    id: 'uuid-1', code: 'en', name: 'English', nativeName: 'English',
    flagUrl: 'http://flag.png', isActive: true,
    isNativeAvailable: true, isLearningAvailable: true,
  };

  it('should return all active languages when no type filter', async () => {
    languageRepo.find.mockResolvedValue([mockLang]);
    const result = await service.findAll();
    expect(languageRepo.find).toHaveBeenCalledWith({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].isNativeAvailable).toBe(true);
  });

  it('should filter by native type', async () => {
    languageRepo.find.mockResolvedValue([mockLang]);
    await service.findAll(LanguageType.NATIVE);
    expect(languageRepo.find).toHaveBeenCalledWith({
      where: { isActive: true, isNativeAvailable: true },
      order: { name: 'ASC' },
    });
  });

  it('should filter by learning type', async () => {
    languageRepo.find.mockResolvedValue([mockLang]);
    await service.findAll(LanguageType.LEARNING);
    expect(languageRepo.find).toHaveBeenCalledWith({
      where: { isActive: true, isLearningAvailable: true },
      order: { name: 'ASC' },
    });
  });
});
```

#### setNativeLanguage()

```typescript
describe('setNativeLanguage', () => {
  const userId = 'user-uuid';
  const langId = 'lang-uuid';
  const mockLang = {
    id: langId, code: 'en', name: 'English', nativeName: 'English',
    flagUrl: null, isActive: true, isNativeAvailable: true, isLearningAvailable: true,
  };

  it('should set native language successfully', async () => {
    languageRepo.findOne.mockResolvedValue(mockLang);
    userRepo.update.mockResolvedValue({ affected: 1 });
    const result = await service.setNativeLanguage(userId, { languageId: langId });
    expect(userRepo.update).toHaveBeenCalledWith(userId, { nativeLanguageId: langId });
    expect(result.id).toBe(langId);
  });

  it('should throw NotFoundException for invalid language', async () => {
    languageRepo.findOne.mockResolvedValue(null);
    await expect(service.setNativeLanguage(userId, { languageId: langId }))
      .rejects.toThrow(NotFoundException);
  });

  it('should throw BadRequestException for non-native-available language', async () => {
    languageRepo.findOne.mockResolvedValue({ ...mockLang, isNativeAvailable: false });
    await expect(service.setNativeLanguage(userId, { languageId: langId }))
      .rejects.toThrow(BadRequestException);
  });
});
```

#### addUserLanguage() validation

```typescript
describe('addUserLanguage', () => {
  it('should throw BadRequestException for non-learning-available language', async () => {
    languageRepo.findOne.mockResolvedValue({
      id: 'lang-uuid', isActive: true, isLearningAvailable: false,
    });
    await expect(service.addUserLanguage('user-uuid', { languageId: 'lang-uuid' }))
      .rejects.toThrow(BadRequestException);
  });
});
```

### 2. Create docs/api/language-api.md

Create `docs/api/language-api.md` covering all endpoints:

```markdown
# Language API

## GET /languages

List available languages. Optionally filter by native/learning availability.

**Auth:** Public (no JWT required)

**Query Params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| type | `native` \| `learning` | No | Filter by availability type |

**Response:** `200 OK`
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

**curl:**
curl -X GET 'https://api.example.com/languages?type=native'


## PATCH /languages/user/native

Set the authenticated user's native language.

**Auth:** Bearer JWT

**Request Body:**
{ "languageId": "uuid" }

**Response:** `200 OK`
{
  "code": 1,
  "message": "Success",
  "data": { "id": "uuid", "code": "en", "name": "English", ... }
}

**Errors:**
- 404: Language not found
- 400: Language not available as native

**curl:**
curl -X PATCH 'https://api.example.com/languages/user/native' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"languageId": "uuid"}'


## GET /languages/user

Get authenticated user's learning languages.

**Auth:** Bearer JWT

**Response:** `200 OK` -- array of UserLanguageDto


## POST /languages/user

Add language to user's learning list. Validates isLearningAvailable.

**Auth:** Bearer JWT

**Request Body:**
{ "languageId": "uuid", "proficiencyLevel": "beginner" }

**Errors:**
- 404: Language not found
- 400: Language not available for learning
- 409: Language already in learning list


## PATCH /languages/user/:languageId

Update proficiency or active status.

**Auth:** Bearer JWT


## DELETE /languages/user/:languageId

Remove language from learning list.

**Auth:** Bearer JWT
```

### 3. Run tests

Run `npm test -- --testPathPattern=language.service.spec` to verify.

## Todo List

- [ ] Create `language.service.spec.ts` with mock setup
- [ ] Test `findAll()` -- no filter, native filter, learning filter
- [ ] Test `setNativeLanguage()` -- success, not found, not available
- [ ] Test `addUserLanguage()` -- rejects non-learning-available
- [ ] Create `docs/api/language-api.md`
- [ ] Run tests and verify all pass

## Success Criteria

- All test cases pass
- No false positives (tests actually validate logic)
- API doc covers all 6 language endpoints with examples
- `npm test` passes with 0 failures

## Risk Assessment

- **Risk:** Mock setup doesn't match actual repository interface -- mitigated: follow existing auth test patterns
- **Risk:** Test may miss edge cases -- mitigated: covering main happy path + error branches

## Security Considerations

- Tests verify authorization boundaries (native language requires JWT)
- Tests verify validation (rejects unavailable languages)

## Next Steps

- Run `npm run lint` to ensure code quality
- Run `npm run build` for final compilation check
- Mark plan as completed
