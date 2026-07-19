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

  // Deleting this section regressed superlative-highest-rated-catalog on two consecutive
  // eval:online runs — the model fell back to searchTerms ["product"]. Only the paid eval
  // can prove that, so this free assertion stands in for it.
  it('keeps the superlative guidance that ablation proved load-bearing', () => {
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('Superlatives about the whole catalog');
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('Do not fan out across categories');
  });

  // The prompt used to tell the model not to search for things it "knew" were absent, and it
  // duly denied stocking three products the catalog carries — with no tool call behind the
  // denial, so nothing downstream could catch it. Only eval:online can prove the behaviour;
  // this free assertion stops the sentence that fixed it being deleted silently.
  it('makes an empty search, not a prior, the only thing that licenses a decline', () => {
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain('came back empty in this turn');
    expect(COMMERCE_AGENT_INSTRUCTIONS).not.toContain('do not call the tool');
    expect(COMMERCE_AGENT_INSTRUCTIONS).not.toContain('search you already know will be empty');
  });

  it('defers call mechanics to the tool description rather than restating them', () => {
    expect(COMMERCE_AGENT_INSTRUCTIONS).not.toContain('Good: ["laptop", "apple", "macbook"]');
    expect(COMMERCE_AGENT_INSTRUCTIONS).toContain("The tool's own description covers");
  });
});
