import type { EnterpriseHookInput } from '../normalized-event.js';
import { claudeEnterpriseGuardCodec } from './claude.js';

const CODECS = new Map([[claudeEnterpriseGuardCodec.id, claudeEnterpriseGuardCodec]]);

export function hasEnterpriseGuardInputCodec(platformId: string): boolean {
  return CODECS.has(platformId);
}

export function parseEnterpriseGuardInput(platformId: string, source: string): EnterpriseHookInput {
  const codec = CODECS.get(platformId);
  if (!codec) {
    throw new Error(`Enterprise Guard input codec is unavailable for platform: ${platformId}`);
  }
  return codec.parse(source);
}
