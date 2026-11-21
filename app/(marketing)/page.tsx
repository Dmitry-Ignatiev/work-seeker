import { ArrowRightIcon, CheckIcon, DownloadIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo-mark';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SOURCES = ['Greenhouse', 'Lever', 'Ashby', 'Remote OK', 'Arbeitnow'];

const STEPS = [
  {
    title: 'Describe the job you want',
    body: 'Backend, QA, DevOps, data, product. In English or Hebrew, the way you’d tell a friend.',
  },
  {
    title: 'Pick from real openings',
    body: 'Every job links back to its original posting, and you see which sources were searched.',
  },
  {
    title: 'Download a tailored CV',
    body: 'The job’s keywords are worked into your CV where your experience supports them. Download it as DOCX or PDF.',
  },
];

const TRUTH_RULES = [
  'Companies, titles, dates and education are copied from your CV, never changed.',
  'A skill is added only if your CV already shows it, or you confirm it yourself.',
  'No new numbers or metrics, ever.',
  'What’s missing is listed for you to decide, not quietly added.',
];

const startButton = cn(buttonVariants({ size: 'lg' }), 'h-12 gap-2 rounded-xl px-5 text-base');

/** Labelled sample of a chat result: what a search and a tailored CV look like. */
function ExamplePreview() {
  return (
    <div aria-label="Example of a chat result" className="flex flex-col gap-3.5 rounded-2xl border bg-background p-5">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Example</p>
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2.5 text-[15px] text-background">
        Senior backend jobs in Tel Aviv, Node or Go
      </p>
      <p className="text-[15px]">I found 8 roles across 3 sources. The closest match:</p>
      <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Senior Backend Engineer, Node.js</p>
            <p className="text-sm text-muted-foreground">Example company · Tel Aviv · Hybrid</p>
          </div>
          <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium whitespace-nowrap text-secondary-foreground">
            Company careers page
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">
            Job keywords in your CV: <strong>7 → 10</strong> of 12
          </p>
          <div className="flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="w-[58%] bg-accent-foreground" />
            <div className="w-[25%] bg-blue-300" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 font-semibold text-primary-foreground">
            <DownloadIcon className="size-4" aria-hidden /> Tailored CV.docx
          </span>
          <span className="inline-flex items-center rounded-lg bg-amber-100 px-3 py-2 text-amber-900">
            Not added: Kubernetes (not in your CV)
          </span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:gap-7">
          <Link href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LogoMark className="size-5" />
            </span>
            Work Seeker
          </Link>
          <nav aria-label="Sections" className="hidden gap-5 text-[15px] text-muted-foreground sm:flex">
            <a href="#how" className="py-2 hover:text-foreground">
              How it works
            </a>
            <a href="#truth" className="py-2 hover:text-foreground">
              Truth check
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {/* On phones only the main button shows, so the header stays on one row; the sign-up page links to sign-in. */}
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ variant: 'ghost' }), 'hidden h-11 px-3.5 text-[15px] sm:inline-flex')}
            >
              Sign in
            </Link>
            <Link href="/sign-up" className={cn(buttonVariants(), 'h-11 rounded-xl px-4 text-[15px]')}>
              Sign up free
            </Link>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <section className="border-b bg-card">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 md:grid-cols-2 md:py-20">
            <div className="flex flex-col gap-6">
              <p className="self-start rounded-full border border-blue-200 bg-accent px-3 py-1 text-sm font-semibold text-accent-foreground">
                For high-tech job seekers in Israel
              </p>
              <h1 className="font-heading text-4xl leading-[1.05] font-bold tracking-tight sm:text-5xl lg:text-[56px]">
                Your high-tech job search, in one chat.
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                Describe the role you want in English or Hebrew. Work Seeker finds real openings, then tailors your CV to each one
                using only experience you actually have.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/sign-up" className={startButton}>
                  Start chatting <ArrowRightIcon aria-hidden />
                </Link>
                <a
                  href="#how"
                  className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-12 rounded-xl px-5 text-base')}
                >
                  See how it works
                </a>
              </div>
              <p className="text-sm text-muted-foreground">Your CV file is never stored, only its text.</p>
            </div>
            <ExamplePreview />
          </div>
        </section>

        <section
          aria-label="Job sources"
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-4 px-4 py-10"
        >
          <p className="text-[15px] font-semibold text-muted-foreground">Real openings from</p>
          <ul className="flex flex-wrap gap-2.5">
            {SOURCES.map(source => (
              <li key={source} className="rounded-lg border bg-card px-3.5 py-2 text-[15px] font-semibold">
                {source}
              </li>
            ))}
          </ul>
          <p className="min-w-60 flex-1 text-sm text-muted-foreground">
            Found it on LinkedIn or Indeed? Paste the description and it works the same.
          </p>
        </section>

        <section id="how" className="mx-auto flex w-full max-w-6xl scroll-mt-4 flex-col gap-8 px-4 pt-6 pb-20">
          <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">How it works</h2>
          <ol className="grid gap-5 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-2xl border bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent font-heading text-lg font-bold text-accent-foreground">
                  {i + 1}
                </span>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="truth" className="scroll-mt-4 bg-slate-900 text-slate-200">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-12 px-4 py-20 md:grid-cols-2">
            <div className="flex flex-col gap-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-blue-300">
                <ShieldCheckIcon className="size-[18px]" aria-hidden /> The truth check
              </p>
              <h2 className="font-heading text-4xl leading-tight font-semibold text-white">It never invents experience.</h2>
              <p className="text-lg text-slate-300">
                Every change to your CV is checked by code, not just by the AI. If it can’t be verified, it isn’t added.
              </p>
              <ul className="mt-2 flex flex-col gap-3.5">
                {TRUTH_RULES.map(rule => (
                  <li key={rule} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 size-5 shrink-0 text-blue-300" strokeWidth={2.2} aria-hidden />
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
            <figure className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800 p-6">
              <figcaption className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                One rewritten bullet
              </figcaption>
              <p className="text-[15px] text-slate-400 line-through">
                Developed a RAG pipeline using document chunking, embeddings, vector indexing, and semantic retrieval.
              </p>
              <p className="text-white">
                Developed a RAG pipeline with <mark className="rounded bg-blue-700 px-1 text-white">vector search</mark> over
                Qdrant, using document chunking, embeddings and semantic retrieval.
              </p>
              <div className="h-px bg-slate-700" />
              <p className="flex items-start gap-2.5 text-[15px] text-amber-200">
                <TriangleAlertIcon className="mt-0.5 size-[18px] shrink-0" aria-hidden />
                “Deployed on AWS” was not added: AWS isn’t in your CV. Confirm it if it’s true.
              </p>
            </figure>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 py-20 text-center">
          <h2 className="font-heading text-3xl font-semibold sm:text-4xl">Find your next role today.</h2>
          <p className="max-w-xl text-lg text-muted-foreground">
            Start with one sentence about the job you want. Upload your CV when you’re ready to tailor it.
          </p>
          <Link href="/sign-up" className={startButton}>
            Start chatting <ArrowRightIcon aria-hidden />
          </Link>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <span>Work Seeker</span>
          <span className="sm:ml-auto">LinkedIn, Indeed and Glassdoor are never scraped.</span>
        </div>
      </footer>
    </div>
  );
}
