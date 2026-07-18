// This app runs locally for one person and has no authentication. Every thread is
// filed under the same resource so the sidebar can list them; it is a namespace, not
// an identity.
export const LOCAL_RESOURCE_ID = 'local-user';

export const CONVERSATION_TITLE_MAX_LENGTH = 60;

const FALLBACK_CONVERSATION_TITLE = 'New conversation';

export function deriveConversationTitle(firstUserMessage: string): string {
  const collapsed = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return FALLBACK_CONVERSATION_TITLE;
  }
  if (collapsed.length <= CONVERSATION_TITLE_MAX_LENGTH) {
    return collapsed;
  }

  const truncated = collapsed.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  const onAWordBoundary = lastSpace > CONVERSATION_TITLE_MAX_LENGTH / 2;

  return `${(onAWordBoundary ? truncated.slice(0, lastSpace) : truncated).trimEnd()}…`;
}
