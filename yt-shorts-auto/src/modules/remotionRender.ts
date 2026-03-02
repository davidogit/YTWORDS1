/**
 * remotionRender.ts — Render a YouTube Short video using FFmpeg.
 *
 * Produces a vertical 1080×1920 mp4 optimized for YouTube Shorts.
 * Uses FFmpeg drawtext filters with timed sections (hook → word → definition → CTA).
 * When a Pexels video background is available, it's composited behind the text.
 *
 * The Remotion composition (ShortVideo.tsx) is kept for `npm run remotion:preview`
 * visual design, but is not used for production rendering (too slow on most machines).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { ShortScript, AudioMixResult, CaptionWord } from '../types/index.js';

const execFileAsync = promisify(execFile);
const log = moduleLogger('render');

const FPS = 30;

// ── Background Theme Catalogue ─────────────────────────────────────────────

type BgStyle = 'aurora' | 'particles' | 'aurora-particles';

interface Theme {
  bgColor1: string;
  bgColor2: string;
  accentColor: string;
  bgStyle: BgStyle;
}

const THEMES: Theme[] = [
  // Aurora variants
  { bgColor1: '#0A0A2E', bgColor2: '#1A1A4E', accentColor: '#FF6B35', bgStyle: 'aurora' },           // Deep navy + orange
  { bgColor1: '#0D001A', bgColor2: '#1F003D', accentColor: '#BF5FFF', bgStyle: 'aurora' },           // Cosmic purple
  { bgColor1: '#001A1A', bgColor2: '#003333', accentColor: '#00E5CC', bgStyle: 'aurora' },           // Dark teal + cyan
  { bgColor1: '#1A0500', bgColor2: '#3D1000', accentColor: '#FF4500', bgStyle: 'aurora' },           // Deep ember
  { bgColor1: '#001505', bgColor2: '#002E0F', accentColor: '#00FF7F', bgStyle: 'aurora' },           // Forest night + green
  { bgColor1: '#100010', bgColor2: '#2A002A', accentColor: '#FF69B4', bgStyle: 'aurora' },           // Dark magenta
  // Particles variants
  { bgColor1: '#050518', bgColor2: '#0F0F30', accentColor: '#4FC3F7', bgStyle: 'particles' },        // Midnight blue + sky
  { bgColor1: '#0A000A', bgColor2: '#200020', accentColor: '#E040FB', bgStyle: 'particles' },        // Black + violet
  { bgColor1: '#001008', bgColor2: '#002010', accentColor: '#69F0AE', bgStyle: 'particles' },        // Deep green
  { bgColor1: '#100000', bgColor2: '#2A0000', accentColor: '#FF5252', bgStyle: 'particles' },        // Dark red
  // Aurora + particles combined (most dynamic)
  { bgColor1: '#0A0A2E', bgColor2: '#1A0A3E', accentColor: '#FF6B35', bgStyle: 'aurora-particles' }, // Original + particles
  { bgColor1: '#0D001A', bgColor2: '#1A003A', accentColor: '#00E5FF', bgStyle: 'aurora-particles' }, // Purple + cyan particles
];

/**
 * Deterministically pick a theme based on the word so the same word
 * always gets the same look (useful for rerenders / debugging).
 */
function pickTheme(word: string): Theme {
  const hash = word.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return THEMES[hash % THEMES.length];
}

// ── Timing Calculator ──────────────────────────────────────────────────────

interface FrameTiming {
  durationInFrames: number;
  hookEnd: number;
  wordEnd: number;
  ctaStart: number;
}

/**
 * Calculate frame timings based on script content.
 * Uses word counts to estimate section durations.
 */
