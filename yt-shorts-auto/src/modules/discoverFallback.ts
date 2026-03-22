/**
 * discoverFallback.ts — Fallback word discovery when Reddit / RSS is unavailable.
 *
 * Sources:
 *   1. Format-specific curated lists (emotional, funny, misused, scrabble)
 *   2. Random Word API
 *   3. Wordnik Random Words (if API key set)
 *   4. General curated "interesting words" list (built-in)
 */

import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import { isDuplicate } from '../utils/db.js';
import { withRetry } from '../utils/retry.js';
import type { WordCandidate, ShortFormat } from '../types/index.js';

const log = moduleLogger('discoverFallback');

// ── Scrabble Edge Words ────────────────────────────────────────────────────
// Valid in both TWL (North America) and SOWPODS (international) unless noted.
// Organised by category so hooks can reference the angle.

export interface ScrabbleWord {
  word: string;
  score: number;       // approximate base Scrabble score (no multipliers)
  category: string;   // 'q-no-u' | 'two-letter' | 'z-heavy' | 'x-heavy' | 'j-heavy' | 'power'
  hint: string;       // short angle for the hook (1–2 words, e.g. "Q without U")
}

export const SCRABBLE_WORDS: readonly ScrabbleWord[] = [
  // ── Q without U — the ultimate Scrabble flex ───────────────────────────
  { word: 'qi',      score: 11, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qoph',   score: 18, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qadi',   score: 14, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qaid',   score: 14, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qanat',  score: 15, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qat',    score: 12, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'tranq',  score: 14, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'waqf',   score: 18, category: 'q-no-u',     hint: 'Q without U' },
  { word: 'qoph',   score: 18, category: 'q-no-u',     hint: 'Q without U' },

  // ── Two-letter power words — tiny, devastating ─────────────────────────
  { word: 'za',  score: 11, category: 'two-letter', hint: '2-letter word' },
  { word: 'xi',  score: 9,  category: 'two-letter', hint: '2-letter word' },
  { word: 'xu',  score: 9,  category: 'two-letter', hint: '2-letter word' },
  { word: 'aa',  score: 2,  category: 'two-letter', hint: '2-letter word' },
  { word: 'oe',  score: 2,  category: 'two-letter', hint: '2-letter word' },
  { word: 'jo',  score: 9,  category: 'two-letter', hint: '2-letter word' },
  { word: 'ka',  score: 6,  category: 'two-letter', hint: '2-letter word' },
  { word: 'qi',  score: 11, category: 'two-letter', hint: '2-letter word' },

  // ── Z-heavy scorers ────────────────────────────────────────────────────
  { word: 'zax',     score: 19, category: 'z-heavy', hint: 'Z word' },
  { word: 'zebu',    score: 15, category: 'z-heavy', hint: 'Z word' },
  { word: 'zloty',   score: 17, category: 'z-heavy', hint: 'Z word' },
  { word: 'zoea',    score: 13, category: 'z-heavy', hint: 'Z word' },
  { word: 'kazoo',   score: 18, category: 'z-heavy', hint: 'Z word' },
  { word: 'plotz',   score: 16, category: 'z-heavy', hint: 'Z word' },
  { word: 'glitz',   score: 15, category: 'z-heavy', hint: 'Z word' },
  { word: 'blitz',   score: 16, category: 'z-heavy', hint: 'Z word' },
  { word: 'spritz',  score: 17, category: 'z-heavy', hint: 'Z word' },
  { word: 'snazzy',  score: 24, category: 'z-heavy', hint: 'Z word' },
  { word: 'pizzazz', score: 43, category: 'z-heavy', hint: 'Z word' },
  { word: 'zoeae',   score: 14, category: 'z-heavy', hint: 'Z word' },
  { word: 'bezique', score: 24, category: 'z-heavy', hint: 'Z word' },
  { word: 'zymurgy', score: 24, category: 'z-heavy', hint: 'Z word' },
  { word: 'kvetch',  score: 18, category: 'z-heavy', hint: 'rare word' },
  { word: 'fizgig',  score: 19, category: 'z-heavy', hint: 'Z word' },

  // ── X scorers ──────────────────────────────────────────────────────────
  { word: 'xi',    score: 9,  category: 'x-heavy', hint: 'X word' },
  { word: 'xu',    score: 9,  category: 'x-heavy', hint: 'X word' },
  { word: 'zax',   score: 19, category: 'x-heavy', hint: 'X word' },
  { word: 'oxazine', score: 24, category: 'x-heavy', hint: 'X word' },

  // ── J scorers ──────────────────────────────────────────────────────────
  { word: 'jato',  score: 11, category: 'j-heavy', hint: 'J word' },
  { word: 'jeux',  score: 17, category: 'j-heavy', hint: 'J word' },
  { word: 'jinx',  score: 17, category: 'j-heavy', hint: 'J word' },

  // ── High-value power words — valid, surprising, rarely played ──────────
  { word: 'muzjiks',  score: 28, category: 'power', hint: 'highest-scoring' },
  { word: 'cazique',  score: 27, category: 'power', hint: 'power play' },
  { word: 'squab',    score: 17, category: 'power', hint: 'power play' },
  { word: 'quaff',    score: 20, category: 'power', hint: 'power play' },
  { word: 'frowzy',   score: 21, category: 'power', hint: 'power play' },
  { word: 'woozy',    score: 18, category: 'power', hint: 'power play' },
  { word: 'squelch',  score: 22, category: 'power', hint: 'power play' },
  { word: 'squib',    score: 17, category: 'power', hint: 'power play' },
  { word: 'quetzal',  score: 24, category: 'power', hint: 'power play' },
  { word: 'chutzpah', score: 25, category: 'power', hint: 'power play' },
  { word: 'schmaltz', score: 24, category: 'power', hint: 'power play' },
  { word: 'kudzu',    score: 19, category: 'power', hint: 'power play' },
];

// Just the word strings for easy dedup checks
export const SCRABBLE_WORDS_SET = new Set(SCRABBLE_WORDS.map((w) => w.word));

// ── Emotional / untranslatable words ──────────────────────────────────────

export const EMOTIONAL_WORDS: readonly string[] = [
  'petrichor', 'sonder', 'hiraeth', 'saudade', 'limerence',
  'vellichor', 'chrysalism', 'onism', 'monachopsis', 'liberosis',
  'jouska', 'ellipsism', 'altschmerz', 'occhiolism', 'kenopsia',
  'vemödalen', 'anecdoche', 'nodus', 'exulansis', 'zenosyne',
  'opia', 'kuebiko', 'lachesism', 'rubatosis', 'énouement',
  'adronitis', 'rückkehr', 'pâro', 'mauerbauertraurigkeit',
  'ambedo', 'avenoir', 'koinophobia', 'desiderium', 'sehnsucht',
  'meraki', 'wanderlust', 'fernweh', 'weltschmerz', 'schadenfreude',
  'torschlusspanik', 'forelsket', 'gigil', 'mamihlapinatapai',
  'natsukashii', 'wabi-sabi', 'mono', 'yugen', 'gezelligheid', 'hygge',
];

// ── Funny / oddly specific English words ──────────────────────────────────

export const FUNNY_MEANING_WORDS: readonly string[] = [
  'bumfuzzle', 'cattywampus', 'collywobbles', 'flibbertigibbet',
  'lollygag', 'malarkey', 'nincompoop', 'pettifogger', 'skedaddle',
  'snollygoster', 'taradiddle', 'whippersnapper', 'absquatulate',
  'fudgel', 'crapulence', 'griffonage', 'blatherskite', 'callipygian',
  'erinaceous', 'jentacular', 'selcouth', 'yarborough', 'widdershins',
  'ultracrepidarian', 'impignorate', 'ninnyhammer', 'hobbledehoy',
  'lickspittle', 'skullduggery', 'muckraker', 'balderdash', 'codswallop',
  'flapdoodle', 'rigmarole', 'tomfoolery', 'shenanigans', 'kerfuffle',
  'brouhaha', 'hullabaloo', 'discombobulate', 'flummox', 'bamboozle',
  'gobsmacked', 'flabbergasted', 'befuddled', 'persnickety', 'lackadaisical',
];

// ── Misused word pairs ─────────────────────────────────────────────────────

export const MISUSED_WORD_PAIRS: readonly { target: string; versus: string }[] = [
  { target: 'affect',        versus: 'effect' },
  { target: 'fewer',         versus: 'less' },
  { target: 'who',           versus: 'whom' },
  { target: 'lie',           versus: 'lay' },
  { target: 'imply',         versus: 'infer' },
  { target: 'comprise',      versus: 'compose' },
  { target: 'disinterested', versus: 'uninterested' },
  { target: 'envy',          versus: 'jealousy' },
  { target: 'literally',     versus: 'figuratively' },
  { target: 'ironic',        versus: 'coincidental' },
  { target: 'nauseous',      versus: 'nauseated' },
  { target: 'peruse',        versus: 'skim' },
  { target: 'bemused',       versus: 'amused' },
  { target: 'infamous',      versus: 'famous' },
  { target: 'fortuitous',    versus: 'fortunate' },
  { target: 'enormity',      versus: 'enormousness' },
  { target: 'nonplussed',    versus: 'unfazed' },
  { target: 'ambiguous',     versus: 'ambivalent' },
  { target: 'aggravate',     versus: 'irritate' },
  { target: 'anxious',       versus: 'eager' },
];

// ── General curated "interesting words" ───────────────────────────────────

export const CURATED_WORDS: readonly string[] = [
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
  'melisma', 'cacophony', 'euphony', 'sibilance', 'cadenza',
  'vibrato', 'tremolo', 'arpeggio', 'nocturne', 'dulcet',
  'absquatulate', 'flibbertigibbet', 'kerfuffle', 'brouhaha', 'hullabaloo',
  'discombobulate', 'flummox', 'bamboozle', 'lollygag', 'shenanigans',
  'sycophant', 'obsequious', 'perspicacious', 'sagacious', 'loquacious',
  'magnanimous', 'munificent', 'bellicose', 'truculent', 'recalcitrant',
  'querulous', 'fastidious', 'mercurial', 'phlegmatic', 'sanguine',
  'lachrymose', 'lugubrious', 'sardonic', 'irascible', 'intrepid',
  'solipsism', 'onomatopoeia', 'circumlocution', 'tautology', 'quixotic',
  'sisyphean', 'equanimity', 'alacrity', 'acrimony', 'catharsis',
  'hubris', 'pathos', 'schadenfreude', 'weltanschauung', 'gestalt',
  'leitmotif', 'aphorism', 'hyperbole', 'synecdoche', 'episteme',
  'syzygy', 'penumbra', 'aphelion', 'perihelion', 'aurora',
  'bioluminescence', 'phosphorescence', 'coruscation', 'effulgence', 'maelstrom',
  'riparian', 'sylvan', 'vernal', 'cerulean', 'vermillion',
  'desiderium', 'sehnsucht', 'meraki', 'wanderlust', 'poignant',
  'elegiac', 'valediction', 'solace', 'reverie', 'rumination',
  'labyrinthine', 'ostentatious', 'nefarious', 'insidious', 'tenacious',
  'voracious', 'ubiquitous', 'luminous', 'resplendent', 'felicitous',
  'neologism', 'portmanteau', 'palindrome', 'oxymoron', 'malapropism',
  'spoonerism', 'mondegreen', 'paraprosdokian', 'tmesis', 'eggcorn',
  'simulacrum', 'palimpsest', 'archipelago', 'calliope', 'phantasmagoria',
];

export const CURATED_WORDS_SET = new Set(CURATED_WORDS);

// ── Format-aware discovery ─────────────────────────────────────────────────

export async function discoverByFormat(
  format: ShortFormat,
  limit = 10
): Promise<WordCandidate[]> {
  log.info({ format }, 'Discovering words from format-specific curated list');

  let wordPool: string[];

  if (format === 'emotional-word') {
    wordPool = [...EMOTIONAL_WORDS].sort(() => Math.random() - 0.5);
  } else if (format === 'funny-meaning') {
    wordPool = [...FUNNY_MEANING_WORDS].sort(() => Math.random() - 0.5);
  } else if (format === 'misused-word') {
    wordPool = [...MISUSED_WORD_PAIRS]
      .sort(() => Math.random() - 0.5)
      .map((p) => p.target);
  } else if (format === 'scrabble-word') {
    // Shuffle scrabble words, bias toward higher-scoring entries
    wordPool = [...SCRABBLE_WORDS]
      .sort((a, b) => (b.score - a.score) * Math.random() + (Math.random() - 0.5) * 5)
      .map((w) => w.word);
  } else {
    wordPool = [...CURATED_WORDS].sort(() => Math.random() - 0.5);
  }

  const candidates: WordCandidate[] = [];
  const seen = new Set<string>();

  for (const word of wordPool) {
    if (seen.has(word)) continue;
    seen.add(word);
    if (word.length < config.content.minWordLength && format !== 'scrabble-word') continue;
    if (word.length > config.content.maxWordLength) continue;
    if (isDuplicate(word)) continue;

    candidates.push({
      word,
      source: 'fallback',
      discoveredAt: new Date().toISOString(),
    });

    if (candidates.length >= limit) break;
  }

  log.info({ count: candidates.length, format }, 'Format-specific discovery complete');
  return candidates;
}

// ── Random Word API ────────────────────────────────────────────────────────

async function fetchRandomWords(count = 20): Promise<string[]> {
  try {
    const resp = await fetch(`https://random-word-api.herokuapp.com/word?number=${count}&length=7`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as string[];
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'Random word API failed');
    return [];
  }
}

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

export async function discoverFromFallback(limit = 10): Promise<WordCandidate[]> {
  log.info('Using fallback word discovery');
  const allWords: string[] = [];

  const [randomWords, wordnikWords] = await Promise.all([
    withRetry(() => fetchRandomWords(30), 'random-word-api', { maxAttempts: 2 }),
    fetchWordnikRandom(15),
  ]);

  const shuffled = [...CURATED_WORDS].sort(() => Math.random() - 0.5);
  allWords.push(...shuffled, ...randomWords, ...wordnikWords);

  const candidates: WordCandidate[] = [];
  const seen = new Set<string>();

  for (const raw of allWords) {
    const word = raw.toLowerCase().trim();
    if (seen.has(word)) continue;
    seen.add(word);
    if (word.length < config.content.minWordLength) continue;
    if (word.length > config.content.maxWordLength) continue;
    if (isDuplicate(word)) continue;

    candidates.push({ word, source: 'fallback', discoveredAt: new Date().toISOString() });
    if (candidates.length >= limit) break;
  }

  log.info({ count: candidates.length }, 'Fallback discovery complete');
  return candidates;
}