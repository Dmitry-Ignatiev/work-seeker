import { expect, test } from '@playwright/test';
import { signUp } from './helpers';
import { makePdf, SAMPLE_CV_LINES } from '../tests/support/make-pdf';

// AI_MOCK=1 + E2E=1: demo listings, a scripted agent, and offline tailoring that proposes one truthful edit
// (Node.js, which the CV has) and one the guard must refuse (AWS, which it doesn't).

test('tailor a CV for a job: upload in chat, see what changed and what was refused, confirm a skill, download', async ({ page }) => {
  await signUp(page, 'Tailor Tester', 'tailor');

  const message = page.getByLabel('Message');
  await message.fill('Senior backend jobs in Tel Aviv');
  await message.press('Enter');
  const card = page.getByLabel('Jobs found').getByRole('article', { name: 'Senior Backend Engineer (Node.js)' });
  await card.getByRole('link', { name: 'Tailor my CV' }).click();

  // The job's own page opens and tailoring starts there right away.
  await expect(page).toHaveURL(/\/jobs\/[^/?]+\?tailor=1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Senior Backend Engineer (Node.js)' })).toBeVisible();

  // No CV yet: an upload box appears in the job's chat, and tailoring continues after the upload.
  const needed = page.getByTestId('cv-needed');
  const upload = needed.getByLabel('Upload your CV (PDF)');
  await expect(upload).toBeEnabled();
  await upload.setInputFiles({ name: 'Dana Levi CV.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf([SAMPLE_CV_LINES])) });

  const result = page.getByRole('region', { name: 'Tailored CV' });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.getByRole('heading', { name: /CV tailored for Senior Backend Engineer/ })).toBeVisible();
  await expect(result.getByTestId('coverage')).toContainText('of 5');
  await expect(result.getByLabel('Changes')).toContainText('dashboards with a Node.js backend used by 40,000 customers');
  // Refused rewrites are folded away; the reason is there when opened.
  await expect(result.getByTestId('refused')).toContainText('1 suggested rewrite was kept as written');
  await result.getByTestId('refused').getByText(/kept as written/).click();
  await expect(result.getByTestId('refused')).toContainText('"AWS" isn\'t in your CV');
  await expect(result.getByTestId('missing')).toContainText('Not in your CV: AWS');

  // Download works for the owner.
  const href = await result.getByRole('link', { name: 'Download DOCX' }).getAttribute('href');
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('wordprocessingml');

  // AWS is missing: the user says in the chat that they have it, approves, and it's saved.
  // The search page stays mounted (hidden) behind the job page, so address the job page's chat.
  const jobChat = page.getByRole('region', { name: 'Chat about this job' });
  await jobChat.getByLabel('Message').fill('I have real experience with AWS: two years running our services on AWS at Acme');
  await jobChat.getByLabel('Message').press('Enter');

  const confirm = page.getByTestId('confirm-experience');
  await expect(confirm).toContainText('two years running our services on AWS at Acme');
  await confirm.getByRole('button', { name: 'Yes, it’s true' }).click();
  await expect(page.getByText('Saved: AWS')).toBeVisible();
  await expect(jobChat.getByTestId('assistant-message').last()).toContainText('Saved');
});

test("a tailored CV can't be downloaded by someone else", async ({ request }) => {
  const response = await request.get('/api/tailored-cvs/not-a-real-id/docx');
  expect(response.status()).toBe(401);
});
