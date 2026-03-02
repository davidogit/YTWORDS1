/**
 * dictionaryLookup.ts — Look up a word's definition, IPA, and part of speech.
 *
 * Primary:  Free Dictionary API (dictionaryapi.dev) — no key needed
 * Fallback: Wiktionary REST API — no key needed
 * Optional: Wordnik (requires free API key)
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { withRetry, isRetryableNetworkError } from '../utils/retry.js';
import type { DictionaryResult } from '../types/index.js';

const log = moduleLogger('dictionary');

// ── Primary: dictionaryapi.dev ─────────────────────────────────────────────

interface DictApiPhonetic {
  text?: string;
  audio?: string;
}

interface DictApiMeaning {
  partOfSpeech: string;
  definitions: Array<{ definition: string; example?: string }>;
}

interface DictApiResponse {
  word: string;
  phonetics: DictApiPhonetic[];
  meanings: DictApiMeaning[];
  origin?: string;
}

async function lookupFreeDictionary(word: string): Promise<DictionaryResult | null> {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;

  try {
    const resp = await fetch(url);

    // 404 means word not found — not an error worth retrying
    if (resp.status === 404) {
      log.debug({ word }, 'Not found in dictionaryapi.dev');
      return { word, exists: false };
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = (await resp.json()) as DictApiResponse[];
    const entry = data[0];
    if (!entry) return { word, exists: false };

    // Extract IPA: prefer phonetics with text, skip empty entries
    const phonetic = entry.phonetics.find((p) => p.text) ?? entry.phonetics[0];
    const ipa = phonetic?.text ?? undefined;
    const audioUrl = entry.phonetics.find((p) => p.audio)?.audio ?? undefined;

    // Extract the first meaningful definition (prefer short ones)
    const firstMeaning = entry.meanings[0];
    const definition = firstMeaning?.definitions[0]?.definition;
    const partOfSpeech = firstMeaning?.partOfSpeech;

    return {
      word: entry.word,
      exists: true,
      ipa,
      definition,
      partOfSpeech,
      origin: entry.origin,
      audioUrl,
    };
  } catch (err) {
    log.warn({ word, error: (err as Error).message }, 'dictionaryapi.dev lookup failed');
    return null; // Signal to try fallback
  }
}

// ── Fallback: Wiktionary REST API ──────────────────────────────────────────

async function lookupWiktionary(word: string): Promise<DictionaryResult | null> {
  // Wiktionary REST API: https://en.wiktionary.org/api/rest_v1/
  const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`;

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'yt-shorts-auto/1.0 (educational project)' },
    });

    if (resp.status === 404) {
      return { word, exists: false };
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = (await resp.json()) as any;
    const enSection = data?.en; // English language section

    if (!enSection || enSection.length === 0) {
      return { word, exists: false };
    }

    const firstEntry = enSection[0];
    const partOfSpeech = firstEntry.partOfSpeech ?? undefined;

    // Definitions are in HTML; strip tags for plain text
    const rawDef = firstEntry.definitions?.[0]?.definition ?? '';
    const definition = rawDef.replace(/<[^>]*>/g, '').trim();

    // IPA extraction from Wiktionary is tricky — it's in the HTML parse
    // For production, you'd parse the full page HTML for IPA
    // Here we return without IPA and let the pipeline continue
    return {
      word,
      exists: !!definition,
      definition: definition || undefined,
      partOfSpeech,
    };
  } catch (err) {
    log.warn({ word, error: (err as Error).message }, 'Wiktionary lookup failed');
    return null;
  }
}

// ── Optional: Wordnik (better IPA, needs API key) ──────────────────────────

async function lookupWordnik(word: string): Promise<Partial<DictionaryResult> | null> {
  const apiKey = config.dictionary.wordnikApiKey;
  if (!apiKey) return null;

  try {
    // Fetch definitions
    const defUrl = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}/definitions` +
      `?limit=1&sourceDictionaries=all&api_key=${apiKey}`;
    const defResp = await fetch(defUrl);
    const defData = defResp.ok ? ((await defResp.json()) as any[]) : [];

    // Fetch pronunciations
    const pronUrl = `https://api.wordnik.com/v4/word.json/${encodeURIComponent(word)}/pronunciations` +
      `?limit=1&api_key=${apiKey}`;
    const pronResp = await fetch(pronUrl);
    const pronData = pronResp.ok ? ((await pronResp.json()) as any[]) : [];

    return {
      definition: defData[0]?.text?.replace(/<[^>]*>/g, ''),
      ipa: pronData[0]?.raw,
      partOfSpeech: defData[0]?.partOfSpeech,
    };
  } catch {
    return null;
  }
}

// ── Main Lookup (cascading) ────────────────────────────────────────────────

/**
 * Look up a word using cascading sources.
 * Returns a DictionaryResult with the best available data.
 */
export async function lookupWord(word: string): Promise<DictionaryResult> {
  log.info({ word }, 'Looking up word');

  // 1. Try dictionaryapi.dev (best free source)
  const primary = await withRetry(
    () => lookupFreeDictionary(word),
    `dictionary:${word}`,
    { maxAttempts: 2, retryOn: isRetryableNetworkError }
  );

  if (primary?.exists && primary.definition) {
    // Supplement with Wordnik IPA if missing
    if (!primary.ipa) {
      const wordnik = await lookupWordnik(word);
      if (wordnik?.ipa) primary.ipa = wordnik.ipa;
    }
    log.info({ word, ipa: primary.ipa, hasDefinition: true }, 'Lookup success (primary)');
    return primary;
  }

  // 2. Try Wiktionary fallback
  const wiktionary = await lookupWiktionary(word);
  if (wiktionary?.exists && wiktionary.definition) {
    // Try Wordnik for IPA
    const wordnik = await lookupWordnik(word);
    if (wordnik?.ipa) wiktionary.ipa = wordnik.ipa;
    log.info({ word, hasDefinition: true }, 'Lookup success (Wiktionary)');
    return wiktionary;
  }

  // 3. Word doesn't exist in any source
  log.warn({ word }, 'Word not found in any dictionary source');
  return { word, exists: false };
}
