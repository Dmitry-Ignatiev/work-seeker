import { RecoveryResetForm } from '@/components/auth/recovery-reset-form';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">
          Use the recovery code you saved when you created your account.
        </p>
      </div>
      <RecoveryResetForm />
    </main>
  );
}
