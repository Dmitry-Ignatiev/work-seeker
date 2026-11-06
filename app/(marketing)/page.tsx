import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

const STEPS = [
  { title: 'Paste a job link', body: 'Or the description text. We pull out every requirement, quoted from the posting.' },
  { title: 'See how you fit', body: 'Rule-based checks plus an AI judgment, each one backed by evidence from your profile.' },
  { title: 'Pick the right CV', body: 'We rank your CVs for the job and suggest honest, specific improvements.' },
  { title: 'Track it', body: 'Save the job and follow it through applications, interviews and follow-ups.' },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-12 px-4 py-16">
      <section className="flex flex-col gap-5">
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          Find jobs that fit you, and know why.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Work Seeker compares real job requirements with your real experience. It never invents skills, jobs or
          experience.
        </p>
        <div className="flex gap-3">
          <Link href="/sign-in" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
        </div>
      </section>
      <ol className="grid gap-4 sm:grid-cols-2">
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
