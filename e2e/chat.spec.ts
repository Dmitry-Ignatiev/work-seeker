import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

// The dev server runs with AI_MOCK=1 and E2E=1: a scripted model and offline demo listings.

test('describe a job, get job cards with links, then open one for details', async ({ page }) => {
  await signUp(page, 'Chat Tester', 'chat');
  await expect(page.getByRole('heading', { name: 'Find your next high-tech job' })).toBeVisible();

  const message = page.getByLabel('Message');
  await message.fill('Senior backend jobs in Tel Aviv');
  await message.press('Enter');

  await expect(page.getByTestId('user-message')).toHaveText('Senior backend jobs in Tel Aviv');
  const jobs = page.getByLabel('Jobs found');
  const card = jobs.getByRole('article', { name: 'Senior Backend Engineer (Node.js)' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Acme Robotics (demo)')).toBeVisible();
  // Offline listings are made up, so they show a label instead of a dead link.
  await expect(card.getByText('Demo listing, no real posting')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open job' })).toHaveCount(0);
  await expect(page.getByTestId('search-sources')).toContainText('Demo listings');
  await expect(page.getByTestId('assistant-message').last()).toContainText('Here are the jobs I found');

  // The title opens the job's own page: the posting, what it asks for, and a chat about this job.
  await card.getByRole('link', { name: 'Senior Backend Engineer (Node.js)' }).click();
  await expect(page).toHaveURL(/\/jobs\/[^/?]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Senior Backend Engineer (Node.js)' })).toBeVisible();
  await expect(page.getByTestId('job-description')).toContainText('Build backend services in Node.js and TypeScript');
  await expect(page.getByTestId('requirements')).toContainText('Node.js');
  await expect(page.getByRole('button', { name: 'Tailor my CV for this job' })).toBeVisible();

  // Back to search: the earlier results are still there.
  await page.getByRole('link', { name: 'Back to search' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByLabel('Jobs found').getByRole('article', { name: 'Senior Backend Engineer (Node.js)' })).toBeVisible();
});

test('example prompts start a search', async ({ page }) => {
  await signUp(page, 'Chat Tester', 'chat');
  await page.getByRole('button', { name: 'Remote DevOps roles with Kubernetes' }).click();
  await expect(page.getByLabel('Jobs found').getByRole('article').first()).toBeVisible();
});

test('the chat API refuses signed-out requests', async ({ request }) => {
  const response = await request.post('/api/chat', { data: { messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] } });
  expect(response.status()).toBe(401);
});
