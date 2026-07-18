import type {
  Processor,
  ProcessLLMRequestArgs,
  ProcessLLMRequestResult,
} from '@mastra/core/processors';

type Prompt = ProcessLLMRequestArgs['prompt'];

// The processor reads nothing but the prompt, so it declares nothing but the prompt.
// Method parameters are bivariant, so this still satisfies `Processor`, and callers
// (including tests) no longer have to fabricate a whole request to exercise it.
type PromptOnlyRequest = { prompt: Prompt };

export const KNOWN_TOOLS_ONLY_PROCESSOR_ID = 'known-tools-only';

/**
 * Drops history tool calls naming a tool the agent no longer declares.
 *
 * Recall replays stored turns verbatim, so a thread used while an earlier tool set
 * was in place keeps sending calls for tools that are no longer part of the request.
 * OpenAI answers that prompt with an empty `stop` turn and no tool calls — the
 * conversation goes mute while fresh threads keep working. Rewriting the prompt
 * rather than the stored messages leaves persisted history and the rendered cards
 * intact; only what this one request forwards to the provider changes.
 */
export class KnownToolsOnlyProcessor implements Processor {
  public readonly id = KNOWN_TOOLS_ONLY_PROCESSOR_ID;
  public readonly name = 'KnownToolsOnly';

  private readonly knownToolNames: ReadonlySet<string>;

  public constructor(knownToolNames: string[]) {
    this.knownToolNames = new Set(knownToolNames);
  }

  public processLLMRequest({ prompt }: PromptOnlyRequest): ProcessLLMRequestResult {
    const staleToolCallIds = this.collectStaleToolCallIds(prompt);
    if (staleToolCallIds.size === 0) {
      return undefined;
    }

    const rewritten: Prompt = [];
    for (const message of prompt) {
      switch (message.role) {
        case 'assistant': {
          const content = message.content.filter(
            (part) => part.type !== 'tool-call' || !staleToolCallIds.has(part.toolCallId),
          );
          if (content.length > 0) {
            rewritten.push({ ...message, content });
          }
          break;
        }
        case 'tool': {
          const content = message.content.filter((part) => !staleToolCallIds.has(part.toolCallId));
          if (content.length > 0) {
            rewritten.push({ ...message, content });
          }
          break;
        }
        default: {
          rewritten.push(message);
          break;
        }
      }
    }

    return { prompt: rewritten };
  }

  private collectStaleToolCallIds(prompt: Prompt): Set<string> {
    const staleToolCallIds = new Set<string>();

    for (const message of prompt) {
      if (message.role !== 'assistant') {
        continue;
      }
      for (const part of message.content) {
        if (part.type !== 'tool-call') {
          continue;
        }
        if (!this.knownToolNames.has(part.toolName)) {
          staleToolCallIds.add(part.toolCallId);
        }
      }
    }

    return staleToolCallIds;
  }
}
