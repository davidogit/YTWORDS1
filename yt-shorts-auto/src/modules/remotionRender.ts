/**
 * remotionRender.ts — Render a YouTube Short video using FFmpeg.
 *
 * Produces a vertical 1080×1920 mp4 optimized for YouTube Shorts.
 * Uses FFmpeg drawtext / ASS subtitle overlays with:
 *   - Zoom-punch captions (each spoken word pops in size as it's said)
 *   - Guess-the-word countdown dots before the word reveal
 *   - Format-aware visual styling
 *   - Optional Pexels video background
 *
 * The Remotion composition (ShortVideo.tsx) is kept for
 * `npm run remotion:preview` visual design only.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { ShortScript, AudioMixResult, CaptionWord, ShortFormat } from '../types/index.js';

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

// Format-specific theme overrides — each format has a distinct visual identity
const FORMAT_THEMES: Partial<Record<ShortFormat, Theme[]>> = {
  'emotional-word': [
    { bgColor1: '#0D001A', bgColor2: '#1F003D', accentColor: '#BF5FFF', bgStyle: 'aurora' },
    { bgColor1: '#100010', bgColor2: '#2A002A', accentColor: '#FF69B4', bgStyle: 'aurora' },
    { bgColor1: '#001505', bgColor2: '#002E0F', accentColor: '#00FF7F', bgStyle: 'aurora-particles' },
  ],
  'misused-word': [
    { bgColor1: '#1A0500', bgColor2: '#3D1000', accentColor: '#FF4500', bgStyle: 'aurora' },
    { bgColor1: '#100000', bgColor2: '#2A0000', accentColor: '#FF5252', bgStyle: 'particles' },
  ],
  'funny-meaning': [
    { bgColor1: '#001A1A', bgColor2: '#003333', accentColor: '#00E5CC', bgStyle: 'aurora-particles' },
    { bgColor1: '#050518', bgColor2: '#0F0F30', accentColor: '#4FC3F7', bgStyle: 'particles' },
  ],
  'guess-the-word': [
    { bgColor1: '#0A000A', bgColor2: '#200020', accentColor: '#E040FB', bgStyle: 'particles' },
    { bgColor1: '#0A0A2E', bgColor2: '#1A0A3E', accentColor: '#00E5FF', bgStyle: 'aurora-particles' },
  ],
};

const GENERAL_THEMES: Theme[] = [
  { bgColor1: '#0A0A2E', bgColor2: '#1A1A4E', accentColor: '#FF6B35', bgStyle: 'aurora' },
  { bgColor1: '#0D001A', bgColor2: '#1F003D', accentColor: '#BF5FFF', bgStyle: 'aurora' },
  { bgColor1: '#001A1A', bgColor2: '#003333', accentColor: '#00E5CC', bgStyle: 'aurora' },
  { bgColor1: '#1A0500', bgColor2: '#3D1000', accentColor: '#FF4500', bgStyle: 'aurora' },
  { bgColor1: '#001505', bgColor2: '#002E0F', accentColor: '#00FF7F', bgStyle: 'aurora' },
  { bgColor1: '#100010', bgColor2: '#2A002A', accentColor: '#FF69B4', bgStyle: 'aurora' },
  { bgColor1: '#050518', bgColor2: '#0F0F30', accentColor: '#4FC3F7', bgStyle: 'particles' },
  { bgColor1: '#0A000A', bgColor2: '#200020', accentColor: '#E040FB', bgStyle: 'particles' },
  { bgColor1: '#001008', bgColor2: '#002010', accentColor: '#69F0AE', bgStyle: 'particles' },
  { bgColor1: '#100000', bgColor2: '#2A0000', accentColor: '#FF5252', bgStyle: 'particles' },
  { bgColor1: '#0A0A2E', bgColor2: '#1A0A3E', accentColor: '#FF6B35', bgStyle: 'aurora-particles' },
  { bgColor1: '#0D001A', bgColor2: '#1A003A', accentColor: '#00E5FF', bgStyle: 'aurora-particles' },
];

/**
 * Pick a theme: format-specific themes take priority, then general pool.
 * Deterministic per word so the same word always looks the same on rerenders.
 */
function pickTheme(word: string, format?: ShortFormat): Theme {
  const hash = word.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const formatPool = format ? FORMAT_THEMES[format] : undefined;
  if (formatPool && formatPool.length > 0) {
    return formatPool[hash % formatPool.length];
  }
  return GENERAL_THEMES[hash % GENERAL_THEMES.length];
}

