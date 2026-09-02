import { describe, expect, it } from 'vitest';
import { PROVIDER_META, type DemoProviderId } from '@/lib/demo';

describe('demo', () => {
  it('defines metadata for all demo providers', () => {
    const ids: DemoProviderId[] = ['rules', 'local', 'groq'];
    for (const id of ids) {
      const meta = PROVIDER_META[id];
      expect(meta).toBeDefined();
      expect(typeof meta.label).toBe('string');
      expect(typeof meta.sublabel).toBe('string');
      expect(typeof meta.hosted).toBe('boolean');
    }
    expect(PROVIDER_META.rules.hosted).toBe(false);
    expect(PROVIDER_META.local.hosted).toBe(false);
    expect(PROVIDER_META.groq.hosted).toBe(true);
  });
});
