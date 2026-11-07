import type { Job, SourceAdapter } from '../types';

/**
 * Offline job listings for E2E tests (E2E=1): the browser tests never contact real job sites.
 * Clearly fake companies and example.com links.
 */
const FIXTURE_JOBS: Job[] = [
  {
    id: 'jsearch:fixture-1',
    source: 'jsearch',
    title: 'Senior Backend Engineer (Node.js)',
    company: 'Acme Robotics (demo)',
    location: 'Tel Aviv, Israel',
    remote: false,
    tags: ['Full-time'],
    url: 'https://example.com/jobs/acme-backend',
    postedAt: new Date().toISOString(),
    description: 'Build backend services in Node.js and TypeScript on AWS. 5+ years of backend experience. PostgreSQL, Docker.',
  },
  {
    id: 'jsearch:fixture-2',
    source: 'jsearch',
    title: 'Backend Developer, Go',
    company: 'Globex Security (demo)',
    location: 'Herzliya, Israel',
    remote: false,
    tags: [],
    url: 'https://example.com/jobs/globex-go',
    description: 'Backend developer for a cyber security platform. Go, Kubernetes, gRPC.',
  },
  {
    id: 'jsearch:fixture-3',
    source: 'jsearch',
    title: 'Platform Engineer',
    company: 'Initech Cloud (demo)',
    location: 'Remote',
    remote: true,
    tags: [],
    url: 'https://example.com/jobs/initech-platform',
    description: 'Own our backend platform and CI/CD. Terraform, AWS, Kubernetes.',
  },
];

export const fixtureJobs: SourceAdapter = {
  name: 'jsearch',
  label: 'Demo listings',
  enabled: () => true,
  search: async () => FIXTURE_JOBS,
};
