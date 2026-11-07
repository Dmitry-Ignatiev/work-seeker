import { expect, type Page } from '@playwright/test';

export const E2E_PASSWORD = 'e2e-password-123';

/** Creates an account and lands in the chat, skipping the recovery-code step. Returns the email. */
export async function signUp(page: Page, name: string, prefix = 'e2e'): Promise<string> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'No account? Create one' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/recovery-code\?welcome=1$/);
  await page.getByRole('link', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  return email;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
