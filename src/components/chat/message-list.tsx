'use client';

import type { ChatStatus, UIMessagePart } from 'ai';
import type { ProductCard as ProductCardData } from '@/catalog/types';
import { ProductCard, ProductCardSkeleton } from './product-card';
import type { CommerceUIMessage, CommerceUITools } from './types';

type MessageListProps = {
  messages: CommerceUIMessage[];
  status: ChatStatus;
  errorText: string | null;
};

type CommerceMessagePart = UIMessagePart<Record<string, unknown>, CommerceUITools>;

const SKELETON_CARD_COUNT = 3;

export function MessageList({ messages, status, errorText }: MessageListProps) {
  return (
    <div className="flex flex-col gap-6">
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}

      {isAwaitingFirstToken(messages, status) ? <PendingReplyIndicator /> : null}

      {errorText === null ? null : <TurnError text={errorText} />}
    </div>
  );
}

function MessageRow({ message }: { message: CommerceUIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div className={isUser ? 'max-w-[85%]' : 'w-full'}>
        <div className="flex flex-col gap-3">
          {message.parts.map((part, index) => (
            <MessagePart key={`${message.id}-${index}`} part={part} isUser={isUser} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessagePart({ part, isUser }: { part: CommerceMessagePart; isUser: boolean }) {
  switch (part.type) {
    case 'text': {
      if (part.text.trim().length === 0) {
        return null;
      }
      return isUser ? (
        <p className="bg-primary text-primary-foreground rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap">
          {part.text}
        </p>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{part.text}</p>
      );
    }
    case 'tool-resolveProducts': {
      return <ResolveProductsPart part={part} />;
    }
    default: {
      return null;
    }
  }
}

function ResolveProductsPart({
  part,
}: {
  part: Extract<CommerceMessagePart, { type: 'tool-resolveProducts' }>;
}) {
  switch (part.state) {
    case 'input-streaming':
    case 'input-available': {
      return <ProductGridSkeleton />;
    }
    case 'output-available': {
      return <ProductGrid products={part.output.products} />;
    }
    case 'output-error': {
      return (
        <ToolNotice
          tone="error"
          text={`The catalog search failed, so no products are shown: ${part.errorText}`}
        />
      );
    }
    default: {
      return null;
    }
  }
}

function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0) {
    return <ToolNotice tone="muted" text="No products in the catalog matched that search." />;
  }

  return (
    <div data-testid="product-grid" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <div
      data-testid="product-grid-skeleton"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label="Searching the catalog"
      aria-busy="true"
    >
      {Array.from({ length: SKELETON_CARD_COUNT }, (_unused, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

function ToolNotice({ tone, text }: { tone: 'error' | 'muted'; text: string }) {
  const toneClassName =
    tone === 'error'
      ? 'border-destructive/40 text-destructive'
      : 'border-border text-muted-foreground';

  return <p className={`rounded-lg border px-3 py-2 text-sm ${toneClassName}`}>{text}</p>;
}

function PendingReplyIndicator() {
  return (
    <p className="text-muted-foreground animate-pulse text-sm" aria-live="polite">
      Thinking…
    </p>
  );
}

function TurnError({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm"
    >
      {text}
    </p>
  );
}

function isAwaitingFirstToken(messages: CommerceUIMessage[], status: ChatStatus): boolean {
  if (status !== 'submitted') {
    return false;
  }

  return messages.at(-1)?.role !== 'assistant';
}
