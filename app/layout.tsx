import type { Metadata } from 'next';
import { Geist_Mono, Heebo, Inter, Rubik } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
// Inter has no Hebrew glyphs: Heebo fills them in. Rubik (headings) covers both scripts.
const heebo = Heebo({ variable: '--font-heebo', subsets: ['hebrew'] });
const rubik = Rubik({ variable: '--font-rubik', subsets: ['latin', 'hebrew'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Work Seeker', template: '%s · Work Seeker' },
  description: 'Find jobs that fit you, see why they fit, and track your applications.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${heebo.variable} ${rubik.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
