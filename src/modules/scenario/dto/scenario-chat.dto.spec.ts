import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScenarioChatRequestDto } from './scenario-chat.dto';

const VALID_UUID = '65093b77-1552-4274-98cf-6859d4503ee1';

/**
 * Regression: Flutter client sends { message: "" } on the first scenario turn
 * (AI opens first). The DTO must accept empty/whitespace message as "no message",
 * matching OnboardingChatDto behavior.
 */
describe('ScenarioChatRequestDto', () => {
  const validateBody = async (body: unknown) => {
    const dto = plainToInstance(ScenarioChatRequestDto, body);
    const errors = await validate(dto);
    return { dto, errors };
  };

  it('accepts empty string message and normalizes to undefined (first-turn case)', async () => {
    const { dto, errors } = await validateBody({
      scenarioId: VALID_UUID,
      message: '',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts whitespace-only message and normalizes to undefined', async () => {
    const { dto, errors } = await validateBody({
      scenarioId: VALID_UUID,
      message: '   ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts omitted message', async () => {
    const { dto, errors } = await validateBody({ scenarioId: VALID_UUID });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts a real message', async () => {
    const { dto, errors } = await validateBody({
      scenarioId: VALID_UUID,
      message: 'Hello, I need help',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBe('Hello, I need help');
  });

  it('rejects message over 2000 chars', async () => {
    const { errors } = await validateBody({
      scenarioId: VALID_UUID,
      message: 'a'.repeat(2001),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('rejects missing scenarioId', async () => {
    const { errors } = await validateBody({ message: 'hi' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('scenarioId');
  });

  it('rejects invalid scenarioId', async () => {
    const { errors } = await validateBody({ scenarioId: 'not-a-uuid' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('scenarioId');
  });
});
