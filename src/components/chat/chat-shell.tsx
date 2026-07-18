'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createConversation,
  fetchConversationMessages,
  listConversations,
} from './chat-api-client';
import { ConversationSidebar } from './conversation-sidebar';
import { MessageList } from './message-list';
import type { CommerceUIMessage, Conversation } from './types';

type ChatShellProps = {
  initialThreadId: string | null;
};

const CHAT_TRANSPORT = new DefaultChatTransport<CommerceUIMessage>({ api: '/api/chat' });

const EXAMPLE_PROMPTS = [
  'I need a laptop under $1000 with a good rating',
  'Show me highly rated skincare that ships overnight',
  'What cheap beauty products do you have?',
];

export function ChatShell({ initialThreadId }: ChatShellProps) {
  const router = useRouter();

  const { messages, setMessages, sendMessage, status, error } = useChat<CommerceUIMessage>({
    transport: CHAT_TRANSPORT,
  });

  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [conversationsErrorText, setConversationsErrorText] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(initialThreadId !== null);
  const [historyErrorText, setHistoryErrorText] = useState<string | null>(null);
  const [sendErrorText, setSendErrorText] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const refreshConversations = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      setConversations(await listConversations(signal));
      setConversationsErrorText(null);
    } catch (refreshError) {
      if (isAbortError(refreshError)) {
        return;
      }
      setConversationsErrorText(describeError(refreshError));
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadConversations = async (): Promise<void> => {
      await refreshConversations(controller.signal);
    };

    void loadConversations();

    return () => {
      controller.abort();
    };
  }, [refreshConversations]);

  useEffect(() => {
    if (initialThreadId === null) {
      return;
    }

    const controller = new AbortController();

    const hydrateHistory = async (): Promise<void> => {
      try {
        setMessages(await fetchConversationMessages(initialThreadId, controller.signal));
        setHistoryErrorText(null);
      } catch (hydrationError) {
        if (isAbortError(hydrationError)) {
          return;
        }
        setHistoryErrorText(describeError(hydrationError));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingHistory(false);
        }
      }
    };

    void hydrateHistory();

    return () => {
      controller.abort();
    };
  }, [initialThreadId, setMessages]);

  const startNewChat = useCallback((): void => {
    if (initialThreadId !== null) {
      router.push('/');
      return;
    }

    setActiveThreadId(null);
    setMessages([]);
    setInput('');
    setSendErrorText(null);
    window.history.replaceState(null, '', '/');
  }, [initialThreadId, router, setMessages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const prompt = input.trim();
    const isBusy = status === 'submitted' || status === 'streaming';
    if (prompt.length === 0 || isBusy) {
      return;
    }

    setInput('');
    setSendErrorText(null);

    try {
      const threadId = activeThreadId ?? (await openConversation());
      await sendMessage({ text: prompt }, { body: { threadId } });
    } catch (submitError) {
      setSendErrorText(describeError(submitError));
    }

    // The title is backfilled from the first user message, so the sidebar entry for a
    // brand-new conversation only becomes meaningful once the turn is done.
    await refreshConversations();
  };

  // A conversation has to exist before POST /api/chat, which 404s on an unknown thread.
  const openConversation = async (): Promise<string> => {
    const conversation = await createConversation();

    setActiveThreadId(conversation.id);
    setConversations((current) => [conversation, ...current]);
    window.history.replaceState(null, '', `/c/${conversation.id}`);

    return conversation.id;
  };

  const isBusy = status === 'submitted' || status === 'streaming';
  const turnErrorText = sendErrorText ?? (error ? error.message : null);

  return (
    <div className="flex h-dvh w-full">
      <ConversationSidebar
        conversations={conversations}
        activeThreadId={activeThreadId}
        isLoading={isLoadingConversations}
        errorText={conversationsErrorText}
        onNewChat={startNewChat}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            <ConversationBody
              messages={messages}
              status={status}
              turnErrorText={turnErrorText}
              isLoadingHistory={isLoadingHistory}
              historyErrorText={historyErrorText}
              onPickExample={setInput}
            />
          </div>
        </div>

        <div className="bg-background border-t">
          <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl gap-2 px-4 py-3">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about products, budgets, or delivery…"
              aria-label="Message"
              className="h-10"
              disabled={isLoadingHistory}
            />
            <Button
              type="submit"
              size="lg"
              className="h-10 px-4"
              disabled={isBusy || input.trim().length === 0}
            >
              {isBusy ? 'Sending…' : 'Send'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

type ConversationBodyProps = {
  messages: CommerceUIMessage[];
  status: ReturnType<typeof useChat<CommerceUIMessage>>['status'];
  turnErrorText: string | null;
  isLoadingHistory: boolean;
  historyErrorText: string | null;
  onPickExample: (prompt: string) => void;
};

function ConversationBody({
  messages,
  status,
  turnErrorText,
  isLoadingHistory,
  historyErrorText,
  onPickExample,
}: ConversationBodyProps) {
  if (historyErrorText !== null) {
    return (
      <p
        role="alert"
        className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm"
      >
        {historyErrorText}
      </p>
    );
  }

  if (isLoadingHistory) {
    return <p className="text-muted-foreground text-sm">Loading this conversation…</p>;
  }

  if (messages.length === 0 && turnErrorText === null) {
    return <EmptyState onPickExample={onPickExample} />;
  }

  return <MessageList messages={messages} status={status} errorText={turnErrorText} />;
}

function EmptyState({ onPickExample }: { onPickExample: (prompt: string) => void }) {
  return (
    <div className="flex flex-col gap-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">What are you shopping for?</h1>
        <p className="text-muted-foreground text-sm">
          Every product shown comes straight from the catalog search, never from the reply text.
        </p>
      </div>
      <ul className="flex flex-col items-start gap-2">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <Button variant="outline" size="lg" onClick={() => onPickExample(prompt)}>
              {prompt}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
