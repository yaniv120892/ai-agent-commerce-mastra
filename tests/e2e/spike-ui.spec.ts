import { expect, test } from '@playwright/test';

test('cards render from tool result and survive reload', async ({ page }) => {
  await page.goto('/spike');
  await page.getByPlaceholder('Ask for a product…').fill('show me some laptops');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByTestId('product-cards')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByTestId('product-card').count()).toBe(3);

  // Mastra persists the assistant message only once the stream completes;
  // reloading mid-stream loses the turn entirely.
  await expect(page.getByTestId('chat-status')).toHaveText('ready', { timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId('product-cards')).toBeVisible({ timeout: 30_000 });
  expect(await page.getByTestId('product-card').count()).toBe(3);
});
