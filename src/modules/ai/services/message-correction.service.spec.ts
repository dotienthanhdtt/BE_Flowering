import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessageCorrectionService } from './message-correction.service';

describe('MessageCorrectionService', () => {
  let service: MessageCorrectionService;
  let messageRepo: any;
  let qb: any;

  const USER_ID = 'user-uuid-1';
  const MSG_ID = 'msg-uuid-1';

  beforeEach(() => {
    qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
    };
    messageRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new MessageCorrectionService(messageRepo);
  });

  it('updates correctedContent when caller owns the message', async () => {
    qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: USER_ID });

    await service.persistCorrection(USER_ID, MSG_ID, 'corrected text');

    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: MSG_ID },
      { correctedContent: 'corrected text' },
    );
  });

  it('writes null to clear an existing correction', async () => {
    qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: USER_ID });

    await service.persistCorrection(USER_ID, MSG_ID, null);

    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: MSG_ID },
      { correctedContent: null },
    );
  });

  it('throws NotFoundException when message does not exist', async () => {
    qb.getRawOne.mockResolvedValue(undefined);

    await expect(
      service.persistCorrection(USER_ID, MSG_ID, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when caller is not the conversation owner', async () => {
    qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: 'someone-else' });

    await expect(
      service.persistCorrection(USER_ID, MSG_ID, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when conversation has no userId', async () => {
    qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: null });

    await expect(
      service.persistCorrection(USER_ID, MSG_ID, 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('joins on message.conversation and selects ownership fields', async () => {
    qb.getRawOne.mockResolvedValue({ m_id: MSG_ID, c_user_id: USER_ID });

    await service.persistCorrection(USER_ID, MSG_ID, 'x');

    expect(qb.leftJoin).toHaveBeenCalledWith('m.conversation', 'c');
    expect(qb.select).toHaveBeenCalledWith(['m.id AS m_id', 'c.user_id AS c_user_id']);
    expect(qb.where).toHaveBeenCalledWith('m.id = :messageId', { messageId: MSG_ID });
  });
});
