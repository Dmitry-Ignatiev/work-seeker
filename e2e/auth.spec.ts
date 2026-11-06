import { expect, test } from '@playwright/test';

test('signed-out visitors are sent to sign-in, keeping where they were going', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fjobs$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Work Seeker' })).toBeVisible();
});

test('a new user can sign up, lands on onboarding, and can sign out', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'No account? Create one' }).click();
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId('user-name')).toHaveText('E2E User');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Jobs' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/jobs');
  await expect(page).toHaveURL(/\/sign-in/);
});
