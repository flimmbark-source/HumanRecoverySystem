// The research provider (src/server/providers/anthropic.ts) is not in the device build: research jobs stay on a
// server. Splitting field notes with Claude is: the researcher saves their own API key on the phone, and it is
// sent with each split request they make. Nothing else in the app reaches the network.
import Anthropic from '@anthropic-ai/sdk';
import type { ResearchProvider } from '../server/providers/types';
import { explainClaudeError, splitWithClaude, type SplitInput, type SplitOutput } from '../shared/fieldnotes-ai';

const unavailable = async (): Promise<never> => { throw new Error('Claude research is not available in the app on this device.'); };

export const anthropicProvider: ResearchProvider = { id: 'anthropic', label: 'Claude (not available on this device)', synthetic: false, runWide: unavailable, runDeep: unavailable };

export async function splitFieldNotes(input: SplitInput, opts: { apiKey?: string } = {}): Promise<SplitOutput> {
  if (!opts.apiKey) throw new Error('Add your Claude API key in Project settings first.');
  // The page and this worker are the user's own app on their own phone, with their own key.
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try { return await splitWithClaude(client, input); } catch (e) { throw explainClaudeError(e, Anthropic); }
}
