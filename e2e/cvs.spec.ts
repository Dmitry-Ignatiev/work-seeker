import { expect, test } from '@playwright/test';
import { signUp } from './helpers';
import { makePdf, SAMPLE_CV_LINES } from '../tests/support/make-pdf';

test('upload a CV, see its skills, then delete it', async ({ page }) => {
  await signUp(page, 'CV Tester', 'cv');
  await page.goto('/cvs');

  const input = page.getByLabel('Upload your CV (PDF)');
  await expect(input).toBeEnabled(); // enabled once hydrated
  await input.setInputFiles({
    name: 'Dana Levi CV.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(makePdf([SAMPLE_CV_LINES])),
  });

  await expect(page).toHaveURL(/\/cvs$/);
  const card = page.getByRole('listitem').filter({ hasText: 'Dana Levi CV' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Default')).toBeVisible();
  const skills = card.getByRole('list', { name: 'Skills found' });
  for (const skill of ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker']) {
    await expect(skills.getByText(skill, { exact: true })).toBeVisible();
  }

  await card.getByRole('button', { name: 'Delete' }).click();
  await card.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No CVs yet.')).toBeVisible();
});

test('a file that is not a PDF is rejected with a clear message', async ({ page }) => {
  await signUp(page, 'CV Tester', 'cv');
  await page.goto('/cvs');
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
