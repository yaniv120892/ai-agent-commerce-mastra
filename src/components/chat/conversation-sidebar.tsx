'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Conversation } from './types';

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeThreadId: string | null;
  isLoading: boolean;
  errorText: string | null;
  onNewChat: () => void;
};

const UNTITLED_CONVERSATION_LABEL = 'Untitled conversation';

const SKELETON_ROW_COUNT = 4;

export function ConversationSidebar({
  conversations,
  activeThreadId,
  isLoading,
  errorText,
  onNewChat,
}: ConversationSidebarProps) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 flex-col border-r md:flex">
      <div className="flex flex-col gap-3 p-3">
        <span className="px-1 text-sm font-semibold">Commerce Copilot</span>
        <Button variant="outline" size="lg" onClick={onNewChat} className="justify-start">
          New chat
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Conversations">
        <SidebarBody
          conversations={conversations}
          activeThreadId={activeThreadId}
          isLoading={isLoading}
          errorText={errorText}
        />
      </nav>
    </aside>
  );
}

function SidebarBody({
  conversations,
  activeThreadId,
  isLoading,
  errorText,
}: Omit<ConversationSidebarProps, 'onNewChat'>) {
  if (errorText !== null) {
    return <p className="text-destructive px-1 py-2 text-xs">{errorText}</p>;
  }

  if (isLoading && conversations.length === 0) {
    return (
      <ul className="flex flex-col gap-1">
        {Array.from({ length: SKELETON_ROW_COUNT }, (_unused, index) => (
          <li key={index}>
            <Skeleton className="h-8 w-full" />
          </li>
        ))}
      </ul>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="text-muted-foreground px-1 py-2 text-xs">
        No conversations yet. Ask something to start one.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <ConversationLink
            conversation={conversation}
            isActive={conversation.id === activeThreadId}
          />
        </li>
      ))}
    </ul>
  );
}

function ConversationLink({
  conversation,
  isActive,
}: {
  conversation: Conversation;
  isActive: boolean;
}) {
  const activeClassName = isActive
    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground';

  return (
    <Link
      href={`/c/${conversation.id}`}
      aria-current={isActive ? 'page' : undefined}
      className={`block truncate rounded-lg px-2 py-1.5 text-sm transition-colors ${activeClassName}`}
    >
      {conversation.title ?? <span className="italic">{UNTITLED_CONVERSATION_LABEL}</span>}
    </Link>
  );
}
