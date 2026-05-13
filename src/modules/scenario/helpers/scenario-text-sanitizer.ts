const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const SCRIPT_STYLE_BLOCKS = /<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi;
const HTML_TAGS = /<[^>]*>/g;
const TITLE_MAX = 255;

function stripHtml(raw: string): string {
  return raw.replace(SCRIPT_STYLE_BLOCKS, '').replace(HTML_TAGS, '').replace(CONTROL_CHARS, '').trim();
}

export function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const stripped = stripHtml(raw);
  return stripped.length > TITLE_MAX ? stripped.slice(0, TITLE_MAX) : stripped;
}

export function sanitizeDescription(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const stripped = stripHtml(raw);
  return stripped.length > 0 ? stripped : undefined;
}
