/**
 * pipeline.ts — Orchestrate the full production pipeline.
 *
 * Flow: Discover → Validate → Script → TTS → Mix → Render → Upload
 *
 * Each stage updates the PipelineItem in the database.
 * If any stage fails, the item is marked as 'failed' with an error message.
 */

import { discoverFromReddit } from './modules/discoverReddit.js';
import { discoverFromRss } from './modules/discoverRss.js';
import { discoverFromFallback, discoverByFormat } from './modules/discoverFallback.js';
import { selectNextFormat, formatLabel, usesCuratedList } from './modules/formatSelector.js';
import { pickBestWord } from './modules/validator.js';
import { lookupWord } from './modules/dictionaryLookup.js';
import { generateScript } from './modules/scriptGenerator.js';
import { generateTTS } from './modules/tts.js';
import { mixAudio } from './modules/audioMixer.js';
import { scheduleSFX } from './modules/sfxMixer.js';
import { renderVideo } from './modules/remotionRender.js';
import { fetchBackground } from './modules/backgroundFetcher.js';
import { uploadToYouTube } from './modules/uploader.js';
import { insertWord, updateWord, isDuplicate } from './utils/db.js';
import { moduleLogger } from './utils/logger.js';
import type { CLIOptions, PipelineItem, WordCandidate } from './types/index.js';

const log = moduleLogger('pipeline');

/**
 * Run the full pipeline for a single Short.
 */
