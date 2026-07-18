'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useState } from 'react';

type SpikeProduct = {
  id: number;
  title: string;
  price: number;
  category: string;
};

type SpikeToolOutput = {
  query: string;
  products: SpikeProduct[];
};

const THREAD_ID = 'spike-thread';
const RESOURCE_ID = 'spike-resource';

export default function SpikePage() {
  const [input, setInput] = useState('');
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);

  useEffect(() => {
    async function loadHistory(): Promise<void> {
      const response = await fetch(
        `/api/chat/history?threadId=${THREAD_ID}&resourceId=${RESOURCE_ID}`,
      );
      const body = await response.json();
      setInitialMessages(body.messages ?? []);
    }
    loadHistory();
  }, []);

  if (initialMessages === null) {
    return <main className="p-8">Loading history…</main>;
  }

  return <SpikeChat initialMessages={initialMessages} input={input} setInput={setInput} />;
}

function SpikeChat({
  initialMessages,
  input,
  setInput,
}: {
  initialMessages: UIMessage[];
  input: string;
  setInput: (value: string) => void;
}) {
  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: { threadId: THREAD_ID, resourceId: RESOURCE_ID },
    }),
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <h1 className="text-xl font-semibold">YAN-30 spike</h1>
      <div data-testid="chat-status" className="text-xs opacity-60">
        {status}
      </div>

      <div data-testid="messages" className="flex flex-col gap-4">
        {messages.map((message) => (
          <div key={message.id} className="rounded border p-3">
            <div className="text-xs uppercase opacity-60">{message.role}</div>
            {message.parts.map((part, index) => {
              if (part.type === 'text') {
                return <p key={index}>{part.text}</p>;
              }
              if (part.type === 'tool-searchProducts') {
                return <ProductCards key={index} state={part.state} output={part.output} />;
              }
              return null;
            })}
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage({ text: input });
          setInput('');
        }}
        className="flex gap-2"
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask for a product…"
        />
        <button className="rounded border px-4 py-2" disabled={status === 'streaming'}>
          Send
        </button>
      </form>
    </main>
  );
}

function ProductCards({ state, output }: { state: string; output: unknown }) {
  if (state !== 'output-available') {
    return <div data-testid="tool-pending">Searching… ({state})</div>;
  }
  if (!isSpikeToolOutput(output)) {
    return <div data-testid="tool-malformed">Tool output missing products</div>;
  }

  return (
    <div data-testid="product-cards" className="flex flex-col gap-2">
      {output.products.map((product) => (
        <div key={product.id} data-testid="product-card" className="rounded bg-black/5 p-2 text-sm">
          <strong>{product.title}</strong> — ${product.price} ({product.category})
        </div>
      ))}
    </div>
  );
}

function isSpikeToolOutput(value: unknown): value is SpikeToolOutput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Array.isArray(Reflect.get(value, 'products'));
}
