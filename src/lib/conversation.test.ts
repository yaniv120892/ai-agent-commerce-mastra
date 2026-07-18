import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  deriveConversationTitle,
  LOCAL_RESOURCE_ID,
} from './conversation';

describe('LOCAL_RESOURCE_ID', () => {
  it('is a fixed namespace because the app has no authentication', () => {
    expect(LOCAL_RESOURCE_ID).toBe('local-user');
  });
});

describe('deriveConversationTitle', () => {
  it('uses a short message verbatim', () => {
    expect(deriveConversationTitle('cheap laptops under 500')).toBe('cheap laptops under 500');
  });

  it('collapses whitespace and trims', () => {
    expect(deriveConversationTitle('  show   me\n mascara ')).toBe('show me mascara');
  });

  it('falls back when the message is blank', () => {
    expect(deriveConversationTitle('   \n  ')).toBe('New conversation');
  });

  it('truncates long messages on a word boundary with an ellipsis', () => {
    const message =
      'I am looking for a highly rated laptop that ships quickly and has a generous return policy';

    const title = deriveConversationTitle(message);

    expect(title.length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX_LENGTH + 1);
    expect(title.endsWith('…')).toBe(true);
    expect(title.endsWith(' …')).toBe(false);
    expect(message.startsWith(title.slice(0, -1))).toBe(true);
  });

  it('truncates mid-token when a single word overruns the limit', () => {
    const title = deriveConversationTitle('a'.repeat(200));

    expect(title).toBe(`${'a'.repeat(CONVERSATION_TITLE_MAX_LENGTH)}…`);
  });
});
