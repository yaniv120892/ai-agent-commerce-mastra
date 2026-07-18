import type { CommerceUIMessage, Conversation } from './types';

const CONVERSATIONS_ENDPOINT = '/api/conversations';
const CHAT_ENDPOINT = '/api/chat';

export async function listConversations(signal?: AbortSignal): Promise<Conversation[]> {
  const response = await fetch(CONVERSATIONS_ENDPOINT, { signal });
  const body = await readJsonBody(response, 'list conversations');

  const conversations = Reflect.get(body, 'conversations');
  if (!Array.isArray(conversations)) {
    throw new Error(
      `GET ${CONVERSATIONS_ENDPOINT} did not return a conversations array (received: ${describeValue(conversations)})`,
    );
  }

  return conversations.filter((conversation) => isConversation(conversation));
}

export async function createConversation(): Promise<Conversation> {
  const response = await fetch(CONVERSATIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const body = await readJsonBody(response, 'create a conversation');

  const conversation = Reflect.get(body, 'conversation');
  if (!isConversation(conversation)) {
    throw new Error(
      `POST ${CONVERSATIONS_ENDPOINT} did not return a conversation (received: ${describeValue(conversation)})`,
    );
  }

  return conversation;
}

export async function fetchConversationMessages(
  threadId: string,
  signal?: AbortSignal,
): Promise<CommerceUIMessage[]> {
  const response = await fetch(`${CHAT_ENDPOINT}?threadId=${encodeURIComponent(threadId)}`, {
    signal,
  });
  const body = await readJsonBody(response, `load conversation ${threadId}`);

  const messages = Reflect.get(body, 'messages');
  if (!Array.isArray(messages)) {
    throw new Error(
      `GET ${CHAT_ENDPOINT} did not return a messages array for thread ${threadId} (received: ${describeValue(messages)})`,
    );
  }

  return messages.filter((message) => isCommerceUIMessage(message));
}

async function readJsonBody(response: Response, action: string): Promise<object> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const parsed = typeof body === 'object' && body !== null ? body : {};

  if (!response.ok) {
    const reportedError = Reflect.get(parsed, 'error');
    const detail = typeof reportedError === 'string' ? reportedError : `HTTP ${response.status}`;
    throw new Error(`Could not ${action}: ${detail}`);
  }

  return parsed;
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const title = Reflect.get(value, 'title');

  return (
    typeof Reflect.get(value, 'id') === 'string' && (title === null || typeof title === 'string')
  );
}

function isCommerceUIMessage(value: unknown): value is CommerceUIMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const role = Reflect.get(value, 'role');
  const isKnownRole = role === 'system' || role === 'user' || role === 'assistant';

  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    isKnownRole &&
    Array.isArray(Reflect.get(value, 'parts'))
  );
}

function describeValue(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}
