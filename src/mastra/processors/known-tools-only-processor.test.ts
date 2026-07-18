import type { ProcessLLMRequestArgs } from '@mastra/core/processors';
import { describe, expect, it } from 'vitest';
import { KnownToolsOnlyProcessor } from './known-tools-only-processor';

type Prompt = ProcessLLMRequestArgs['prompt'];

function runProcessor(knownToolNames: string[], prompt: Prompt): Prompt {
  const processor = new KnownToolsOnlyProcessor(knownToolNames);
  const result = processor.processLLMRequest({ prompt });

  return result?.prompt ?? prompt;
}

function toolTurn(toolName: string, toolCallId: string): Prompt {
  return [
    { role: 'user', content: [{ type: 'text', text: 'find me something' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId, toolName, input: { searchTerms: ['mascara'] } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: { type: 'json', value: { resultCount: 1 } },
        },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'here you go' }] },
  ];
}

describe('KnownToolsOnlyProcessor', () => {
  it('passes a prompt through untouched when every tool is still declared', () => {
    const prompt = toolTurn('resolveProducts', 'call-1');

    expect(runProcessor(['resolveProducts'], prompt)).toEqual(prompt);
  });

  it('drops a tool call naming a tool the agent no longer declares', () => {
    const prompt = toolTurn('searchProducts', 'call-1');

    const rewritten = runProcessor(['resolveProducts'], prompt);

    expect(rewritten.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(rewritten)).not.toContain('searchProducts');
  });

  it('drops the matching tool result so no orphaned result reaches the provider', () => {
    const prompt = toolTurn('searchProducts', 'call-1');

    const rewritten = runProcessor(['resolveProducts'], prompt);

    const toolResultIds = rewritten
      .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
      .filter((part) => part.type === 'tool-result')
      .map((part) => part.toolCallId);
    expect(toolResultIds).toEqual([]);
  });

  it('keeps current tool calls while removing stale ones from the same thread', () => {
    const prompt: Prompt = [
      ...toolTurn('searchProducts', 'stale-1'),
      ...toolTurn('resolveProducts', 'live-1'),
    ];

    const rewritten = runProcessor(['resolveProducts'], prompt);

    const serialized = JSON.stringify(rewritten);
    expect(serialized).not.toContain('stale-1');
    expect(serialized).toContain('live-1');
  });

  it('leaves string-content messages alone', () => {
    const prompt: Prompt = [{ role: 'system', content: 'be helpful' }];

    expect(runProcessor(['resolveProducts'], prompt)).toEqual(prompt);
  });
});
