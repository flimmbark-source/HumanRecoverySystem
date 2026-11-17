// The Claude provider (src/server/providers/anthropic.ts) is not in the device build: it would need an API key
// on the phone. The device configuration selects no provider, so nothing calls this.
import type { ResearchProvider } from '../server/providers/types';

const unavailable = async (): Promise<never> => { throw new Error('Claude research is not available in the app on this device.'); };

export const anthropicProvider: ResearchProvider = { id: 'anthropic', label: 'Claude (not available on this device)', synthetic: false, runWide: unavailable, runDeep: unavailable };
