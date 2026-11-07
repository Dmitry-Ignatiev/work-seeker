import { expect, test } from '@playwright/test';
import { makePdf, SAMPLE_CV_LINES } from '../tests/support/make-pdf';

// AI_MOCK=1 + E2E=1: demo listings, a scripted agent, and offline tailoring that proposes one truthful edit
// (Node.js, which the CV has) and one the guard must refuse (AWS, which it doesn't).

test('tailor a CV for a job: upload in chat, see what changed and what was refused, confirm a skill, download', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'No account? Create one' }).click();
  await page.getByLabel('Name').fill('Tailor Tester');
  await page.getByLabel('Email').fill(`tailor-${Date.now()}@example.test`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/assistant$/);

  const message = page.getByLabel('Message');
  await message.fill('Senior backend jobs in Tel Aviv');
  await message.press('Enter');
  const card = page.getByLabel('Jobs found').getByRole('article', { name: 'Senior Backend Engineer (Node.js)' });
  await card.getByRole('button', { name: 'Tailor my CV' }).click();

  // No CV yet: an upload box appears in the chat, and tailoring continues after the upload.
  const needed = page.getByTestId('cv-needed');
  const upload = needed.getByLabel('Upload your CV (PDF)');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({ name: 'Dana Levi CV.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf([SAMPLE_CV_LINES])) });

  const result = page.getByRole('region', { name: 'Tailored CV' });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.getByRole('heading', { name: /CV tailored for Senior Backend Engineer/ })).toBeVisible();
  await expect(result.getByTestId('coverage')).toContainText('of 5');
  await expect(result.getByLabel('Changes')).toContainText('dashboards with a Node.js backend used by 40,000 customers');
  await expect(result.getByTestId('refused')).toContainText('"AWS" isn\'t in your CV');

  // Download works for the owner.
  const href = await result.getByRole('link', { name: 'Download DOCX' }).getAttribute('href');
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('wordprocessingml');

  // AWS is missing: the user says they have it, approves, and it's saved.
  await result.getByTestId('missing').getByRole('button', { name: 'I have AWS' }).click();
  await expect(message).toHaveValue('I have real experience with AWS: ');
  await message.pressSequentially('two years running our services on AWS at Acme');
  await message.press('Enter');

  const confirm = page.getByTestId('confirm-experience');
  await expect(confirm).toContainText('two years running our services on AWS at Acme');
  await confirm.getByRole('button', { name: 'Yes, it’s true' }).click();
  await expect(page.getByText('Saved: AWS')).toBeVisible();
  await expect(page.getByTestId('assistant-message').last()).toContainText('Saved');
});

test("a tailored CV can't be downloaded by someone else", async ({ request }) => {
  const response = await request.get('/api/tailored-cvs/not-a-real-id/docx');
  expect(response.status()).toBe(401);
});
