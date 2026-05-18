import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SonioxTtsProvider } from '../providers/soniox-tts.provider';
import { ObjectStorageService } from '../../../database/object-storage.service';
import { LangfuseService } from '../services/langfuse-tracing.service';
import { AiConversationMessage, MessageRole } from '../../../database/entities/ai-conversation-message.entity';
import {
  AiConversation,
  AiConversationType,
} from '../../../database/entities/ai-conversation.entity';

export const TTS_MAX_CHARS = 5000;

export type TtsPrincipal =
  | { kind: 'scenario'; userId: string }
  | { kind: 'onboarding'; sessionId: string; conversationId: string };

export interface TtsSynthesisResult {
  audioUrl: string;
  mimeType: string;
  cached: boolean;
}

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);

  constructor(
    private readonly soniox: SonioxTtsProvider,
    private readonly storage: ObjectStorageService,
    private readonly langfuse: LangfuseService,
    @InjectRepository(AiConversationMessage)
    private readonly messageRepo: Repository<AiConversationMessage>,
  ) {}

  async synthesizeMessage(
    messageId: string,
    principal: TtsPrincipal,
  ): Promise<TtsSynthesisResult> {
    const message = await this.loadAndAuthorize(messageId, principal);

    // Cache hit → re-sign stored path → no Soniox call
    if (message.ttsAudioPath) {
      const audioUrl = await this.storage.getSignedUrl(message.ttsAudioPath, 3600);
      this.recordEvent(message.conversationId, 'tts.cache_hit', {
        message_id: message.id,
        provider: this.soniox.name,
      });
      return { audioUrl, mimeType: this.soniox.defaultMimeType, cached: true };
    }

    const language = this.resolveLanguage(message.conversation);
    const { audio, mimeType } = await this.soniox.synthesize(message.content, { language });
    const namespace = this.principalNamespace(principal);
    const { path, signedUrl } = await this.storage.uploadAudio(
      audio,
      namespace,
      `tts/${message.id}.mp3`,
    );

    await this.messageRepo.update(message.id, { ttsAudioPath: path });

    this.recordEvent(message.conversationId, 'tts.synthesize', {
      message_id: message.id,
      provider: this.soniox.name,
      language,
      char_count: message.content.length,
      audio_bytes: audio.byteLength,
    });

    return { audioUrl: signedUrl, mimeType, cached: false };
  }

  /**
   * Load message + conversation, enforce ownership + role + length.
   * Throws Nest exceptions (caller is HTTP controller / WS gateway).
   */
  async loadAndAuthorize(
    messageId: string,
    principal: TtsPrincipal,
  ): Promise<AiConversationMessage & { conversation: AiConversation }> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation', 'conversation.language'],
    });
    if (!message || !message.conversation) {
      throw new NotFoundException('Message not found');
    }

    if (message.role !== MessageRole.ASSISTANT) {
      throw new ForbiddenException('Only assistant messages can be synthesized');
    }

    if (message.content.length > TTS_MAX_CHARS) {
      throw new BadRequestException(`Message exceeds ${TTS_MAX_CHARS}-char TTS limit`);
    }

    this.assertOwnership(message.conversation, principal);
    return message as AiConversationMessage & { conversation: AiConversation };
  }

  private assertOwnership(conversation: AiConversation, principal: TtsPrincipal): void {
    if (principal.kind === 'scenario') {
      if (!conversation.userId || conversation.userId !== principal.userId) {
        throw new ForbiddenException('Not your conversation');
      }
      return;
    }
    // onboarding
    if (conversation.id !== principal.conversationId) {
      throw new ForbiddenException('Message does not belong to provided conversation');
    }
    const isOnboardingType =
      conversation.type === AiConversationType.ANONYMOUS ||
      conversation.type === AiConversationType.PERSONALIZE_INTAKE;
    if (!isOnboardingType || conversation.userId) {
      throw new ForbiddenException('Conversation is not an onboarding session');
    }
  }

  /** Persist a streamed audio buffer (called from WS gateway after stream end). */
  async persistStreamedAudio(
    message: AiConversationMessage,
    principal: TtsPrincipal,
    audio: Buffer,
  ): Promise<string | null> {
    try {
      const namespace = this.principalNamespace(principal);
      const { path } = await this.storage.uploadAudio(
        audio,
        namespace,
        `tts/${message.id}.mp3`,
      );
      await this.messageRepo.update(message.id, { ttsAudioPath: path });
      return path;
    } catch (err) {
      this.logger.warn(`Failed to persist streamed TTS audio: ${String(err)}`);
      return null;
    }
  }

  /**
   * Resolve language code from conversation.language.code; fallback to 'en'.
   * Onboarding conversations may not have a language assigned yet.
   * Normalised to lowercase 2-letter code (Soniox expects e.g. 'en', 'vi').
   */
  resolveLanguage(conversation: AiConversation): string {
    const raw = conversation.language?.code?.trim().toLowerCase();
    if (!raw) return 'en';
    // Soniox expects 2-letter ISO code; trim a region suffix if present (en-US → en).
    return raw.split(/[-_]/)[0] || 'en';
  }

  principalNamespace(principal: TtsPrincipal): string {
    return principal.kind === 'scenario'
      ? principal.userId
      : `onboarding:${principal.sessionId}`;
  }

  /** Public so WS gateway can emit cache_hit / synthesize / error events. */
  emitEvent(
    conversationId: string,
    name: string,
    attrs: Record<string, string | number | boolean>,
  ): void {
    this.recordEvent(conversationId, name, attrs);
  }

  private recordEvent(
    conversationId: string,
    name: string,
    attrs: Record<string, string | number | boolean>,
  ): void {
    try {
      // Ensure the conversation span exists so recordEvent can attach
      this.langfuse.getConversationContext({ conversationId });
      this.langfuse.recordEvent(conversationId, name, attrs);
    } catch {
      // tracing is best-effort
    }
  }
}
