import { ComingSoon } from '@/components/coming-soon';

export const metadata = { title: 'Welcome' };

export default function OnboardingPage() {
  return <ComingSoon title="Welcome" phase={1} />;
}
