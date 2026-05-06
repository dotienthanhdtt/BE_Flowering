import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OnboardingChatDto } from './onboarding-chat.dto';

const VALID_UUID = '7e982513-fff0-4d07-b008-36dd8047c326';

/**
 * Regression: Flutter client sends { message: "" } on the first onboarding turn
 * (AI greets first). The DTO must accept empty/whitespace message as "no message".
 */
describe('OnboardingChatDto', () => {
  const validateBody = async (body: unknown) => {
    const dto = plainToInstance(OnboardingChatDto, body);
    const errors = await validate(dto);
    return { dto, errors };
  };

  it('accepts empty string message and normalizes to undefined (first-turn case)', async () => {
    const { dto, errors } = await validateBody({
      conversationId: VALID_UUID,
      message: '',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts whitespace-only message and normalizes to undefined', async () => {
    const { dto, errors } = await validateBody({
      conversationId: VALID_UUID,
      message: '   ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts omitted message', async () => {
    const { dto, errors } = await validateBody({ conversationId: VALID_UUID });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBeUndefined();
  });

  it('accepts a real message', async () => {
    const { dto, errors } = await validateBody({
      conversationId: VALID_UUID,
      message: 'Hi! My name is Thanh',
    });
    expect(errors).toHaveLength(0);
    expect(dto.message).toBe('Hi! My name is Thanh');
  });

  it('rejects message over 2000 chars', async () => {
    const { errors } = await validateBody({
      conversationId: VALID_UUID,
      message: 'a'.repeat(2001),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('rejects invalid conversationId', async () => {
    const { errors } = await validateBody({ conversationId: 'not-a-uuid' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('conversationId');
  });
});
