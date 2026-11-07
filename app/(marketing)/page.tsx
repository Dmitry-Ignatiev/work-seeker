import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

const STEPS = [
  { title: 'Describe the job you want', body: 'Backend, QA, DevOps, data, product… in English or Hebrew, like you’d tell a friend.' },
  {
    title: 'Get real openings',
    body: 'From GotFriends, careers pages of Israeli tech companies, and remote job boards. Each links to the source.',
  },
  { title: 'Tailor your CV, truthfully', body: 'Coming next: the job’s keywords woven into your CV, only where your experience backs them.' },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-12 px-4 py-16">
      <section className="flex flex-col gap-5">
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">Your high-tech job search, in one chat.</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Work Seeker finds real high-tech jobs in Israel and remote, and never invents skills, jobs or experience.
        </p>
        <div className="flex gap-3">
          <Link href="/sign-in" className={buttonVariants({ size: 'lg' })}>
            Start chatting
          </Link>
        </div>
      </section>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-xl border p-5">
            <p className="text-sm text-muted-foreground">Step {i + 1}</p>
            <h2 className="mt-1 font-medium">{step.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
