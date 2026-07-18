import type { UIDataTypes, UIMessage } from 'ai';
import type { RetrievalCriteria } from '@/catalog/types';
import type { ResolveProductsOutput } from '@/mastra/tools/resolve-products-tool.types';

// The key here must match the `tools` record key on the agent: `resolveProducts`
// produces message parts of type `tool-resolveProducts`, which is what the UI
// switches on to render cards.
export type CommerceUITools = {
  resolveProducts: {
    input: RetrievalCriteria;
    output: ResolveProductsOutput;
  };
};

export type CommerceUIMessage = UIMessage<unknown, UIDataTypes, CommerceUITools>;

export type Conversation = {
  id: string;
  title: string | null;
};
