/**
 * sfxMixer.ts — Sound effect selection and scheduling.
 *
 * Picks random SFX from categorized folders and schedules them
 * at transition points (scene changes, word reveals, definition starts).
 *
 * SFX Categories:
 *   assets/sfx/transitions/  — whoosh/swoosh for scene changes
 *   assets/sfx/highlights/   — pop/chime for word reveals
 *   assets/sfx/stingers/     — dramatic reveal sounds
 *
 * Free SFX sources:
 *   - Pixabay (pixabay.com/sound-effects) — free, no attribution
 *   - Mixkit (mixkit.co/free-sound-effects) — free, royalty-free
 *   - Film Crux (filmcrux.com) — free transition whooshes
 */

import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { moduleLogger } from '../utils/logger.js';
import type { SFXEvent, CaptionWord } from '../types/index.js';

const log = moduleLogger('sfx');

const SFX_BASE = path.resolve('./assets/sfx');
const AUDIO_EXTS = /\.(mp3|wav|ogg|m4a|flac)$/i;

// ── SFX Selection ──────────────────────────────────────────────────────────

// Shuffle queues per category — same pattern as music selection
const categoryQueues: Map<string, string[]> = new Map();

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick a random SFX file from a category folder.
 * Uses a shuffle queue to avoid repeats until all SFX in the category are used.
 */
function selectSFX(category: string): string | null {
  const dir = path.join(SFX_BASE, category);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter((f) => AUDIO_EXTS.test(f)).sort();
  if (files.length === 0) return null;

  let queue = categoryQueues.get(category);
  if (!queue || queue.length === 0) {
    queue = shuffleArray(files);
    categoryQueues.set(category, queue);
  }

  const chosen = queue.pop()!;
  return path.join(dir, chosen);
}

// ── SFX Scheduling ─────────────────────────────────────────────────────────

interface TimingInfo {
  hookEndSec: number;
  wordEndSec: number;
  ctaStartSec: number;
  durationSec: number;
}

/**
 * Schedule SFX events at key transition points in the video.
 * Returns an array of timed events; each event maps to an SFX file.
 * Gracefully returns empty array if no SFX files are available.
 */
export function scheduleSFX(
  timings: TimingInfo,
  mainWord: string,
  captions?: CaptionWord[]
): SFXEvent[] {
  const events: SFXEvent[] = [];

  // 1. Transition whoosh at each scene change
  const transitionTimes = [timings.hookEndSec, timings.wordEndSec, timings.ctaStartSec];
  for (const sec of transitionTimes) {
    const sfx = selectSFX('transitions');
    if (sfx) {
      // Play whoosh slightly before the transition (0.15s lead)
      events.push({ sfxPath: sfx, startSec: Math.max(0, sec - 0.15), volume: 0.25 });
    }
  }

  // 2. Pop/chime when the main word first appears (at hookEnd)
  const highlightSfx = selectSFX('highlights');
  if (highlightSfx) {
    events.push({ sfxPath: highlightSfx, startSec: timings.hookEndSec + 0.3, volume: 0.3 });
  }

  // 3. Stinger before definition section
  const stinger = selectSFX('stingers');
  if (stinger) {
    events.push({ sfxPath: stinger, startSec: Math.max(0, timings.wordEndSec - 0.1), volume: 0.2 });
  }

  log.info({ eventCount: events.length }, 'SFX events scheduled');
  return events;
}
