import { expect, test } from '@playwright/test';
import { signUp } from './helpers';
import { makePdf, SAMPLE_CV_LINES } from '../tests/support/make-pdf';

test('upload a CV, see its skills, then delete it', async ({ page }) => {
  test.slow(); // the dev server compiles each download route (with the PDF library) on its first request
  await signUp(page, 'CV Tester', 'cv');
  await page.goto('/my-cvs');

  const input = page.getByLabel('Upload your CV (PDF)');
  await expect(input).toBeEnabled(); // enabled once hydrated
  await input.setInputFiles({
    name: 'Dana Levi CV.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(makePdf([SAMPLE_CV_LINES])),
  });

  await expect(page).toHaveURL(/\/my-cvs$/);
  const card = page.getByRole('listitem').filter({ hasText: 'Dana Levi CV' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Default')).toBeVisible();
  const skills = card.getByRole('list', { name: 'Skills found' });
  for (const skill of ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker']) {
    await expect(skills.getByText(skill, { exact: true })).toBeVisible();
  }

  // The CV downloads as DOCX (converted) or PDF (rebuilt), with its own text.
  const downloads = card.getByRole('group', { name: 'Download Dana Levi CV' });
  for (const [name, type, magic] of [['DOCX', 'wordprocessingml', 'PK'], ['PDF', 'application/pdf', '%PDF-']]) {
    const href = await downloads.getByRole('link', { name }).getAttribute('href');
    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toContain(type);
    expect(file.headers()['content-disposition']).toContain('Dana Levi CV');
    expect((await file.body()).subarray(0, magic.length).toString()).toBe(magic);
  }

  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No CVs yet.')).toBeVisible();
});

test('a file that is not a PDF is rejected with a clear message', async ({ page }) => {
  await signUp(page, 'CV Tester', 'cv');
  await page.goto('/my-cvs');
  const input = page.getByLabel('Upload your CV (PDF)');
  await expect(input).toBeEnabled(); // enabled once hydrated
  await input.setInputFiles({
    name: 'cv.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('this is plain text pretending to be a PDF'),
  });
  await expect(page.getByText('Only PDF files are supported.')).toBeVisible();
  await expect(page.getByText('No CVs yet.')).toBeVisible();
});

test("an uploaded CV can't be downloaded without signing in, or by someone else", async ({ page, request }) => {
  for (const format of ['docx', 'pdf']) expect((await request.get(`/api/cv-uploads/not-a-real-id/${format}`)).status()).toBe(401);
  await signUp(page, 'Other User', 'cv');
  for (const format of ['docx', 'pdf']) expect((await page.request.get(`/api/cv-uploads/not-a-real-id/${format}`)).status()).toBe(404);
});
