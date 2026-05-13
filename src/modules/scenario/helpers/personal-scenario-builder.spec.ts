import {
  buildPersonalScenarioPartial,
  isValidPersonalScenarioInput,
  PersonalScenarioInput,
} from './personal-scenario-builder';
import { ScenarioType } from '@/database/entities/scenario-type.enum';
import { ContentStatus } from '@/database/entities/content-status.enum';
import { AccessTier } from '@/database/entities/access-tier.enum';

const baseInput: PersonalScenarioInput = {
  title: 'Order food at a restaurant',
  ownerId: 'user-uuid',
  languageId: 'lang-uuid',
};

describe('buildPersonalScenarioPartial', () => {
  it('sets required defaults: type=PERSONAL, status=PUBLISHED, triggersPersonalization=false', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect(result.type).toBe(ScenarioType.PERSONAL);
    expect(result.status).toBe(ContentStatus.PUBLISHED);
    expect(result.triggersPersonalization).toBe(false);
  });

  it('includes id when provided', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, id: 'specific-id' });
    expect(result.id).toBe('specific-id');
  });

  it('omits id when not provided', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect('id' in result).toBe(false);
  });

  it('includes ownerId and languageId from input', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect(result.ownerId).toBe('user-uuid');
    expect(result.languageId).toBe('lang-uuid');
  });

  it('includes orderIndex when provided', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, orderIndex: 3 });
    expect(result.orderIndex).toBe(3);
  });

  it('omits orderIndex when not provided (DB default applies)', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect('orderIndex' in result).toBe(false);
  });

  it('includes accessTier when provided', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, accessTier: AccessTier.PREMIUM });
    expect(result.accessTier).toBe(AccessTier.PREMIUM);
  });

  it('omits accessTier when not provided (DB default applies)', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect('accessTier' in result).toBe(false);
  });

  it('sanitizes title: strips HTML and control chars', () => {
    const result = buildPersonalScenarioPartial({
      ...baseInput,
      title: '<b>Hello</b>\x00World',
    });
    expect(result.title).toBe('HelloWorld');
  });

  it('caps title at 255 characters', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, title: 'x'.repeat(300) });
    expect(result.title!.length).toBe(255);
  });

  it('includes description when provided and non-empty after sanitization', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, description: 'A nice scenario' });
    expect(result.description).toBe('A nice scenario');
  });

  it('omits description when undefined', () => {
    const result = buildPersonalScenarioPartial(baseInput);
    expect('description' in result).toBe(false);
  });

  it('omits description when sanitized to empty string', () => {
    const result = buildPersonalScenarioPartial({ ...baseInput, description: '   ' });
    expect('description' in result).toBe(false);
  });
});

describe('isValidPersonalScenarioInput', () => {
  it('returns true for non-empty title after sanitization', () => {
    expect(isValidPersonalScenarioInput(baseInput)).toBe(true);
  });

  it('returns false when title is empty string', () => {
    expect(isValidPersonalScenarioInput({ ...baseInput, title: '' })).toBe(false);
  });

  it('returns false when title sanitizes to empty (HTML only)', () => {
    expect(isValidPersonalScenarioInput({ ...baseInput, title: '<br/>' })).toBe(false);
  });

  it('returns false when title is whitespace only', () => {
    expect(isValidPersonalScenarioInput({ ...baseInput, title: '   ' })).toBe(false);
  });
});
