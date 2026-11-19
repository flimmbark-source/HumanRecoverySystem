// The research provider (src/server/providers/anthropic.ts) is not in the device build: research jobs stay on a
// server. Splitting field notes with Claude is: the researcher saves their own API key on the phone, and it is
// sent with each split request they make. Nothing else in the app reaches the network.
import Anthropic from '@anthropic-ai/sdk';
import type { ResearchProvider } from '../server/providers/types';
import { explainClaudeError, splitFileWithClaude, splitWithClaude, type FileInput, type FileOutput, type SplitInput, type SplitOutput } from '../shared/fieldnotes-ai';

const unavailable = async (): Promise<never> => { throw new Error('Claude research is not available in the app on this device.'); };

export const anthropicProvider: ResearchProvider = { id: 'anthropic', label: 'Claude (not available on this device)', synthetic: false, runWide: unavailable, runDeep: unavailable };

// The page and this worker are the user's own app on their own phone, with their own key.
function client(apiKey?: string) {
  if (!apiKey) throw new Error('Add your Claude API key in Project settings first.');
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}
export async function splitFieldNotes(input: SplitInput, opts: { apiKey?: string } = {}): Promise<SplitOutput> {
  try { return await splitWithClaude(client(opts.apiKey), input); } catch (e) { throw explainClaudeError(e, Anthropic); }
}
export async function splitFileFieldNotes(input: FileInput, opts: { apiKey?: string } = {}): Promise<FileOutput> {
  try { return await splitFileWithClaude(client(opts.apiKey), input); } catch (e) { throw explainClaudeError(e, Anthropic); }
}