// ── Timing Calculator ──────────────────────────────────────────────────────

interface FrameTiming {
  durationInFrames: number;
  hookEnd: number;
  wordEnd: number;
  ctaStart: number;
}

function calculateTimings(script: ShortScript, audioDuration: number): FrameTiming {
  const totalFrames = Math.ceil(audioDuration * FPS);

  const hookWords = script.hook.split(/\s+/).length;
  const pronWords = script.pronunciation.split(/\s+/).length;
  const defWords = script.definition.split(/\s+/).length;
  const ctaWords = script.cta.split(/\s+/).length;
  const totalWords = hookWords + pronWords + defWords + ctaWords;

  // For guess-the-word, add 2.5s pause buffer into the hook section
  const pauseBuffer = script.pauseAfterHook ? 2.5 : 0;
  const hookSec = (hookWords / totalWords) * audioDuration + pauseBuffer;
  const pronSec = (pronWords / totalWords) * audioDuration;
  const defSec = (defWords / totalWords) * audioDuration;

  return {
    durationInFrames: totalFrames,
    hookEnd: Math.round(hookSec * FPS),
    wordEnd: Math.round((hookSec + pronSec) * FPS),
    ctaStart: Math.round((hookSec + pronSec + defSec) * FPS),
  };
}

// ── ASS Helpers ────────────────────────────────────────────────────────────

