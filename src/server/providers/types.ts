import { z } from 'zod';

export interface WideInput { question: string; scope: string; topics: string[]; maxSearches: number }
export interface DeepInput {
  question: string; scope: string;
  insight: { title: string; body: string } | null;
  /** Only excerpts a researcher approved. Never transcripts or participant records. */
  notes: { id: string; sourceId: string; kind: string; text: string; targetId: string | null }[];
  model: unknown; // structural map of the pinned revision
  revisionId: string;
}
export interface ProviderContext { signal: AbortSignal; attempt: number }

export interface ResearchProvider {
  id: string;
  label: string;
  /** Fixture and test providers must be visibly labelled wherever their output appears. */
  synthetic: boolean;
  runWide(input: WideInput, ctx: ProviderContext): Promise<unknown>;
  runDeep(input: DeepInput, ctx: ProviderContext): Promise<unknown>;
}

const citation = z.object({
  url: z.string().url().max(2000), title: z.string().max(500), retrievedAt: z.string().max(40),
  excerpt: z.string().min(1).max(1200), covers: z.string().max(2000).default(''), fallsShort: z.string().max(2000).default(''),
});
/** What a provider must return. Anything else fails the run with a visible error. */
export const wideOutputSchema = z.object({
  summary: z.string().min(1).max(6000),
  coverage: z.string().min(1).max(6000), // market / practice coverage against the observed workflow
  citations: z.array(citation).min(1).max(40),
  followUpQuestions: z.array(z.string().min(1).max(500)).min(1).max(12),
  gapsToCheckWithParticipants: z.array(z.string().max(500)).max(12).default([]),
  candidates: z.unknown(),
});
export const deepOutputSchema = z.object({
  summary: z.string().min(1).max(6000),
  followUpQuestions: z.array(z.string().min(1).max(500)).max(12).default([]),
  candidates: z.unknown(),
});
export type WideOutput = z.infer<typeof wideOutputSchema>;
export type DeepOutput = z.infer<typeof deepOutputSchema>;
