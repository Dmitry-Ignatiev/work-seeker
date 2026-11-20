import { expect, test } from '@playwright/test';
import { signUp } from './helpers';
import { makePdf, SAMPLE_CV_LINES } from '../tests/support/make-pdf';

// AI_MOCK=1 + E2E=1: demo listings, a scripted agent, and offline tailoring that proposes one truthful edit
// (Node.js, which the CV has) and one the guard must refuse (AWS, which it doesn't).

test('tailor a CV for a job: upload in chat, see what changed and what was refused, confirm a skill, download', async ({ page }) => {
  test.slow(); // the dev server compiles each download route (with the PDF library) on its first request
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
  const upload = needed.getByLabel('Upload your CV (PDF or Word)');
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

  // Download works for the owner, as DOCX or PDF.
  const downloads = result.getByRole('group', { name: 'Download tailored CV' });
  for (const [name, type] of [['DOCX', 'wordprocessingml'], ['PDF', 'application/pdf']]) {
    const href = await downloads.getByRole('link', { name }).getAttribute('href');
    const download = await page.request.get(href!);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toContain(type);
  }

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

test('with a CV on file, "Tailor my CV" asks which CV to tailor before starting', async ({ page }) => {
  test.slow();
  await signUp(page, 'Chooser Tester', 'choose');
  await page.goto('/cvs');
  await page
    .getByLabel('Upload your CV (PDF or Word)')
    .setInputFiles({ name: 'Dana Levi CV.pdf', mimeType: 'application/pdf', buffer: Buffer.from(makePdf([SAMPLE_CV_LINES])) });
  await expect(page.getByText('CV uploaded.')).toBeVisible();

  await page.goto('/assistant');
  const message = page.getByLabel('Message');
  await message.fill('Senior backend jobs in Tel Aviv');
  await message.press('Enter');
  const card = page.getByLabel('Jobs found').getByRole('article', { name: 'Senior Backend Engineer (Node.js)' });
  await card.getByRole('link', { name: 'Tailor my CV' }).click();

  // Nothing is tailored until a CV is picked.
  const choose = page.getByTestId('choose-cv');
  await expect(choose).toContainText('Which CV should I tailor for Senior Backend Engineer (Node.js)?');
  // (The search page stays mounted, hidden, behind the job page: look in the job page's chat only.)
  await expect(page.getByRole('region', { name: 'Chat about this job' }).getByTestId('user-message')).toHaveCount(0);
  await expect(choose.getByRole('button', { name: 'Upload a different CV' })).toBeVisible();
  // The match with the picked CV is counted by code and shown above the requirements.
  await expect(page.getByTestId('job-match')).toContainText(/Your CV matches \d+ of \d+ requirements/);

  await choose.getByLabel('Your CVs').getByRole('button', { name: /Dana Levi CV/ }).click();
  const result = page.getByRole('region', { name: 'Tailored CV' });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText('from your CV “Dana Levi CV”');
});

test("a tailored CV can't be downloaded by someone else", async ({ request }) => {
  for (const format of ['docx', 'pdf']) {
    const response = await request.get(`/api/tailored-cvs/not-a-real-id/${format}`);
    expect(response.status()).toBe(401);
  }
});
