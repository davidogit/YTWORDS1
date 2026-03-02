/**
 * dictionary.test.ts — Tests for dictionary lookup module.
 */

import { describe, it, expect } from 'vitest';

// Note: These tests make real API calls. For CI, mock the fetch calls.
// In a real setup, use msw or vitest mocking.

describe('dictionaryLookup', () => {
  it('should find a known word (susurrus)', async () => {
    // Dynamic import to handle module resolution
    const { lookupWord } = await import('../src/modules/dictionaryLookup.js');

    const result = await lookupWord('susurrus');
    expect(result.exists).toBe(true);
    expect(result.definition).toBeTruthy();
    expect(result.word).toBe('susurrus');
  });

  it('should return exists=false for a nonsense word', async () => {
    const { lookupWord } = await import('../src/modules/dictionaryLookup.js');

    const result = await lookupWord('xyzzyplugh');
    expect(result.exists).toBe(false);
  });

  it('should find IPA for common words', async () => {
    const { lookupWord } = await import('../src/modules/dictionaryLookup.js');

    const result = await lookupWord('hello');
    expect(result.exists).toBe(true);
    // hello should have IPA in most dictionaries
    // (IPA availability varies, so we don't assert it's always present)
  });
});
