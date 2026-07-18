import { ChatShell } from '@/components/chat/chat-shell';

type ConversationPageProps = {
  params: Promise<{ threadId: string }>;
};

export default async function ConversationPage({ params }: ConversationPageProps) {
  const { threadId } = await params;

  // Keyed so switching threads from the sidebar remounts the chat rather than
  // leaving the previous thread's messages in place.
  return <ChatShell key={threadId} initialThreadId={threadId} />;
}