function calculateTimings(script: ShortScript, audioDuration: number): FrameTiming {
  const totalFrames = Math.ceil(audioDuration * FPS);

  // Estimate section durations from word counts (2.5 words/sec)
  const hookWords = script.hook.split(/\s+/).length;
  const pronWords = script.pronunciation.split(/\s+/).length;
  const defWords = script.definition.split(/\s+/).length;
  const ctaWords = script.cta.split(/\s+/).length;
  const totalWords = hookWords + pronWords + defWords + ctaWords;

  // Proportional timing based on word count
  const hookSec = (hookWords / totalWords) * audioDuration;
  const pronSec = (pronWords / totalWords) * audioDuration;
  const defSec = (defWords / totalWords) * audioDuration;

  return {
    durationInFrames: totalFrames,
    hookEnd: Math.round(hookSec * FPS),
    wordEnd: Math.round((hookSec + pronSec) * FPS),
    ctaStart: Math.round((hookSec + pronSec + defSec) * FPS),
  };
}

// ── Remotion Render ────────────────────────────────────────────────────────

/**
 * Render video using Remotion CLI.
 *
 * This passes inputProps as a JSON file to the Remotion CLI, which
 * reads them and renders the ShortVideo composition.
 */
export async function renderVideo(
  word: string,
  ipa: string,
  definition: string,
  script: ShortScript,
  audio: AudioMixResult,
  wordId: string,
  captions?: CaptionWord[],
  bgVideoPath?: string
): Promise<{ videoPath: string; durationSec: number }> {
  const wordDir = path.join(config.paths.output, 'words', word);
  mkdirSync(wordDir, { recursive: true });

  // Pick a theme deterministically from the catalogue
  const theme = pickTheme(word);
  log.info({ word, theme: theme.bgStyle, accent: theme.accentColor, hasBgVideo: !!bgVideoPath }, 'Selected background theme');

  // Save props for Remotion preview (useful for debugging / manual Remotion renders)
  const timings = calculateTimings(script, audio.durationSec);
  const propsPath = path.join(wordDir, 'props.json');
  let bgVideoFilename: string | undefined;
  if (bgVideoPath) {
    const publicDir = path.join(process.cwd(), 'public');
    mkdirSync(publicDir, { recursive: true });
    bgVideoFilename = `bg-${word}.mp4`;
    copyFileSync(path.resolve(bgVideoPath), path.join(publicDir, bgVideoFilename));
  }
  writeFileSync(propsPath, JSON.stringify({
    word, ipa: ipa || '', definition, hook: script.hook, cta: script.cta,
    audioPath: '', ...timings,
    accentColor: theme.accentColor, bgColor1: theme.bgColor1, bgColor2: theme.bgColor2, bgStyle: theme.bgStyle,
    ...(bgVideoFilename ? { bgVideoPath: bgVideoFilename } : {}),
    ...(captions && captions.length > 0 ? { captions } : {}),
  }, null, 2));

  // FFmpeg is the primary renderer — fast and reliable.
  // Remotion is too slow on most machines (~1hr for a 25s video).
  // The Remotion composition is kept for `npm run remotion:preview` visual design.
  return renderWithFFmpeg(word, ipa, definition, script, audio, wordId, theme, bgVideoPath, captions);
}

// ── ASS Subtitle Generator ───────────────────────────────────────────────

/**
 * Convert hex color (#RRGGBB) to ASS color (&HBBGGRR&).
 * ASS uses BGR order and &H prefix.
 */
function hexToASS(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

/** Format seconds as ASS timestamp: H:MM:SS.CC (centiseconds) */
function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Wrap long text with \N (ASS hard line break) */
function wrapASS(text: string, maxChars: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.join('\\N');
}

/**
 * Split a sentence cue into approximate per-word timings
 * by distributing the duration proportionally by character count.
 */
function splitWordsFromCue(cue: CaptionWord): Array<{ word: string; startMs: number; endMs: number }> {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length === 1) return [{ word: words[0], startMs: cue.startMs, endMs: cue.endMs }];

  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  const totalMs = cue.endMs - cue.startMs;
  const result: Array<{ word: string; startMs: number; endMs: number }> = [];
  let cursor = cue.startMs;

  for (let i = 0; i < words.length; i++) {
    const proportion = words[i].length / totalChars;
    const wordMs = Math.round(proportion * totalMs);
    result.push({
      word: words[i],
      startMs: cursor,
      endMs: i === words.length - 1 ? cue.endMs : cursor + wordMs,
    });
    cursor += wordMs;
  }

  return result;
}

