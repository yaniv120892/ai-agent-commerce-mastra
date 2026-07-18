import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '@/catalog/types';
import { COMMERCE_AGENT_INSTRUCTIONS } from './instructions';

describe('COMMERCE_AGENT_INSTRUCTIONS', () => {
  it('lists every category slug so the model cannot invent one', () => {
    for (const slug of CATEGORY_SLUGS) {
      expect(COMMERCE_AGENT_INSTRUCTIONS).toContain(slug);
    }
  });

  it('states the calibrated rating threshold rather than leaving it to the model', () => {
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('minRating: 4.5');
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('3.86');
  });

  it('names the tool it is allowed to source product facts from', () => {
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('resolveProducts');
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('excludeProductIds');
  });
});
