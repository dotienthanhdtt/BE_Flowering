import { SttStreamHandle } from '../providers/stt-provider.interface';
import { AudioPcmBuffer } from './audio-pcm-buffer';

export type SpeechContext = 'onboarding' | 'scenario';

export interface SpeechSession {
  principalId: string;
  traceId: string;
  language: string | undefined;
  context: SpeechContext;
  sttHandle: SttStreamHandle;
  pcm: AudioPcmBuffer;
  startedAt: Date;
  finals: string[];
  partialCount: number;
  langfuseSpanId?: string;
  timer?: ReturnType<typeof setTimeout>;
  /** Guards against double-finalize from duplicate {type:'end'} frames. */
  ending: boolean;
}

export type ServerMsg =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | {
      type: 'session_end';
      transcript: string;
      audioUrl: string | null;
      audioPath: string;
      traceId: string;
    }
  | {
      type: 'error';
      code: 'max_duration' | 'overflow' | 'provider' | 'auth' | 'concurrent';
      message: string;
    };
