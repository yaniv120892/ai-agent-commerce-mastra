import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The headline requirement, end to end: product cards render from the tool result and
 * are still there after a reload.
 *
 * Readiness is gated on the Send button's label, never on the cards. Mastra persists an
 * assistant message only when the stream completes, while cards appear much earlier at
 * `tool-output-available`; reloading between those two points loses the whole turn. The
 * button flips back from "Sending…" exactly when `useChat` reaches `ready`, which is the
 * first moment the turn is durable.
 *
 * Every prompt here is distinct because the sidebar lists conversations from the other
 * tests in this file too, and a conversation is found by its title.
 */

const RELOAD_PROMPT = 'I need a smartphone under $400';
const RESUME_PROMPT = 'I need a smartphone under $400 that ships fast';
const FIRST_THREAD_PROMPT = 'I need a smartphone under $400 with a good camera';
const SECOND_THREAD_PROMPT = 'I need a smartphone under $400 for my father';
const GRID_PROMPT = 'I need a smartphone under $400 today';

test('renders product cards inline and keeps them across a reload', async ({ page }) => {
  await page.goto('/');
  await sendPrompt(page, RELOAD_PROMPT);

  await expect(productCards(page).first()).toBeVisible();
  const renderedCardCount = await productCards(page).count();
  expect(renderedCardCount).toBeGreaterThan(0);

  await waitForTurnToPersist(page);
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]+$/);

  await page.reload();

  await expect(productCards(page).first()).toBeVisible();
  await expect(productCards(page)).toHaveCount(renderedCardCount);
  await expect(shopperMessage(page, RELOAD_PROMPT)).toBeVisible();
});

test('lists the conversation in the sidebar and resumes it with history intact', async ({
  page,
}) => {
  await page.goto('/');
  await sendPrompt(page, RESUME_PROMPT);
  await expect(productCards(page).first()).toBeVisible();
  await waitForTurnToPersist(page);

  const conversationUrl = page.url();

  await page.goto('/');
  const sidebarLink = page.getByRole('link', { name: RESUME_PROMPT, exact: true });
  await expect(sidebarLink).toBeVisible();
  await sidebarLink.click();

  await expect(page).toHaveURL(conversationUrl);
  await expect(shopperMessage(page, RESUME_PROMPT)).toBeVisible();
  await expect(productCards(page).first()).toBeVisible();
});

test('starts a fresh thread on New chat without clobbering the previous one', async ({ page }) => {
  await page.goto('/');
  await sendPrompt(page, FIRST_THREAD_PROMPT);
  await expect(productCards(page).first()).toBeVisible();
  await waitForTurnToPersist(page);

  const firstConversationUrl = page.url();

  await page.getByRole('button', { name: 'New chat' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'What are you shopping for?' })).toBeVisible();
  await expect(productCards(page)).toHaveCount(0);

  await sendPrompt(page, SECOND_THREAD_PROMPT);
  await expect(productCards(page).first()).toBeVisible();
  await waitForTurnToPersist(page);

  expect(page.url()).not.toBe(firstConversationUrl);
  await expect(shopperMessage(page, FIRST_THREAD_PROMPT)).toHaveCount(0);

  await page.goto(firstConversationUrl);
  await expect(shopperMessage(page, FIRST_THREAD_PROMPT)).toBeVisible();
  await expect(productCards(page).first()).toBeVisible();
});

test('renders the real product grid, leaving no skeleton cards behind', async ({ page }) => {
  await page.goto('/');
  await sendPrompt(page, GRID_PROMPT);
  await expect(productCards(page).first()).toBeVisible();
  await waitForTurnToPersist(page);

  // Skeletons and real cards share the same shadcn Card primitive, so asserting on
  // [data-slot="card"] would match either one. The test ids are the only safe handle.
  await expect(page.getByTestId('product-grid')).toBeVisible();
  await expect(page.getByTestId('product-grid-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('product-card-skeleton')).toHaveCount(0);
});

function productCards(page: Page): Locator {
  return page.getByTestId('product-card');
}

// Scoped to the transcript and matched exactly: the sidebar lists every conversation in
// this file, and several titles share a prefix.
function shopperMessage(page: Page, prompt: string): Locator {
  return page.getByRole('main').getByText(prompt, { exact: true });
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByLabel('Message').fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function waitForTurnToPersist(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}
