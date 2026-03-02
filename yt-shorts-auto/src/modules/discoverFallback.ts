/**
 * discoverFallback.ts — Fallback word discovery when Reddit is unavailable.
 *
 * Sources:
 *   1. Random Word API (https://random-word-api.herokuapp.com)
 *   2. Wordnik Random Words (if API key is set)
 *   3. Curated "interesting words" list (built-in)
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { isDuplicate } from '../utils/db.js';
import { withRetry } from '../utils/retry.js';
import type { WordCandidate } from '../types/index.js';

const log = moduleLogger('discoverFallback');

// ── Curated interesting words — pre-vetted for "wow" factor ───────────────
// ~200 words organised by theme; shuffled at runtime for variety.

export const CURATED_WORDS: readonly string[] = [
  // ── Original classics ──────────────────────────────────────────────────
  'petrichor', 'susurrus', 'defenestration', 'sonder', 'ephemeral',
  'limerence', 'serendipity', 'mellifluous', 'phosphenes', 'vellichor',
  'ethereal', 'luminescence', 'quintessence', 'oblivion', 'lacuna',
  'sonorous', 'effervescent', 'iridescent', 'surreptitious', 'ebullience',
  'diaphanous', 'pulchritudinous', 'sesquipedalian', 'callipygian', 'chatoyant',
  'crepuscular', 'cynosure', 'denouement', 'frisson', 'halcyon',
  'ineffable', 'languor', 'numinous', 'opulent', 'plethora',
  'redolent', 'scintilla', 'sempiternal', 'tintinnabulation', 'umbra',
  'verisimilitude', 'wunderkind', 'zeitgeist', 'apricity', 'brontide',
  'clinomania', 'elysian', 'fernweh', 'gossamer', 'hiraeth',

  // ── Sounds, music & aesthetics ────────────────────────────────────────
  'melisma', 'cacophony', 'euphony', 'sibilance', 'cadenza',
  'vibrato', 'tremolo', 'arpeggio', 'nocturne', 'dulcet',
  'dulcimer', 'aubade', 'elegy', 'resonance', 'melancholy',

  // ── Silly, humorous & playful ─────────────────────────────────────────
  'absquatulate', 'flibbertigibbet', 'kerfuffle', 'brouhaha', 'hullabaloo',
  'discombobulate', 'flummox', 'bamboozle', 'lollygag', 'shenanigans',
  'balderdash', 'codswallop', 'flapdoodle', 'rigmarole', 'tomfoolery',

  // ── Character & personality ───────────────────────────────────────────
  'sycophant', 'obsequious', 'perspicacious', 'sagacious', 'loquacious',
  'magnanimous', 'munificent', 'bellicose', 'truculent', 'recalcitrant',
  'querulous', 'fastidious', 'mercurial', 'phlegmatic', 'sanguine',
  'lachrymose', 'lugubrious', 'sardonic', 'irascible', 'intrepid',

  // ── Intellectual & philosophical ──────────────────────────────────────
  'solipsism', 'onomatopoeia', 'circumlocution', 'tautology', 'quixotic',
  'sisyphean', 'equanimity', 'alacrity', 'acrimony', 'catharsis',
  'hubris', 'pathos', 'schadenfreude', 'weltanschauung', 'gestalt',
  'leitmotif', 'aphorism', 'hyperbole', 'synecdoche', 'episteme',

  // ── Nature, cosmos & colour ───────────────────────────────────────────
  'syzygy', 'penumbra', 'aphelion', 'perihelion', 'aurora',
  'bioluminescence', 'phosphorescence', 'coruscation', 'effulgence', 'maelstrom',
  'riparian', 'sylvan', 'vernal', 'cerulean', 'vermillion',
  'alabaster', 'obsidian', 'aureate', 'tenebrous', 'caliginous',

  // ── Emotions & inner life ─────────────────────────────────────────────
  'desiderium', 'sehnsucht', 'meraki', 'wanderlust', 'poignant',
  'elegiac', 'valediction', 'solace', 'reverie', 'rumination',
  'despondency', 'ambivalence', 'wistfulness', 'eudaimonia', 'apophenia',

  // ── Vivid & evocative ────────────────────────────────────────────────
  'labyrinthine', 'ostentatious', 'nefarious', 'insidious', 'tenacious',
  'voracious', 'ubiquitous', 'luminous', 'resplendent', 'felicitous',
  'propitious', 'auspicious', 'pernicious', 'deleterious', 'ignominious',
  'egregious', 'obstreperous', 'mendacious', 'perfidious', 'truculent',

  // ── Language & linguistics ────────────────────────────────────────────
  'neologism', 'portmanteau', 'palindrome', 'oxymoron', 'malapropism',
  'spoonerism', 'mondegreen', 'paraprosdokian', 'tmesis', 'eggcorn',

  // ── Wonderfully obscure real English ─────────────────────────────────
  'snollygoster', 'ultracrepidarian', 'mumpsimus', 'ninnyhammer',
  'blatherskite', 'skullduggery', 'muckraker', 'hobbledehoy', 'lickspittle',

  // ── Poetic & abstract ────────────────────────────────────────────────
  'simulacrum', 'palimpsest', 'archipelago', 'calliope', 'phantasmagoria',
  'labyrinth', 'silhouette', 'conundrum', 'enigma', 'pellucid',
  'crystalline', 'lustrous', 'translucent', 'diapason', 'incandescent',
];

/** Set version for O(1) curated-word lookups in the validator */
export const CURATED_WORDS_SET = new Set(CURATED_WORDS);

