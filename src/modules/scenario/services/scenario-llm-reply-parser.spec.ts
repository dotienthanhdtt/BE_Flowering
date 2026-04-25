import { parseScenarioReply } from './scenario-llm-reply-parser';

describe('parseScenarioReply', () => {
  it('parses pure JSON', () => {
    expect(parseScenarioReply('{"reply":"hi","is_end":false}')).toEqual({
      reply: 'hi',
      isEnd: false,
    });
  });

  it('parses fenced JSON', () => {
    const raw = '```json\n{"reply":"hi","is_end":true}\n```';
    expect(parseScenarioReply(raw)).toEqual({ reply: 'hi', isEnd: true });
  });

  it('parses fenced JSON without language tag', () => {
    const raw = '```\n{"reply":"hello","is_end":false}\n```';
    expect(parseScenarioReply(raw)).toEqual({ reply: 'hello', isEnd: false });
  });

  it('falls back when not JSON', () => {
    expect(parseScenarioReply('hello there')).toEqual({
      reply: 'hello there',
      isEnd: false,
    });
  });

  it('falls back when reply key is missing', () => {
    expect(parseScenarioReply('{"is_end":true}')).toEqual({
      reply: '{"is_end":true}',
      isEnd: false,
    });
  });

  it('treats non-true is_end as false', () => {
    expect(parseScenarioReply('{"reply":"x","is_end":"yes"}')).toEqual({
      reply: 'x',
      isEnd: false,
    });
  });

  it('treats is_end:true strictly as true', () => {
    expect(parseScenarioReply('{"reply":"bye","is_end":true}')).toEqual({
      reply: 'bye',
      isEnd: true,
    });
  });
});
