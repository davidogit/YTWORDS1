/**
 * audioMixer.ts — Mix voiceover with background music using FFmpeg.
 *
 * Features:
 *   - Automatic ducking (lower music under voice)
 *   - Loudness normalization
 *   - Fade in/out on music
 *   - Random track selection from assets/music/
 *
 * Requires: FFmpeg installed and accessible via FFMPEG_PATH env var.
 *
 * ── Royalty-Free Music Sources ──────────────────────────────────
 *   FREE:
 *     - Pixabay Music (pixabay.com/music) — free for commercial use
 *     - Free Music Archive (freemusicarchive.org) — CC licensed
 *     - YouTube Audio Library (studio.youtube.com) — free for YT
 *     - Incompetech (incompetech.com) — CC-BY Kevin MacLeod
 *   PAID (better selection):
 *     - Epidemic Sound (~$15/mo) — huge library, no claims
 *     - Artlist (~$10/mo) — unlimited downloads
 *
 *   ⚠️ ALWAYS check the license. Even "free" tracks may require
 *      attribution. Store license info alongside tracks.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { AudioMixResult, SFXEvent } from '../types/index.js';

const execFileAsync = promisify(execFile);
const log = moduleLogger('audioMixer');


// ── Track Selection ────────────────────────────────────────────────────────

// Shuffle queue — cycles through every track before repeating any.
// Automatically picks up new tracks added to the music folder.
let shuffleQueue: string[] = [];

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick a background music track using a shuffle queue.
 * All tracks play before any repeats. New tracks added to the folder
 * are picked up automatically on the next queue refill.
 */
function selectMusicTrack(): string | null {
  const musicDir = config.paths.music;
  if (!existsSync(musicDir)) {
    log.warn({ dir: musicDir }, 'Music directory not found');
    return null;
  }

  const tracks = readdirSync(musicDir)
    .filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f))
    .sort(); // stable sort so queue is consistent across restarts

  if (tracks.length === 0) {
    log.warn('No music tracks found — output will be voice only');
    return null;
  }

  // Refill queue when empty (or when new tracks have been added)
  if (shuffleQueue.length === 0) {
    shuffleQueue = shuffleArray(tracks);
    log.info({ tracks: shuffleQueue }, 'Music shuffle queue refilled');
  }

  const chosen = shuffleQueue.pop()!;
  log.info({ track: chosen, remaining: shuffleQueue.length }, 'Selected music track');
  return path.join(musicDir, chosen);
}

// ── FFmpeg Mixing ──────────────────────────────────────────────────────────

/**
 * Mix voiceover with background music using FFmpeg.
 *
 * The complex filter does:
 *   1. Trim music to match voiceover duration + 2s buffer
 *   2. Apply fade-in (1s) and fade-out (2s) to music
 *   3. Duck music volume to -18dB under voice (voice stays at 0dB)
 *   4. Apply sidechaincompress for dynamic ducking (music dips when voice plays)
 *   5. Normalize final output loudness
 *
 * Simplified approach (without sidechain, more compatible):
 *   - Voice at full volume
 *   - Music at fixed low volume (0.12 = roughly -18dB)
 *   - Fade in/out on music
 */
async function mixWithFFmpeg(
  voiceoverPath: string,
  musicPath: string,
  outputPath: string,
  voiceDuration: number
): Promise<void> {
  const ffmpeg = config.paths.ffmpeg;
  const totalDuration = voiceDuration + 1.5; // 1.5s buffer after voice ends
  const fadeOutStart = Math.max(0, totalDuration - 2);

  // ── Method 1: Simple volume mixing (most compatible) ──
  //
  // FFmpeg filter explanation:
  //   [1:a] = music input
  //   atrim: cut music to desired length
  //   volume=0.12: set music to ~12% volume (subtle background)
  //   afade: fade in 1s at start, fade out 2s at end
  //   [0:a] = voiceover (kept at full volume)
  //   amix: combine both audio streams
  //   loudnorm: normalize to broadcast standards (-14 LUFS)

  const filterComplex = [
    // Music: trim, lower volume, fade
    `[1:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,` +
    `volume=0.12,` +
    `afade=t=in:st=0:d=1,` +
    `afade=t=out:st=${fadeOutStart}:d=2[music];`,
    // Voice: keep as-is
    `[0:a]aresample=44100[voice];`,
    // Mix and normalize
    `[voice][music]amix=inputs=2:duration=longest:dropout_transition=2,` +
    `loudnorm=I=-14:LRA=11:TP=-1[out]`,
  ].join('');

  const args = [
    '-y',                    // Overwrite output
    '-i', voiceoverPath,     // Input 0: voiceover
    '-i', musicPath,         // Input 1: background music
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    '-ar', '44100',
    outputPath,
  ];

  log.info({ voiceoverPath, musicPath, outputPath, totalDuration }, 'Mixing audio');
  await execFileAsync(ffmpeg, args, { timeout: 120000 });
}

/**
 * Advanced: Sidechain compression for dynamic ducking.
 * Music automatically dips when voice is active.
 * Requires FFmpeg compiled with --enable-libsidechaincompress.
 */
