/**
 * formatSelector.ts — Rotate through content formats for 3x/day posting.
 *
 * Posting schedule (UTC):
 *   Morning   06–11  → emotional-word   (highest share rate)
 *   Afternoon 12–17  → guess-the-word   (interactive, drives comments)
 *   Evening   18–23  → rotates by day:
 *                       even days  → scrabble-word  (NEW)
 *                       odd days   → misused-word / funny-meaning alternating
 *
 * Override at any time with --format=<format> from the CLI.
 */

import type { ShortFormat } from '../types/index.js';

export function selectNextFormat(explicitFormat?: ShortFormat): ShortFormat {
  if (explicitFormat) return explicitFormat;

  const now  = new Date();
  const hour = now.getUTCHours();
  const day  = now.getUTCDate();

  // Morning: emotional hook performs best at start of day
  if (hour >= 6 && hour < 12) return 'emotional-word';

  // Afternoon: interactive content drives the comment section
  if (hour >= 12 && hour < 18) return 'guess-the-word';

  // Evening: rotate three formats across days
  if (hour >= 18) {
    if (day % 3 === 0) return 'scrabble-word';
    if (day % 3 === 1) return 'misused-word';
    return 'funny-meaning';
  }

  // Early morning / overnight default
  return 'word-of-the-day';
}

export function formatLabel(format: ShortFormat): string {
  const labels: Record<ShortFormat, string> = {
    'word-of-the-day': 'Word of the Day',
    'misused-word':    'Misused Word',
    'funny-meaning':   'Funny Meaning',
    'emotional-word':  'Emotional Word',
    'guess-the-word':  'Guess the Word',
    'scrabble-word':   'Scrabble Word',
  };
  return labels[format];
}

/** Whether a format uses format-specific curated word lists rather than RSS */
export function usesCuratedList(format: ShortFormat): boolean {
  return ['emotional-word', 'funny-meaning', 'misused-word', 'scrabble-word'].includes(format);
}