function hexToASS(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

function assTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

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

// ── ASS Generator ─────────────────────────────────────────────────────────

/**
 * Generate an ASS subtitle file with animated, styled text sections.
 *
 * New in this version:
 *   - Zoom-punch captions: each word scales up as it's spoken (\fscx\fscy via \t)
 *   - Guess-the-word countdown dots before the word reveal
 *   - Format-specific emoji in the hook section
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
  format?: ShortFormat,
): string {
  const accentASS = hexToASS(theme.accentColor);
  const whiteASS = '&H00FFFFFF&';
  const grayASS = '&H00CCCCCC&';
  const shadowASS = '&H00000000&';
  const wordDisplay = word.charAt(0).toUpperCase() + word.slice(1);

  const events: string[] = [];

  const addEvent = (start: number, end: number, style: string, text: string, layer = 0) => {
    events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);
  };

  // ── Format-specific hook emoji ──
  const hookEmoji: Record<ShortFormat, string> = {
    'word-of-the-day': '🤔',
    'misused-word':    '😬',
    'funny-meaning':   '😭',
    'emotional-word':  '💭',
    'guess-the-word':  '🧠',
  };
  const emoji = format ? hookEmoji[format] : '🤔';

  // ── Section 1: Hook ──
  const hookWrapped = wrapASS(hook, 26);
  addEvent(0.1, hookEndSec - 0.3, 'Emoji',
    `{\\an5\\pos(540,700)\\fad(300,300)\\fscx60\\fscy60\\t(100,400,\\fscx120\\fscy120)\\t(400,700,\\fscx100\\fscy100)}${emoji}`);
  addEvent(0, hookEndSec, 'Hook',
    `{\\an5\\fad(500,350)\\move(540,980,540,940)\\blur4\\t(0,400,\\blur0)}${hookWrapped}`);

  // ── Guess-the-word: countdown dots before the reveal ──
  if (format === 'guess-the-word' && hookEndSec > 2) {
    const pauseStart = hookEndSec - 2.5;
    const pauseMid1 = pauseStart + 0.8;
    const pauseMid2 = pauseStart + 1.6;
    addEvent(pauseStart, pauseMid1, 'Word',
      `{\\an5\\pos(540,960)\\fad(0,150)\\fscx130\\fscy130\\c${accentASS}}●`, 2);
    addEvent(pauseMid1, pauseMid2, 'Word',
      `{\\an5\\pos(540,960)\\fad(0,150)\\fscx130\\fscy130\\c${accentASS}}● ●`, 2);
    addEvent(pauseMid2, hookEndSec, 'Word',
      `{\\an5\\pos(540,960)\\fad(0,150)\\fscx130\\fscy130\\c${accentASS}}● ● ●`, 2);
  }

  // ── Section 2: Word reveal ──
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

  // ── Section 3: Definition ──
  addEvent(wordEndSec, ctaStartSec, 'DefLabel',
    `{\\an5\\fad(350,250)\\move(540,720,540,740)}${wordDisplay.toUpperCase()}`);
  const defLines = wrapASS(definition, 30).split('\\N');
  defLines.forEach((line, i) => {
    const staggerDelay = 0.25 + i * 0.3;
    const yPos = 830 + i * 64;
    addEvent(wordEndSec + staggerDelay, ctaStartSec, 'Definition',
      `{\\an5\\fad(400,300)\\move(540,${yPos + 20},540,${yPos})\\blur2\\t(0,350,\\blur0)}${line}`);
  });

  // ── Section 4: CTA ──
  const ctaWrapped = wrapASS(cta, 26);
  addEvent(ctaStartSec, duration, 'CTA',
    `{\\an5\\fad(400,300)\\move(540,920,540,880)}${ctaWrapped}`);
  addEvent(ctaStartSec + 0.5, duration, 'Follow',
    `{\\an5\\pos(540,1080)\\fad(300,200)\\fscx75\\fscy75` +
    `\\t(0,250,\\fscx108\\fscy108)` +
    `\\t(250,450,\\fscx100\\fscy100)}▶ FOLLOW`);

  // ── Zoom-punch caption overlay ──
  // Each spoken word scales up as it's being said, creating a
  // "fast captions" / zoom-text effect that holds retention.
  if (captions && captions.length > 0) {
    for (const cue of captions) {
      const startSec = cue.startMs / 1000;
      const endSec = cue.endMs / 1000;
      const wordTimings = splitWordsFromCue(cue);
      if (wordTimings.length === 0) continue;

      // Build karaoke + zoom-punch text
      // \K = fill sweep from left to right (karaoke)
      // \t(0,80,...) = scale up as word starts
      // \t(80,200,...) = scale back down to normal
      let karaokeText = '';
      for (const wt of wordTimings) {
        const durationCs = Math.max(1, Math.round((wt.endMs - wt.startMs) / 10));
        karaokeText +=
          `{\\K${durationCs}` +
          `\\t(0,80,\\fscx130\\fscy130)` +
          `\\t(80,220,\\fscx100\\fscy100)}` +
          `${wt.word} `;
      }

      addEvent(startSec, endSec, 'Caption',
        `{\\an2\\pos(540,1720)\\fad(100,100)}${karaokeText.trim()}`, 1);
    }
  }

  return `[Script Info]
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
Style: Caption,Arial,52,${whiteASS},${accentASS},${shadowASS},&HA0000000&,1,0,0,0,100,100,2,0,4,0,4,2,80,80,160

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}

// ── Main render entry point ────────────────────────────────────────────────

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

  const theme = pickTheme(word, script.format);
  log.info({
    word,
    format: script.format,
    theme: theme.bgStyle,
    accent: theme.accentColor,
    hasBgVideo: !!bgVideoPath,
  }, 'Selected background theme');

  // Save props for Remotion preview
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
    accentColor: theme.accentColor, bgColor1: theme.bgColor1, bgColor2: theme.bgColor2,
    bgStyle: theme.bgStyle, format: script.format,
    ...(bgVideoFilename ? { bgVideoPath: bgVideoFilename } : {}),
    ...(captions && captions.length > 0 ? { captions } : {}),
  }, null, 2));

  return renderWithFFmpeg(word, ipa, definition, script, audio, wordId, theme, bgVideoPath, captions);
}

// ── FFmpeg Render ──────────────────────────────────────────────────────────

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

  const timings = calculateTimings(script, duration);
  const hookEndSec = timings.hookEnd / FPS;
  const wordEndSec = timings.wordEnd / FPS;
  const ctaStartSec = timings.ctaStart / FPS;

  // Generate ASS subtitle file with all animations + zoom captions
  const assContent = generateASS(
    word, ipa, definition, script.hook, script.cta,
    hookEndSec, wordEndSec, ctaStartSec, duration,
    theme, captions, script.format   // ← pass format
  );
  const assPath = path.join(wordDir, 'overlay.ass');
  writeFileSync(assPath, assContent);

  const assFilterPath = path.relative(process.cwd(), assPath).replace(/\\/g, '/');

  log.info({
    outputPath, duration,
    format: script.format,
    hasBgVideo: !!bgVideoPath,
    sections: {
      hook: `0-${hookEndSec.toFixed(1)}s`,
      word: `${hookEndSec.toFixed(1)}-${wordEndSec.toFixed(1)}s`,
      def: `${wordEndSec.toFixed(1)}-${ctaStartSec.toFixed(1)}s`,
      cta: `${ctaStartSec.toFixed(1)}-${duration.toFixed(1)}s`,
    },
  }, 'Rendering with FFmpeg');

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