export async function runPipeline(options: CLIOptions): Promise<PipelineItem | null> {
  const startTime = Date.now();

  // ── Determine format ─────────────────────────────────────────────────────
  const format = selectNextFormat(options.format);
  log.info({ options, format, formatLabel: formatLabel(format) }, '🚀 Pipeline starting');

  let item: PipelineItem | null = null;

  try {
    // ── STAGE 1: DISCOVER ────────────────────────────────────────────────

    let candidates: WordCandidate[];

    if (options.word) {
      // Manual word specified via --word flag
      log.info({ word: options.word }, 'Using manually specified word');
      if (isDuplicate(options.word)) {
        log.warn({ word: options.word }, 'Word is a duplicate — proceeding anyway (manual override)');
      }
      candidates = [{
        word: options.word,
        source: 'manual',
        discoveredAt: new Date().toISOString(),
      }];
    } else if (usesCuratedList(format)) {
      // emotional-word, funny-meaning, misused-word all have curated lists
      log.info({ format }, 'Using format-specific curated word list');
      candidates = await discoverByFormat(format, 15);
      if (candidates.length === 0) {
        log.info('Format-specific list exhausted — falling back to general curated list');
        candidates = await discoverFromFallback(15);
      }
    } else if (options.source === 'fallback') {
      candidates = await discoverFromFallback(15);
    } else if (options.source === 'reddit') {
      // Explicit Reddit request — try Reddit, fall back to RSS then fallback
      try {
        candidates = await discoverFromReddit(15);
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'Reddit discovery failed — trying RSS');
        candidates = await discoverFromRss(15);
      }
      if (candidates.length === 0) {
        log.info('No Reddit candidates — falling back to curated list');
        candidates = await discoverFromFallback(15);
      }
    } else {
      // Default (source === 'rss' or unset): RSS feeds → fallback curated list
      try {
        candidates = await discoverFromRss(15);
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'RSS discovery failed — using fallback');
        candidates = await discoverFromFallback(15);
      }
      if (candidates.length === 0) {
        log.info('No RSS candidates — using curated fallback list');
        candidates = await discoverFromFallback(15);
      }
    }

    if (candidates.length === 0) {
      log.error('No word candidates found from any source');
      return null;
    }

    log.info({ candidateCount: candidates.length }, 'Candidates discovered');

    // ── STAGE 2: VALIDATE & PICK BEST ───────────────────────────────────

    let word: string;
    let ipa: string | undefined;
    let definition: string;
    let partOfSpeech: string | undefined;

    if (options.word) {
      // For manual words, still look up but don't reject on quality
      const dict = await lookupWord(options.word);
      word = options.word;
      ipa = dict.ipa;
      definition = dict.definition ?? 'A rare and fascinating English word.';
      partOfSpeech = dict.partOfSpeech;
    } else {
      const best = await pickBestWord(candidates);
      if (!best) {
        log.error('No candidates passed validation');
        return null;
      }
      word = best.candidate.word;
      ipa = best.dictionary.ipa;
      definition = best.dictionary.definition ?? 'A rare and fascinating English word.';
      partOfSpeech = best.dictionary.partOfSpeech;
    }

    // Insert into DB
    const candidate = candidates.find((c) => c.word === word) ?? candidates[0];
    item = insertWord(word, candidate.source, candidate.sourceUrl, candidate.subreddit);
    updateWord(item.id, { status: 'validated', ipa, definition, partOfSpeech });

    log.info({ word, ipa, definition: definition.slice(0, 60), format }, '✓ Word validated');

    // ── STAGE 3: GENERATE SCRIPT ─────────────────────────────────────────

    const script = await generateScript(
      word,
      { word, exists: true, ipa, definition, partOfSpeech },
      format   // ← pass format here
    );

    updateWord(item.id, {
      status: 'scripted',
      hook: script.hook,
      script,
    });

    log.info({
      word,
      format: script.format,
      hook: script.hook.slice(0, 60),
      duration: script.estimatedDuration,
    }, '✓ Script generated');

    if (options.dryRun) {
      log.info({ word, format, script }, '🏁 DRY RUN complete — stopping before TTS');
      updateWord(item.id, { status: 'scripted' });
      return { ...item, status: 'scripted', script } as PipelineItem;
    }

    // ── STAGE 3b: FETCH BACKGROUND VIDEO ────────────────────────────────
    // Runs in parallel with TTS — fetch contextual Pexels video

    const bgVideoPromise = fetchBackground(word, definition);

    // ── STAGE 4: TTS ──────────────────────────────────────────────────────

    const ttsResult = await generateTTS(script, word, item.id);
    updateWord(item.id, {
      status: 'tts_done',
      voiceoverPath: ttsResult.audioPath,
    });

    log.info({
      duration: ttsResult.durationSec,
      engine: ttsResult.engine,
      captions: ttsResult.captions?.length ?? 0,
    }, '✓ TTS complete');

    // ── STAGE 4b: SCHEDULE SFX ────────────────────────────────────────────

    const FPS = 30;
    const hookWords = script.hook.split(/\s+/).length;
    const pronWords = script.pronunciation.split(/\s+/).length;
    const defWords = script.definition.split(/\s+/).length;
    const ctaWords = script.cta.split(/\s+/).length;
    const totalWords = hookWords + pronWords + defWords + ctaWords;
    const hookSec = (hookWords / totalWords) * ttsResult.durationSec;
    const pronSec = (pronWords / totalWords) * ttsResult.durationSec;
    const defSec = (defWords / totalWords) * ttsResult.durationSec;

    const sfxEvents = scheduleSFX({
      hookEndSec: hookSec,
      wordEndSec: hookSec + pronSec,
      ctaStartSec: hookSec + pronSec + defSec,
      durationSec: ttsResult.durationSec,
    }, word, ttsResult.captions);

    log.info({ sfxCount: sfxEvents.length }, '✓ SFX scheduled');

    // ── STAGE 5: AUDIO MIX ────────────────────────────────────────────────

    const audioMix = await mixAudio(
      ttsResult.audioPath, ttsResult.durationSec, word, item.id,
      sfxEvents.length > 0 ? sfxEvents : undefined
    );
    updateWord(item.id, {
      status: 'audio_mixed',
      mixedAudioPath: audioMix.mixedAudioPath,
      musicTrack: audioMix.musicTrack,
    });

    log.info({ duration: audioMix.durationSec, track: audioMix.musicTrack }, '✓ Audio mixed');

    // ── STAGE 6: RENDER VIDEO ─────────────────────────────────────────────

    // Resolve background video (started in parallel with TTS)
    const bgVideoPath = await bgVideoPromise;
    if (bgVideoPath) {
      log.info({ bgVideoPath }, '✓ Background video ready');
    }

    const { videoPath, durationSec } = await renderVideo(
      word, ipa ?? '', definition, script, audioMix, item.id,
      ttsResult.captions, bgVideoPath ?? undefined
    );

    // Safety check: Shorts must be ≤ 60s
    if (durationSec > 60) {
      log.error({ durationSec }, 'Video exceeds 60s — not suitable for Shorts');
      updateWord(item.id, { status: 'failed', error: 'Video too long for Shorts' });
      return null;
    }

    updateWord(item.id, {
      status: 'rendered',
      videoPath,
      durationSec,
    });

    log.info({ videoPath, durationSec }, '✓ Video rendered');

    // ── STAGE 7: UPLOAD ───────────────────────────────────────────────────

    if (options.noUpload) {
      log.info('⏭  Skipping upload (--no-upload flag)');
      return { ...item, status: 'rendered', videoPath } as PipelineItem;
    }

    const uploadResult = await uploadToYouTube(
      videoPath, word, ipa, definition, script, audioMix.musicTrack,
      options.schedule
    );

    updateWord(item.id, {
      status: 'uploaded',
      youtubeVideoId: uploadResult.videoId,
      youtubeUrl: uploadResult.url,
      uploadedAt: new Date().toISOString(),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info({
      word,
      format: script.format,
      videoId: uploadResult.videoId,
      url: uploadResult.url,
      elapsed: `${elapsed}s`,
    }, '🎉 Pipeline complete! Short published.');

    return {
      ...item,
      status: 'uploaded',
      youtubeVideoId: uploadResult.videoId,
      youtubeUrl: uploadResult.url,
    } as PipelineItem;

  } catch (err) {
    const error = err as Error;
    log.error({ error: error.message, stack: error.stack }, '💥 Pipeline failed');

    if (item) {
      updateWord(item.id, { status: 'failed', error: error.message });
    }

    throw error;
  }
}