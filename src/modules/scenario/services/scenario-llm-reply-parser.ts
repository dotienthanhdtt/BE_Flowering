import { Logger } from '@nestjs/common';

export interface ParsedScenarioReply {
  reply: string;
  isEnd: boolean;
}

const logger = new Logger('ScenarioLlmReplyParser');

export function parseScenarioReply(raw: string): ParsedScenarioReply {
  const trimmed = stripFences(raw).trim();
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as Record<string, unknown>;
      const reply = typeof o.reply === 'string' ? o.reply : null;
      if (reply !== null) {
        return { reply, isEnd: o.is_end === true };
      }
    }
  } catch {
    /* fall through */
  }
  logger.warn(`LLM reply not structured JSON; using raw text. preview="${raw.slice(0, 80)}"`);
  return { reply: raw, isEnd: false };
}

function stripFences(s: string): string {
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1] : s;
}
