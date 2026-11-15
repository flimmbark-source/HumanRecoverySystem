import { config } from '../config';
import { anthropicProvider } from './anthropic';
import { fixtureProvider } from './fixture';
import type { ResearchProvider } from './types';

export interface ProviderStatus { id: string; label: string; synthetic: boolean; available: boolean; reason: string }

export function getProvider(): ResearchProvider | null {
  if (config.provider === 'fixture') return fixtureProvider;
  if (config.provider === 'anthropic') return anthropicProvider;
  return null;
}
export function providerStatus(): ProviderStatus {
  const p = getProvider();
  if (!p) return { id: 'none', label: 'No research provider configured', synthetic: false, available: false, reason: 'Agent jobs are off. Capture, manual review and candidate import still work.' };
  if (p.id === 'anthropic' && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return { id: p.id, label: p.label, synthetic: false, available: false, reason: 'The provider is selected but no credentials are set (ANTHROPIC_API_KEY).' };
  return { id: p.id, label: p.label, synthetic: p.synthetic, available: true, reason: '' };
}