/**
 * Generate an ASS subtitle file with animated, styled text sections
 * and optional karaoke-style caption overlay.
 *
 * Animation techniques used:
 *   \fad(in,out)                  — fade in/out
 *   \move(x1,y1,x2,y2)           — positional slide animation
 *   \t(t1,t2,\tag)               — animate any property over time
 *   \fscx\fscy                    — scale animation (pop/bounce)
 *   \blur → \t(\blur0)            — deblur reveal
 *   \K<cs>                        — karaoke fill sweep (word-by-word highlight)
 *   \pos(x,y)                     — exact positioning
 *   \an                           — alignment
 */
function generateASS(
  word: string,
  ipa: string,
  definition: string,
  hook: string,
  cta: string,
  hookEndSec: number,
  wordEndSec: number,
  ctaStartSec: number,
  duration: number,
  theme: Theme,
  captions?: CaptionWord[],
): string {
  const accentASS = hexToASS(theme.accentColor);
  const whiteASS = '&H00FFFFFF&';
  const grayASS = '&H00CCCCCC&';
  const shadowASS = '&H00000000&';
  const wordDisplay = word.charAt(0).toUpperCase() + word.slice(1);

  const events: string[] = [];

  // Helper: add a dialogue line
  const addEvent = (start: number, end: number, style: string, text: string, layer = 0) => {
    events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  };

  // ── Vertical layout positions (1080×1920, center = 960) ──
  // All elements use \an5 (center anchor) with explicit \pos(x,y) or \move()
  // so nothing overlaps due to default margin-based positioning.

  // ── Section 1: Hook (slide up + deblur) ──
  const hookWrapped = wrapASS(hook, 26);
  // Emoji at y=700, hook text centered at y=940
  addEvent(0.1, hookEndSec - 0.3, 'Emoji',
    `{\\an5\\pos(540,700)\\fad(300,300)\\fscx60\\fscy60\\t(100,400,\\fscx120\\fscy120)\\t(400,700,\\fscx100\\fscy100)}🤔`);
  addEvent(0, hookEndSec, 'Hook',
    `{\\an5\\fad(500,350)\\move(540,980,540,940)\\blur4\\t(0,400,\\blur0)}${hookWrapped}`);

  // ── Section 2: Word reveal (scale pop + glow) ──
  // Word at y=860, underline at y=930, IPA at y=990
  addEvent(hookEndSec, wordEndSec, 'Word',
    `{\\an5\\pos(540,860)\\fad(100,300)\\fscx70\\fscy70\\blur3` +
    `\\t(0,250,\\fscx112\\fscy112\\blur0)` +
    `\\t(250,450,\\fscx100\\fscy100)}${wordDisplay}`);
  addEvent(hookEndSec + 0.2, wordEndSec, 'Underline',
    `{\\an5\\pos(540,930)\\fad(0,200)\\fscx0\\t(200,600,\\fscx100)}―――――`);
  if (ipa) {
    const ipaChars = ipa.length;
    const ipaDurMs = (wordEndSec - hookEndSec - 0.4) * 1000;
    const csPerChar = Math.max(2, Math.round(ipaDurMs / ipaChars / 10));
    let ipaKaraoke = '';
    for (const ch of ipa) {
      ipaKaraoke += `{\\K${csPerChar}}${ch}`;
    }
    addEvent(hookEndSec + 0.35, wordEndSec, 'IPA',
      `{\\an5\\pos(540,990)\\fad(0,300)}${ipaKaraoke}`);
  }

  // ── Section 3: Definition (staggered cascade) ──
  // DefLabel at y=740, definition lines starting at y=830
  addEvent(wordEndSec, ctaStartSec, 'DefLabel',
    `{\\an5\\fad(350,250)\\move(540,720,540,740)}${wordDisplay.toUpperCase()}`);
  const defLines = wrapASS(definition, 30).split('\\N');
  defLines.forEach((line, i) => {
    const staggerDelay = 0.25 + i * 0.3;
    const yPos = 830 + i * 64;
    addEvent(wordEndSec + staggerDelay, ctaStartSec, 'Definition',
      `{\\an5\\fad(400,300)\\move(540,${yPos + 20},540,${yPos})\\blur2\\t(0,350,\\blur0)}${line}`);
  });

  // ── Section 4: CTA (bounce in) ──
  // CTA text at y=880, Follow badge at y=1080
  const ctaWrapped = wrapASS(cta, 26);
  addEvent(ctaStartSec, duration, 'CTA',
    `{\\an5\\fad(400,300)\\move(540,920,540,880)}${ctaWrapped}`);
  addEvent(ctaStartSec + 0.5, duration, 'Follow',
    `{\\an5\\pos(540,1080)\\fad(300,200)\\fscx75\\fscy75` +
    `\\t(0,250,\\fscx108\\fscy108)` +
    `\\t(250,450,\\fscx100\\fscy100)}▶ FOLLOW`);

  // ── Caption Overlay (VTT-synced, karaoke word highlight) ──
  if (captions && captions.length > 0) {
    for (const cue of captions) {
      const startSec = cue.startMs / 1000;
      const endSec = cue.endMs / 1000;
      // Split sentence into words with approximate per-word timing
      const wordTimings = splitWordsFromCue(cue);
      if (wordTimings.length === 0) continue;

      // Build karaoke text: each word gets a \K duration tag
      // \K = fill from left to right in the accent (secondary) color
      let karaokeText = '';
      for (let i = 0; i < wordTimings.length; i++) {
        const wt = wordTimings[i];
        const durationCs = Math.max(1, Math.round((wt.endMs - wt.startMs) / 10));
        karaokeText += `{\\K${durationCs}}${wt.word} `;
      }

      addEvent(startSec, endSec, 'Caption',
        `{\\an2\\pos(540,1700)\\fad(150,150)}${karaokeText.trim()}`, 1);
    }
  }

  // PlayResX/Y must match video resolution for correct positioning
  const ass = `[Script Info]
Title: ${word} - Word of the Day
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial,52,${whiteASS},${whiteASS},${shadowASS},&H80000000&,1,0,0,0,100,100,0,0,1,3,2,5,60,60,0
Style: Emoji,Arial,80,${whiteASS},${whiteASS},&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,5,40,40,280
Style: Word,Arial,96,${accentASS},${accentASS},${shadowASS},&H80000000&,1,0,0,0,100,100,2,0,1,4,3,5,40,40,80
Style: IPA,Arial,38,${grayASS},${accentASS},${shadowASS},&H60000000&,0,0,0,0,100,100,1,0,1,2,1,5,40,40,0
Style: Underline,Arial,28,${accentASS},${accentASS},&H00000000&,&H00000000&,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0
Style: DefLabel,Arial,36,${accentASS},${accentASS},${shadowASS},&H60000000&,1,0,0,0,100,100,3,0,1,2,1,5,60,60,0
Style: Definition,Arial,42,${whiteASS},${whiteASS},${shadowASS},&H80000000&,0,0,0,0,100,100,0,0,1,3,2,5,60,60,0
Style: CTA,Arial,48,${whiteASS},${whiteASS},${shadowASS},&H80000000&,1,0,0,0,100,100,0,0,1,3,2,5,60,60,0
Style: Follow,Arial,42,${accentASS},${accentASS},${shadowASS},&H90000000&,1,0,0,0,100,100,2,0,3,3,1,2,60,60,380
Style: Caption,Arial,40,${whiteASS},${accentASS},${shadowASS},&HA0000000&,1,0,0,0,100,100,1,0,4,0,4,2,80,80,160

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;

  return ass;
}

// ── FFmpeg Render ─────────────────────────────────────────────────────────

/**
 * Render video using FFmpeg with ASS subtitle overlays and optional video background.
 *
 * Layout (1080×1920 vertical):
 *   Section 1 (hook):  Attention-grabbing question, centered with fade
 *   Section 2 (word):  Big word + IPA pronunciation
 *   Section 3 (def):   Definition text with word label
 *   Section 4 (cta):   Call to action + "FOLLOW" badge
 *
 * When a Pexels bg video is available it's composited behind the text
 * with a dark overlay; otherwise a themed solid color is used.
 */
async function renderWithFFmpeg(
  word: string,
  ipa: string,
  definition: string,
  script: ShortScript,
  audio: AudioMixResult,
  wordId: string,
  theme: Theme,
  bgVideoPath?: string,
  captions?: CaptionWord[]
): Promise<{ videoPath: string; durationSec: number }> {
  const ffmpeg = config.paths.ffmpeg;
  const wordDir = path.join(config.paths.output, 'words', word);
  mkdirSync(wordDir, { recursive: true });
  const outputPath = path.join(wordDir, 'video.mp4');
  const duration = audio.durationSec;

  // Calculate section timing in seconds
  const timings = calculateTimings(script, duration);
  const hookEndSec = timings.hookEnd / FPS;
  const wordEndSec = timings.wordEnd / FPS;
  const ctaStartSec = timings.ctaStart / FPS;

  // Generate ASS subtitle file with animated text sections + caption overlay
  const assContent = generateASS(
    word, ipa, definition, script.hook, script.cta,
    hookEndSec, wordEndSec, ctaStartSec, duration, theme, captions
  );
  const assPath = path.join(wordDir, 'overlay.ass');
  writeFileSync(assPath, assContent);

  // FFmpeg ass filter: use relative path from cwd to avoid Windows drive-letter
  // colon escaping issues (C: gets misinterpreted in filter graph syntax)
  const assFilterPath = path.relative(process.cwd(), assPath)
    .replace(/\\/g, '/');

  log.info({ outputPath, duration, hasBgVideo: !!bgVideoPath, sections: {
    hook: `0-${hookEndSec.toFixed(1)}s`,
    word: `${hookEndSec.toFixed(1)}-${wordEndSec.toFixed(1)}s`,
    def: `${wordEndSec.toFixed(1)}-${ctaStartSec.toFixed(1)}s`,
    cta: `${ctaStartSec.toFixed(1)}-${duration.toFixed(1)}s`,
  }}, 'Rendering with FFmpeg');

  // ── Build FFmpeg command ──

  const buildArgs = (useBgVideo: boolean): string[] => {
    if (useBgVideo && bgVideoPath) {
      const resolvedBg = path.resolve(bgVideoPath);
      return [
        '-y',
        '-stream_loop', '-1',
        '-i', resolvedBg,
        '-i', path.resolve(audio.mixedAudioPath),
        '-filter_complex',
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `setpts=PTS-STARTPTS,` +
        // Dark overlay for text readability
        `drawbox=x=0:y=0:w=1080:h=1920:color=black@0.45:t=fill,` +
        `drawbox=x=0:y=0:w=1080:h=400:color=black@0.25:t=fill,` +
        `drawbox=x=0:y=1520:w=1080:h=400:color=black@0.3:t=fill,` +
        `ass=${assFilterPath}[outv]`,
        '-map', '[outv]', '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-pix_fmt', 'yuv420p',
        '-t', String(duration),
        outputPath,
      ];
    } else {
      return [
        '-y',
        '-f', 'lavfi', '-i',
        `color=c=${theme.bgColor1.replace('#', '0x')}:s=1080x1920:d=${duration}`,
        '-i', path.resolve(audio.mixedAudioPath),
        '-vf', `ass=${assFilterPath}`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', '-pix_fmt', 'yuv420p',
        outputPath,
      ];
    }
  };

  try {
    await execFileAsync(ffmpeg, buildArgs(!!bgVideoPath), {
      timeout: 180000, maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    if (bgVideoPath) {
      log.warn({ error: (err as Error).message }, 'FFmpeg with video bg failed — retrying with solid color');
      await execFileAsync(ffmpeg, buildArgs(false), {
        timeout: 120000, maxBuffer: 10 * 1024 * 1024,
      });
    } else {
      throw err;
    }
  }

  log.info({ outputPath }, 'FFmpeg render complete');
  return { videoPath: outputPath, durationSec: duration };
}
