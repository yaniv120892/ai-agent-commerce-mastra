import { commerceMemory } from './memory';

type ShopperState = Record<string, unknown>;

/**
 * Appends the ids a search just returned to the shopper's working-memory state.
 *
 * These ids are recorded here rather than left to the model. Every other field in
 * shopper state is something the shopper said, which the model transcribes reliably;
 * this one is six integers copied out of a tool result it must reproduce exactly on
 * every later turn. Measured live, the model recorded them on 1 run in 3 — and a
 * near-miss is invisible, because a wrong id silently fails to exclude the product it
 * names and "show me more" quietly returns a page the shopper has already seen.
 *
 * Working memory replaces arrays wholesale rather than merging them, so the existing
 * list is read and re-sent rather than appended to in place.
 *
 * Every failure here is swallowed. This is bookkeeping that makes a later "show me more"
 * better, not part of answering the search the shopper is waiting on — a memory instance
 * without working memory enabled, or a write that loses a race, should cost them a repeated
 * page at worst, never the results themselves.
 */
export async function recordShownProducts({
  threadId,
  resourceId,
  productIds,
}: {
  threadId: string;
  resourceId?: string;
  productIds: number[];
}): Promise<void> {
  if (productIds.length === 0) {
    return;
  }

  try {
    const existingState = await readShopperState(threadId, resourceId);
    const alreadyShown = toNumberArray(existingState.shownProductIds);
    const merged = [...new Set([...alreadyShown, ...productIds])];

    if (merged.length === alreadyShown.length) {
      return;
    }

    await commerceMemory.updateWorkingMemory({
      threadId,
      resourceId,
      workingMemory: JSON.stringify({ ...existingState, shownProductIds: merged }),
    });
  } catch {
    return;
  }
}

async function readShopperState(threadId: string, resourceId?: string): Promise<ShopperState> {
  const stored = await commerceMemory.getWorkingMemory({ threadId, resourceId });
  if (stored === null) {
    return {};
  }

  // Working memory is model-written, so malformed JSON is a live possibility.
  const parsed: ShopperState | unknown = JSON.parse(stored);
  if (!isShopperState(parsed)) {
    return {};
  }

  return parsed;
}

function isShopperState(value: unknown): value is ShopperState {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry) => typeof entry === 'number' && Number.isFinite(entry));
}
