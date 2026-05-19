import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as (app: any) => any;
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AiController } from '../src/modules/ai/ai.controller';
import { LearningAgentService } from '../src/modules/ai/services/learning-agent.service';
import { TranslationService } from '../src/modules/ai/services/translation.service';
import { TranscriptionService } from '../src/modules/ai/services/transcription.service';
import { MessageCorrectionService } from '../src/modules/ai/services/message-correction.service';
import { AiConversationMessage } from '../src/database/entities';
import { PremiumGuard } from '../src/common/guards/premium.guard';
import { ResponseTransformInterceptor } from '../src/common/interceptors/response-transform.interceptor';

const TEST_USER_ID = 'a1a2a3a4-a1a2-4a1a-8a1a-a1a2a3a4a5a6';
const OTHER_USER_ID = 'b1b2b3b4-b1b2-4b1b-8b1b-b1b2b3b4b5b6';
const MSG_ID = 'c1c2c3c4-c1c2-4c1c-8c1c-c1c2c3c4c5c6';

function makeMsgRepo(ownership: { found: boolean; userId?: string | null }) {
  const qb = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(
      ownership.found ? { m_id: MSG_ID, c_user_id: ownership.userId ?? null } : undefined,
    ),
  };
  return {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    _qb: qb,
  };
}

describe('PUT /ai/messages/:messageId/corrected-content (E2E)', () => {
  let app: INestApplication;
  let msgRepo: ReturnType<typeof makeMsgRepo>;

  beforeAll(async () => {
    msgRepo = makeMsgRepo({ found: true, userId: TEST_USER_ID });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        MessageCorrectionService,
        { provide: getRepositoryToken(AiConversationMessage), useValue: msgRepo },
        { provide: LearningAgentService, useValue: { checkCorrection: jest.fn() } },
        { provide: TranslationService, useValue: {} },
        { provide: TranscriptionService, useValue: { transcribe: jest.fn() } },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PremiumGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = { id: TEST_USER_ID };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalInterceptors(new ResponseTransformInterceptor());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    msgRepo._qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: TEST_USER_ID });
    msgRepo.update.mockResolvedValue({ affected: 1 });
  });

  it('204: persists correction for owned message', async () => {
    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: 'I am fine.' })
      .expect(204);

    expect(msgRepo.update).toHaveBeenCalledWith(
      { id: MSG_ID },
      { correctedContent: 'I am fine.' },
    );
  });

  it('204: clears correction when correctedText is null', async () => {
    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: null })
      .expect(204);

    expect(msgRepo.update).toHaveBeenCalledWith(
      { id: MSG_ID },
      { correctedContent: null },
    );
  });

  it('403: caller does not own the message', async () => {
    msgRepo._qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: OTHER_USER_ID });

    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: 'x' })
      .expect(403);

    expect(msgRepo.update).not.toHaveBeenCalled();
  });

  it('404: message not found', async () => {
    msgRepo._qb.getRawOne.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: 'x' })
      .expect(404);

    expect(msgRepo.update).not.toHaveBeenCalled();
  });

  it('400: messageId is not a UUID', async () => {
    await request(app.getHttpServer())
      .put('/ai/messages/not-a-uuid/corrected-content')
      .send({ correctedText: 'x' })
      .expect(400);
  });

  it('400: correctedText exceeds 4000 chars', async () => {
    const tooLong = 'x'.repeat(4001);
    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: tooLong })
      .expect(400);
  });

  it('400: correctedText is a non-string non-null value', async () => {
    await request(app.getHttpServer())
      .put(`/ai/messages/${MSG_ID}/corrected-content`)
      .send({ correctedText: 123 })
      .expect(400);
  });
});
