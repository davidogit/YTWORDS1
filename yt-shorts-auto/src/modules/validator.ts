/**
 * validator.ts — Validate and score candidate words.
 *
 * Checks: dictionary existence, profanity, duplicate, word frequency,
 * and quality scoring (novelty + pronunciation interest).
 */

import { lookupWord } from './dictionaryLookup.js';
import { isProfane } from '../utils/profanityFilter.js';
import { isDuplicate } from '../utils/db.js';
import { moduleLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { CURATED_WORDS_SET } from './discoverFallback.js';
import type { WordCandidate, DictionaryResult, ValidationResult } from '../types/index.js';

const log = moduleLogger('validator');

// ── Common words to avoid (too boring for Shorts) ──────────────────────────

const COMMON_WORDS = new Set([
  // Original set
  'about', 'after', 'again', 'because', 'before', 'being', 'between',
  'both', 'could', 'during', 'each', 'every', 'first', 'found',
  'great', 'house', 'large', 'later', 'little', 'never', 'other',
  'people', 'place', 'point', 'right', 'small', 'still', 'their',
  'there', 'these', 'thing', 'think', 'those', 'three', 'through',
  'under', 'water', 'where', 'which', 'while', 'world', 'would',
  'years', 'young', 'really', 'always', 'might', 'should',
  // Extended — generic verbs and nouns that slip through random-word-api
  'install', 'journal', 'market', 'system', 'method', 'create', 'update',
  'manage', 'server', 'client', 'object', 'string', 'number', 'action',
  'button', 'window', 'folder', 'access', 'record', 'return', 'simple',
  'result', 'report', 'design', 'review', 'change', 'follow', 'remove',
  'search', 'select', 'option', 'anyone', 'person', 'around', 'inside',
  'happen', 'rather', 'almost', 'second', 'minute', 'number', 'amount',
  'family', 'school', 'office', 'garden', 'animal', 'friend', 'player',
  'income', 'budget', 'couple', 'county', 'nature', 'summer', 'winter',
  'spring', 'autumn', 'ground', 'island', 'forest', 'bridge', 'street',
  'corner', 'castle', 'center', 'church', 'circle', 'colour', 'column',
]);

// ── Quality Scoring ────────────────────────────────────────────────────────

/**
 * Score a word 0–1 based on how "interesting" it is for a YouTube Short.
 *
 * Factors:
 *   - Length sweetspot (8–14 chars = ideal)
 *   - Has IPA pronunciation (adds interest)
 *   - Not extremely common
 *   - Has unusual letter patterns (double letters, rare consonant clusters)
 *   - Part of speech variety (nouns & adjectives score slightly higher)
 */
function scoreQuality(word: string, dict: DictionaryResult): number {
  let score = 0;

  // Length scoring: 8–14 is the sweet spot for "wow" factor
  const len = word.length;
  if (len >= 8 && len <= 14) score += 0.25;
  else if (len >= 6 && len <= 18) score += 0.15;
  else score += 0.05;

  // Has IPA pronunciation — viewers love hearing unusual words
  if (dict.ipa) score += 0.2;

  // Has a clear definition
  if (dict.definition && dict.definition.length > 10) score += 0.15;

  // Interesting letter patterns
  const hasDoubleLetters = /(.)\1/.test(word);
  const hasUnusualChars = /[xzqj]/i.test(word);
  const hasConsonantCluster = /[bcdfghjklmnpqrstvwxyz]{3,}/i.test(word);
  if (hasDoubleLetters) score += 0.05;
  if (hasUnusualChars) score += 0.1;
  if (hasConsonantCluster) score += 0.05;

  // Part of speech bonus
  const goodPOS = ['noun', 'adjective', 'verb'];
  if (dict.partOfSpeech && goodPOS.includes(dict.partOfSpeech.toLowerCase())) {
    score += 0.1;
  }

  // Penalty for being too common
  if (COMMON_WORDS.has(word.toLowerCase())) score -= 0.5;

  // Bonus for pre-vetted curated words — they're already known to be great
  if (CURATED_WORDS_SET.has(word.toLowerCase())) score += 0.2;

  // Normalize to 0–1
  return Math.max(0, Math.min(1, score));
}

// ── Main Validation ────────────────────────────────────────────────────────

/**
 * Validate a single word candidate.
 * Returns validation result with pass/fail and quality score.
 */
export async function validateWord(candidate: WordCandidate): Promise<{
  validation: ValidationResult;
  dictionary: DictionaryResult;
}> {
  const { word } = candidate;
  log.info({ word }, 'Validating word');

  // Check 1: Profanity
  if (isProfane(word)) {
    log.warn({ word }, 'Rejected: profanity');
    return {
      validation: {
        valid: false,
        rejectReason: 'Profanity detected',
        qualityScore: 0,
        isProfane: true,
        isDuplicate: false,
      },
      dictionary: { word, exists: false },
    };
  }

  // Check 2: Duplicate in our database
  if (isDuplicate(word)) {
    log.info({ word }, 'Rejected: duplicate');
    return {
      validation: {
        valid: false,
        rejectReason: 'Already used',
        qualityScore: 0,
        isProfane: false,
        isDuplicate: true,
      },
      dictionary: { word, exists: false },
    };
  }

  // Check 3: Dictionary existence
  const dict = await lookupWord(word);
  if (!dict.exists) {
    log.info({ word }, 'Rejected: not in dictionary');
    return {
      validation: {
        valid: false,
        rejectReason: 'Not found in any dictionary',
        qualityScore: 0,
        isProfane: false,
        isDuplicate: false,
      },
      dictionary: dict,
    };
  }

  // Check 4: Quality score
  const qualityScore = scoreQuality(word, dict);
  const meetsMinimum = qualityScore >= config.content.minQualityScore;

  if (!meetsMinimum) {
    log.info({ word, qualityScore }, 'Rejected: quality too low');
  } else {
    log.info({ word, qualityScore, ipa: dict.ipa }, 'Word validated ✓');
  }

  return {
    validation: {
      valid: meetsMinimum,
      rejectReason: meetsMinimum ? undefined : `Quality score ${qualityScore.toFixed(2)} below threshold`,
      qualityScore,
      isProfane: false,
      isDuplicate: false,
    },
    dictionary: dict,
  };
}

/**
 * Validate and pick the best word from a list of candidates.
 * Returns the highest-scoring valid word, or null if none pass.
 */
export async function pickBestWord(candidates: WordCandidate[]): Promise<{
  candidate: WordCandidate;
  dictionary: DictionaryResult;
  qualityScore: number;
} | null> {
  let best: { candidate: WordCandidate; dictionary: DictionaryResult; qualityScore: number } | null = null;

  for (const candidate of candidates) {
    const { validation, dictionary } = await validateWord(candidate);

    if (!validation.valid) continue;

    if (!best || validation.qualityScore > best.qualityScore) {
      best = { candidate, dictionary, qualityScore: validation.qualityScore };
    }

    // If we found a high-quality word, don't burn API calls on the rest
    if (validation.qualityScore >= 0.8) break;
  }

  if (best) {
    log.info({ word: best.candidate.word, score: best.qualityScore }, 'Best word selected');
  } else {
    log.warn('No valid words found from candidates');
  }

  return best;
}
