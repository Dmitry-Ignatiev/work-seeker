import { expect, test, type Page } from '@playwright/test';

// The dev server runs with AI_MOCK=1 and E2E=1: a scripted model and offline demo listings.

async function signUp(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'No account? Create one' }).click();
  await page.getByLabel('Name').fill('Chat Tester');
  await page.getByLabel('Email').fill(`chat-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
}

test('describe a job, get job cards with links, then open one for details', async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole('heading', { name: 'Find your next high-tech job' })).toBeVisible();

  const message = page.getByLabel('Message');
  await message.fill('Senior backend jobs in Tel Aviv');
  await message.press('Enter');

  await expect(page.getByTestId('user-message')).toHaveText('Senior backend jobs in Tel Aviv');
  const jobs = page.getByLabel('Jobs found');
  const card = jobs.getByRole('article', { name: 'Senior Backend Engineer (Node.js)' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Acme Robotics (demo)')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', 'https://example.com/jobs/acme-backend');
  await expect(page.getByTestId('search-sources')).toContainText('Demo listings');
  await expect(page.getByTestId('assistant-message').last()).toContainText('Here are the jobs I found');

  await card.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText(/Read the full posting: Senior Backend Engineer \(Node\.js\)/)).toBeVisible();
  await expect(page.getByTestId('assistant-message').last()).toContainText('solid backend experience');
});

test('example prompts start a search', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Remote DevOps roles with Kubernetes' }).click();
  await expect(page.getByLabel('Jobs found').getByRole('article').first()).toBeVisible();
});

test('the chat API refuses signed-out requests', async ({ request }) => {
  const response = await request.post('/api/chat', { data: { messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] } });
  expect(response.status()).toBe(401);
});