// ── Random Word API ────────────────────────────────────────────────────────

async function fetchRandomWords(count = 20): Promise<string[]> {
  try {
    const resp = await fetch(
      `https://random-word-api.herokuapp.com/word?number=${count}&length=7`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as string[];
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Random word API failed');
    return [];
  }
}

// ── Wordnik Random Words (optional, needs API key) ─────────────────────────

async function fetchWordnikRandom(count = 10): Promise<string[]> {
  const apiKey = config.dictionary.wordnikApiKey;
  if (!apiKey) return [];

  try {
    const url = `https://api.wordnik.com/v4/words.json/randomWords` +
      `?hasDictionaryDef=true&minCorpusCount=100&minLength=6&maxLength=18` +
      `&limit=${count}&api_key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as Array<{ word: string }>;
    return data.map((d) => d.word);
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Wordnik random failed');
    return [];
  }
}

// ── Main Fallback Discovery ────────────────────────────────────────────────

export async function discoverFromFallback(limit = 10): Promise<WordCandidate[]> {
  log.info('Using fallback word discovery');

  const allWords: string[] = [];

  // Try external APIs first
  const [randomWords, wordnikWords] = await Promise.all([
    withRetry(() => fetchRandomWords(30), 'random-word-api', { maxAttempts: 2 }),
    fetchWordnikRandom(15),
  ]);

  // Curated words come FIRST — they're pre-vetted as interesting.
  // API words follow as supplementary options.
  const shuffled = [...CURATED_WORDS].sort(() => Math.random() - 0.5);
  allWords.push(...shuffled);
  allWords.push(...randomWords, ...wordnikWords);

  // Filter: length, not duplicate
  const candidates: WordCandidate[] = [];
  const seen = new Set<string>();

  for (const raw of allWords) {
    const word = raw.toLowerCase().trim();
    if (seen.has(word)) continue;
    seen.add(word);
    if (word.length < config.content.minWordLength) continue;
    if (word.length > config.content.maxWordLength) continue;
    if (isDuplicate(word)) continue;

    candidates.push({
      word,
      source: 'fallback',
      discoveredAt: new Date().toISOString(),
    });

    if (candidates.length >= limit) break;
  }

  log.info({ count: candidates.length }, 'Fallback discovery complete');
  return candidates;
}
