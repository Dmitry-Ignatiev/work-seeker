import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('signed-out visitors are sent to sign-in, keeping where they were going', async ({ page }) => {
  await page.goto('/assistant');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fassistant$/);
  await expect(page.getByRole('heading', { name: 'Sign in to Work Seeker' })).toBeVisible();
});

test('a new user can sign up, lands in the chat, and can sign out', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;

  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'No account? Create one' }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/recovery-code\?welcome=1$/);
  await page.getByRole('link', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByTestId('user-name')).toHaveText('E2E User');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Chat' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/assistant');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('a visitor who is already signed in skips the sign-in page', async ({ page }) => {
  await signUp(page, 'Returning User', 'back');
  // From the homepage's "Sign in" / "Start chatting" buttons: straight to the chat.
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/assistant$/);
  // Where they were heading is kept; another site is not.
  await page.goto('/sign-in?next=%2Fmy-cvs');
  await expect(page).toHaveURL(/\/my-cvs$/);
  await page.goto('/sign-in?next=%2F%2Fevil.example');
  await expect(page).toHaveURL(/\/assistant$/);
});