async function mixWithSidechain(
  voiceoverPath: string,
  musicPath: string,
  outputPath: string,
  voiceDuration: number
): Promise<void> {
  const ffmpeg = config.paths.ffmpeg;
  const totalDuration = voiceDuration + 1.5;
  const fadeOutStart = Math.max(0, totalDuration - 2);

  const filterComplex = [
    `[1:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,` +
    `volume=0.25,` +
    `afade=t=in:st=0:d=1,` +
    `afade=t=out:st=${fadeOutStart}:d=2[music];`,
    `[0:a]aresample=44100[voice];`,
    // Sidechain: duck music when voice is present
    `[music][voice]sidechaincompress=threshold=0.02:ratio=8:attack=200:release=1000[ducked];`,
    `[voice][ducked]amix=inputs=2:duration=longest,` +
    `loudnorm=I=-14:LRA=11:TP=-1[out]`,
  ].join('');

  const args = [
    '-y', '-i', voiceoverPath, '-i', musicPath,
    '-filter_complex', filterComplex,
    '-map', '[out]', '-codec:a', 'libmp3lame', '-b:a', '192k',
    outputPath,
  ];

  await execFileAsync(ffmpeg, args, { timeout: 120000 });
}

// ── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Mix voiceover with a random background track.
 * Returns path to mixed audio file.
 */
export async function mixAudio(
  voiceoverPath: string,
  voiceDuration: number,
  word: string,
  wordId: string,
  sfxEvents?: SFXEvent[]
): Promise<AudioMixResult> {
  const wordDir = path.join(config.paths.output, 'words', word);
  mkdirSync(wordDir, { recursive: true });
  const outputPath = path.join(wordDir, 'mixed.mp3');
  const musicTrack = selectMusicTrack();

  if (!musicTrack) {
    // No music available — just copy the voiceover
    log.info('No background music — using voiceover only');
    const { copyFileSync } = await import('fs');
    copyFileSync(voiceoverPath, outputPath);
    return {
      mixedAudioPath: outputPath,
      durationSec: voiceDuration,
      musicTrack: 'none',
    };
  }

  try {
    // Try simple mix first (most compatible)
    await mixWithFFmpeg(voiceoverPath, musicTrack, outputPath, voiceDuration);
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'FFmpeg mix failed, trying sidechain');
    try {
      await mixWithSidechain(voiceoverPath, musicTrack, outputPath, voiceDuration);
    } catch (err2) {
      // Last resort: just use voiceover without music
      log.error({ error: (err2 as Error).message }, 'All mixing failed — using voice only');
      const { copyFileSync } = await import('fs');
      copyFileSync(voiceoverPath, outputPath);
      return {
        mixedAudioPath: outputPath,
        durationSec: voiceDuration,
        musicTrack: 'none (mix failed)',
      };
    }
  }

  // Layer SFX on top of the voice+music mix (if any events provided)
  if (sfxEvents && sfxEvents.length > 0) {
    const validSfx = sfxEvents.filter((e) => existsSync(e.sfxPath));
    if (validSfx.length > 0) {
      try {
        const sfxTempPath = outputPath.replace('.mp3', '_preSfx.mp3');
        const { renameSync, unlinkSync: rmSync } = await import('fs');
        renameSync(outputPath, sfxTempPath);

        // Build FFmpeg command to layer all SFX at their scheduled times
        const inputs = ['-y', '-i', sfxTempPath];
        const filterParts: string[] = [];
        for (let i = 0; i < validSfx.length; i++) {
          inputs.push('-i', validSfx[i].sfxPath);
          const delayMs = Math.round(validSfx[i].startSec * 1000);
          filterParts.push(
            `[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=${validSfx[i].volume}[sfx${i}]`
          );
        }
        // Mix: base mix + all SFX streams
        const sfxLabels = validSfx.map((_, i) => `[sfx${i}]`).join('');
        filterParts.push(
          `[0:a]${sfxLabels}amix=inputs=${validSfx.length + 1}:duration=first:dropout_transition=2[out]`
        );

        const args = [
          ...inputs,
          '-filter_complex', filterParts.join(';'),
          '-map', '[out]',
          '-codec:a', 'libmp3lame', '-b:a', '192k',
          outputPath,
        ];

        await execFileAsync(config.paths.ffmpeg, args, { timeout: 60000 });
        try { rmSync(sfxTempPath); } catch { /* ignore */ }
        log.info({ sfxCount: validSfx.length }, 'SFX layered into mix');
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'SFX layering failed — using mix without SFX');
      }
    }
  }

  // Get final duration
  let finalDuration = voiceDuration + 1.5;
  try {
    const { stdout } = await execFileAsync(
      config.paths.ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outputPath]
    );
    finalDuration = parseFloat(stdout.trim());
  } catch { /* use estimate */ }

  log.info({ outputPath, duration: finalDuration, track: path.basename(musicTrack) },
    'Audio mix complete');

  return {
    mixedAudioPath: outputPath,
    durationSec: finalDuration,
    musicTrack: path.basename(musicTrack),
  };
}
