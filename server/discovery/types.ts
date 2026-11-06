export type JobSource = 'remotive' | 'arbeitnow' | 'remoteok' | 'adzuna' | 'jsearch';

export interface Job {
  /** Globally unique id: `<source>:<native id>` */
  id: string;
  source: JobSource;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salary?: string;
  tags: string[];
  url: string;
  postedAt?: string;
  /** Plain-text description (HTML stripped). */
  description: string;
}

export interface SearchParams {
  query: string;
  location?: string;
  remoteOnly?: boolean;
  /** Adzuna country code, e.g. "us", "gb", "de". */
  country?: string;
}

export interface SourceAdapter {
  name: JobSource;
  /** Human label shown in the UI. */
  label: string;
  enabled: () => boolean;
  search: (params: SearchParams) => Promise<Job[]>;
}
