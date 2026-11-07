import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('save a recovery code at sign-up, then use it to reset a forgotten password', async ({ page }) => {
  const email = `reset-${Date.now()}@example.test`;

  // Sign up: the app offers a recovery code before the chat.
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'No account? Create one' }).click();
  await page.getByLabel('Name').fill('Reset User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('old-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/recovery-code\?welcome=1$/);
  await page.getByRole('button', { name: 'Create my recovery code' }).click();
  const code = await page.getByTestId('recovery-code').innerText();
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  await page.getByRole('link', { name: 'I saved it, continue' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);

  // Forgot password: a wrong code changes nothing and says so without revealing anything.
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  const fill = async (recoveryCode: string, password: string) => {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Recovery code').fill(recoveryCode);
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByLabel('Repeat new password').fill(password);
    await page.getByRole('button', { name: 'Change password' }).click();
  };
  await fill('AAAA-BBBB-CCCC-DDDD', 'wrong-path-password');
  await expect(page.getByText("That email and recovery code don't match.", { exact: false })).toBeVisible();

  // The right code (typed in lower case, without dashes) resets it and gives a new code.
  await fill(code.toLowerCase().replaceAll('-', ''), 'new-password-456');
  await expect(page.getByTestId('reset-done')).toBeVisible();
  const newCode = await page.getByTestId('recovery-code').innerText();
  expect(newCode).not.toBe(code);

  // Old password refused, new one works.
  await signIn(page, email, 'old-password-123');
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await signIn(page, email, 'new-password-456');
  await expect(page).toHaveURL(/\/assistant$/);
  await page.getByRole('button', { name: 'Sign out' }).click();

  // The used code is burned.
  await page.goto('/forgot-password');
  await fill(code, 'another-password-789');
  await expect(page.getByText("That email and recovery code don't match.", { exact: false })).toBeVisible();
});

test('an unknown email gets the same answer as a wrong code', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(`nobody-${Date.now()}@example.test`);
  await page.getByLabel('Recovery code').fill('AAAA-BBBB-CCCC-DDDD');
  await page.getByLabel('New password', { exact: true }).fill('whatever-password-1');
  await page.getByLabel('Repeat new password').fill('whatever-password-1');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText("That email and recovery code don't match.", { exact: false })).toBeVisible();
});

test('a bad or expired admin link says so and points to the recovery code', async ({ page }) => {
  await page.goto(`/api/auth/reset-password/not-a-real-token?callbackURL=${encodeURIComponent('/reset-password')}`);
  await expect(page.getByTestId('reset-invalid')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reset with my recovery code' })).toBeVisible();
});
