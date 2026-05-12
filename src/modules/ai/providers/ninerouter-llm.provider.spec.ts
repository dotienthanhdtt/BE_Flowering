import { ServiceUnavailableException } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { trace } from '@opentelemetry/api';
import { NineRouterLLMProvider } from './ninerouter-llm.provider';
import { LLMModel } from './llm-models.enum';
import { LangfuseFeature } from '../langfuse-feature.enum';

jest.mock('@langchain/openai');

describe('NineRouterLLMProvider', () => {
  let provider: NineRouterLLMProvider;
  let configService: any;
  let langfuseService: any;
  let mockChatModel: any;
  let mockSpan: any;
  let mockTracer: any;

  const baseOptions = { model: LLMModel.NINEROUTER_FLOWERING_CHAT };

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ai.nineRouterKey') return 'router-key-123';
        if (key === 'ai.nineRouterUrl') return 'https://9router-dev.up.railway.app';
        return undefined;
      }),
    };
    langfuseService = { getHandler: jest.fn().mockReturnValue({}) };

    mockChatModel = {
      invoke: jest.fn(),
      stream: jest.fn(),
    };
    (ChatOpenAI as unknown as jest.Mock).mockImplementation(() => mockChatModel);

    // Capture OTel span creation so we can assert the feature-named span.
    mockSpan = { setStatus: jest.fn(), end: jest.fn() };
    mockTracer = {
      startActiveSpan: jest.fn((_name: string, fn: (s: any) => unknown) => fn(mockSpan)),
      startSpan: jest.fn(() => mockSpan),
    };
    jest.spyOn(trace, 'getTracer').mockReturnValue(mockTracer);

    provider = new NineRouterLLMProvider(configService, langfuseService);
  });

  it('throws ServiceUnavailable when the API key is not configured', async () => {
    configService.get.mockImplementation((key: string) =>
      key === 'ai.nineRouterUrl' ? 'https://9router-dev.up.railway.app' : undefined,
    );

    await expect(provider.chat([new HumanMessage('hi')], baseOptions)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('constructs ChatOpenAI pointed at the 9router /v1 base URL with the configured key', async () => {
    mockChatModel.invoke.mockResolvedValue({ content: 'hello' });

    await provider.chat([new HumanMessage('hi')], baseOptions);

    expect(ChatOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'flowering_chat',
        openAIApiKey: 'router-key-123',
        configuration: { baseURL: 'https://9router-dev.up.railway.app/v1' },
        streaming: true,
      }),
    );
  });

  it('returns string content from chat()', async () => {
    mockChatModel.invoke.mockResolvedValue({ content: 'bonjour' });

    const result = await provider.chat([new HumanMessage('hi')], baseOptions);

    expect(result).toBe('bonjour');
  });

  it('wraps the call in a span named after the feature (so Langfuse shows e.g. scenario-chat)', async () => {
    mockChatModel.invoke.mockResolvedValue({ content: 'hi' });

    await provider.chat([new HumanMessage('hi')], {
      ...baseOptions,
      metadata: { feature: LangfuseFeature.SCENARIO_CHAT },
    });

    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('scenario-chat', expect.any(Function));
    // runName on the LangChain call should match the span name too
    expect(mockChatModel.invoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ runName: 'scenario-chat' }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('falls back to a generic span name when no feature is provided', async () => {
    mockChatModel.invoke.mockResolvedValue({ content: 'hi' });

    await provider.chat([new HumanMessage('hi')], baseOptions);

    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('9router-chat', expect.any(Function));
  });

  it('wraps invoke failures as ServiceUnavailable', async () => {
    mockChatModel.invoke.mockRejectedValue(new Error('upstream 503'));

    await expect(provider.chat([new HumanMessage('hi')], baseOptions)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('yields chunk content from stream()', async () => {
    mockChatModel.stream.mockResolvedValue(
      (async function* () {
        yield { content: 'a' };
        yield { content: 'b' };
      })(),
    );

    const chunks: string[] = [];
    for await (const c of provider.stream([new HumanMessage('hi')], baseOptions)) {
      chunks.push(c);
    }

    expect(chunks).toEqual(['a', 'b']);
  });
});
