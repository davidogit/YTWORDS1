/**
 * remotionRender.ts — Render a YouTube Short using FFmpeg + ASS subtitles.
 *
 * BACKGROUND SYSTEM (this version):
 *   Primary:  Pexels stock video (when PEXELS_API_KEY is set and a match is found)
 *   Fallback: Animated FFmpeg background generated via the `geq` filter —
 *             no extra files, no pre-rendered video, adds ~30–90s to render time.
 *
 *   Three animated styles, each mapped to formats by feel:
 *     gradient-sweep  — two theme colours slowly blending across a diagonal wave
 *                       → guess-the-word, funny-meaning
 *     radial-pulse    — breathing glow bloom from the screen centre
 *                       → misused-word, scrabble-word
 *     aurora-wave     — interference pattern of crossed sine waves (organic, shifting)
 *                       → emotional-word, word-of-the-day
 *
 * CAPTION SIZE: 74px (was 58px)
 *
 * All other retention improvements from the previous version are retained:
 *   128px word reveal, 135% scale punch, quiz card layout, scrabble badge, etc.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import { moduleLogger } from '../utils/logger.js';
import type { ShortScript, AudioMixResult, CaptionWord, ShortFormat, QuizOption } from '../types/index.js';

const execFileAsync = promisify(execFile);
const log = moduleLogger('render');

const FPS = 30;

// ── Colour helpers ─────────────────────────────────────────────────────────

function hexToRGB(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function hexToASS(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

function hexToASSBg(hex: string, alpha = 0x88): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  const a = alpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}&`.toUpperCase();
}

// ── Animated Background Generators ────────────────────────────────────────
//
// Each function returns a string suitable for: -f lavfi -i "STRING"
// All use FFmpeg's `geq` filter which evaluates a per-pixel expression
// with variables: X, Y (pixel coords), T (time in seconds), W, H (dims).
//
// Performance note: geq is multi-threaded in FFmpeg but still CPU-heavy.
// Expected render overhead vs solid colour:
//   gradient-sweep : +15–30s  (simple trig per pixel)
//   radial-pulse   : +20–40s  (Chebyshev distance, no sqrt)
//   aurora-wave    : +40–90s  (interference pattern, 4 trig calls/pixel)
//
// All expressions use Chebyshev distance (max of abs differences) instead
// of Euclidean (sqrt) to keep render times acceptable.

/**
 * Gradient sweep — two colours blending across a slow diagonal sine wave.
 * Period: ~10 seconds. The wave travels top-left → bottom-right.
 */
function gradientSweepBg(bg1: string, bg2: string, duration: number): string {
  const [r1, g1, b1] = hexToRGB(bg1);
  const [r2, g2, b2] = hexToRGB(bg2);

  // phase oscillates 0→1 across the frame + time, creating the sweep
  const phase = `(0.5+0.5*sin(2*PI*(X/1080+Y/1920*0.55+T/10)))`;
  const ch = (c1: number, c2: number) =>
    `clip(${c1}+(${c2 - c1})*${phase},0,255)`;

  return [
    `color=c=black:s=1080x1920:d=${duration}:r=30`,
    `format=rgb24`,
    `geq=r='${ch(r1, r2)}':g='${ch(g1, g2)}':b='${ch(b1, b2)}'`,
    `format=yuv420p`,
  ].join(',');
}

/**
 * Radial pulse — a breathing glow bloom centred on the screen.
 * Uses Chebyshev distance (no sqrt) for fast per-pixel evaluation.
 * Pulse period: ~2.5 seconds.
 */
function radialPulseBg(bg: string, accent: string, duration: number): string {
  const [br, bgc, bb] = hexToRGB(bg);
  const [ar, ag, ab]  = hexToRGB(accent);

  // Chebyshev distance from centre, normalised to 0 (centre) → 1 (edge)
  const dist  = `max(abs(X-540)/540,abs(Y-960)/960)`;
  // Glow intensity: stronger at centre, breathes with sin(T)
  const pulse = `(max(0,1-${dist})*(0.10+0.22*sin(2*PI*T/2.5)))`;

  const ch = (base: number, ac: number) =>
    `clip(${base}+${ac}*${pulse},0,255)`;

  return [
    `color=c=black:s=1080x1920:d=${duration}:r=30`,
    `format=rgb24`,
    `geq=r='${ch(br, ar)}':g='${ch(bgc, ag)}':b='${ch(bb, ab)}'`,
    `format=yuv420p`,
  ].join(',');
}

/**
 * Aurora wave — two crossed sine waves create an organic shifting pattern.
 * Mimics the soft, drifting quality of an aurora without blobs or sqrt.
 * The pattern never cleanly loops, which keeps it feeling alive.
 */
function auroraWaveBg(bg: string, accent: string, duration: number): string {
  const [br, bgc, bb] = hexToRGB(bg);
  const [ar, ag, ab]  = hexToRGB(accent);

  // Two interference patterns at different spatial/temporal frequencies
  const w1 = `sin(2*PI*(X/560+T/9))`;
  const w2 = `cos(2*PI*(Y/800-T/13+0.5))`;
  const w3 = `sin(2*PI*(X/410-T/7+1.2))*cos(2*PI*(Y/640+T/11))`;

  // Combined wave: range approx -1 to 1, scaled to a gentle glow
  const wave = `((${w1}*${w2}+${w3})*0.5)`;
  // Glow: bias above zero so background stays mostly dark
  const glow = `max(0,0.14+${wave}*0.13)`;

  const ch = (base: number, ac: number) =>
    `clip(${base}+${ac}*${glow},0,255)`;

  return [
    `color=c=black:s=1080x1920:d=${duration}:r=30`,
    `format=rgb24`,
    `geq=r='${ch(br, ar)}':g='${ch(bgc, ag)}':b='${ch(bb, ab)}'`,
    `format=yuv420p`,
  ].join(',');
}

// ── Format → background style mapping ─────────────────────────────────────

type AnimBgStyle = 'gradient' | 'radial' | 'aurora';

function bgStyleForFormat(format?: ShortFormat): AnimBgStyle {
  switch (format) {
    case 'emotional-word':  return 'aurora';    // organic, emotional
    case 'word-of-the-day': return 'aurora';    // interesting, varied
    case 'misused-word':    return 'radial';    // urgent, centred energy
    case 'scrabble-word':   return 'radial';    // focused, competitive
    case 'guess-the-word':  return 'gradient';  // clean sweep, game-show feel
    case 'funny-meaning':   return 'gradient';  // playful, flowing
    default:                return 'aurora';
  }
}

function buildAnimatedBg(theme: Theme, format: ShortFormat | undefined, duration: number): string {
  const style = bgStyleForFormat(format);
  switch (style) {
    case 'gradient': return gradientSweepBg(theme.bgColor1, theme.bgColor2, duration);
    case 'radial':   return radialPulseBg(theme.bgColor1, theme.accentColor, duration);
    case 'aurora':   return auroraWaveBg(theme.bgColor1, theme.accentColor, duration);
  }
}

// ── Theme Catalogue ────────────────────────────────────────────────────────

interface Theme {
  bgColor1: string;
  bgColor2: string;
  accentColor: string;
}

const FORMAT_THEMES: Partial<Record<ShortFormat, Theme[]>> = {
  'emotional-word': [
    { bgColor1: '#080010', bgColor2: '#14002A', accentColor: '#C44DFF' },
    { bgColor1: '#080010', bgColor2: '#200010', accentColor: '#FF4DA6' },
  ],
  'misused-word': [
    { bgColor1: '#0F0300', bgColor2: '#2A0800', accentColor: '#FF4500' },
    { bgColor1: '#0F0000', bgColor2: '#280000', accentColor: '#FF2D2D' },
  ],
  'funny-meaning': [
    { bgColor1: '#001518', bgColor2: '#002830', accentColor: '#00E5CC' },
    { bgColor1: '#020018', bgColor2: '#070030', accentColor: '#4FBAFF' },
  ],
  'guess-the-word': [
    { bgColor1: '#070010', bgColor2: '#18002A', accentColor: '#E040FB' },
    { bgColor1: '#040018', bgColor2: '#0A0030', accentColor: '#00E5FF' },
  ],
  'scrabble-word': [
    { bgColor1: '#001A08', bgColor2: '#003010', accentColor: '#39FF14' },
    { bgColor1: '#1A1400', bgColor2: '#2E2400', accentColor: '#FFD700' },
  ],
};

const GENERAL_THEMES: Theme[] = [
  { bgColor1: '#07071C', bgColor2: '#12123A', accentColor: '#FF6B35' },
  { bgColor1: '#080010', bgColor2: '#14002A', accentColor: '#C44DFF' },
  { bgColor1: '#001518', bgColor2: '#002830', accentColor: '#00E5CC' },
  { bgColor1: '#0F0300', bgColor2: '#2A0800', accentColor: '#FF4500' },
  { bgColor1: '#080010', bgColor2: '#200010', accentColor: '#FF4DA6' },
  { bgColor1: '#040018', bgColor2: '#0A0030', accentColor: '#00E5FF' },
  { bgColor1: '#060010', bgColor2: '#140028', accentColor: '#7B61FF' },
  { bgColor1: '#001000', bgColor2: '#002000', accentColor: '#39FF14' },
];

function pickTheme(word: string, format?: ShortFormat): Theme {
  const hash = word.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const pool = format ? FORMAT_THEMES[format] : undefined;
  if (pool && pool.length > 0) return pool[hash % pool.length];
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
  const hookWords   = script.hook.split(/\s+/).length;
  const pronWords   = script.pronunciation.split(/\s+/).length;
  const defWords    = script.definition.split(/\s+/).length;
  const ctaWords    = script.cta.split(/\s+/).length;
  const totalWords  = hookWords + pronWords + defWords + ctaWords;
  const pauseBuffer = script.pauseAfterHook ? 2.0 : 0;
  const hookSec     = (hookWords / totalWords) * audioDuration + pauseBuffer;
  const pronSec     = (pronWords / totalWords) * audioDuration;
  const defSec      = (defWords  / totalWords) * audioDuration;

  return {
    durationInFrames: totalFrames,
    hookEnd:  Math.round(hookSec * FPS),
    wordEnd:  Math.round((hookSec + pronSec) * FPS),
    ctaStart: Math.round((hookSec + pronSec + defSec) * FPS),
  };
}

// ── ASS Helpers ────────────────────────────────────────────────────────────

function assTime(sec: number): string {
  const h  = Math.floor(sec / 3600);
  const m  = Math.floor((sec % 3600) / 60);
  const s  = sec % 60;
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function wrapASS(text: string, maxChars: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > maxChars && line) { lines.push(line); line = w; }
    else { line = line ? `${line} ${w}` : w; }
  }
  if (line) lines.push(line);
  return lines.join('\\N');
}

function splitWordsFromCue(cue: CaptionWord): Array<{ word: string; startMs: number; endMs: number }> {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length === 1) return [{ word: words[0], startMs: cue.startMs, endMs: cue.endMs }];
  const totalChars = words.reduce((s, w) => s + w.length, 0);
  const totalMs    = cue.endMs - cue.startMs;
  const result: Array<{ word: string; startMs: number; endMs: number }> = [];
  let cursor = cue.startMs;
  for (let i = 0; i < words.length; i++) {
    const wordMs = Math.round((words[i].length / totalChars) * totalMs);
    result.push({ word: words[i], startMs: cursor, endMs: i === words.length - 1 ? cue.endMs : cursor + wordMs });
    cursor += wordMs;
  }
  return result;
}

// ── Shared caption events builder ──────────────────────────────────────────
// Captions: 74px (up from 58px), same zoom-punch behaviour

function buildCaptionEvents(
  captions: CaptionWord[] | undefined,
  accentASS: string,
  yPos: number,
): string[] {
  if (!captions || captions.length === 0) return [];
  const events: string[] = [];

  for (const cue of captions) {
    const startSec = cue.startMs / 1000;
    const endSec   = cue.endMs   / 1000;
    const wt = splitWordsFromCue(cue);
    if (wt.length === 0) continue;
    let kara = '';
    for (const w of wt) {
      const cs = Math.max(1, Math.round((w.endMs - w.startMs) / 10));
      kara += `{\\K${cs}\\t(0,60,\\fscx140\\fscy140)\\t(60,200,\\fscx100\\fscy100)}${w.word} `;
    }
    events.push(`Dialogue: 1,${assTime(startSec)},${assTime(endSec)},Caption,,0,0,0,,{\\an2\\pos(540,${yPos})\\fad(80,80)}${kara.trim()}`);
  }
  return events;
}

// Caption style line — 74px, bold, dark pill background
function captionStyleLine(accentASS: string, whiteASS: string): string {
  return `Style: Caption,Arial,74,${whiteASS},${accentASS},&H00000000&,&H99000000&,1,0,0,0,100,100,2,0,4,0,4,2,80,80,120`;
}

// ── Quiz Card ASS ──────────────────────────────────────────────────────────

function generateQuizASS(
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
  quizOptions: QuizOption[],
  captions?: CaptionWord[],
): string {
  const accentASS   = hexToASS(theme.accentColor);
  const whiteASS    = '&H00FFFFFF&';
  const dimASS      = '&H00777777&';
  const shadowASS   = '&H00000000&';
  const darkBoxBg   = '&HAA000000&';
  const accentBoxBg = hexToASSBg(theme.accentColor, 0xAA);
  const wrongBoxBg  = '&HDD080808&';
  const wordDisplay = word.charAt(0).toUpperCase() + word.slice(1);
  const optionYs    = [820, 1000, 1180, 1360];

  const lines: string[] = [];
  const add = (start: number, end: number, style: string, text: string, layer = 0) =>
    lines.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);

  // Word (top, large)
  add(0, wordEndSec, 'QuizWord',
    `{\\an5\\pos(540,480)\\fad(100,250)\\fscx60\\fscy60\\blur3` +
    `\\t(0,180,\\fscx115\\fscy115\\blur0)\\t(180,320,\\fscx100\\fscy100)}${wordDisplay}`);

  if (ipa) {
    add(0.3, hookEndSec, 'QuizIPA', `{\\an5\\pos(540,570)\\fad(200,200)}${ipa}`);
  }

  // Question prompt
  add(0.4, hookEndSec, 'QuizQ', `{\\an5\\pos(540,660)\\fad(300,200)}${wrapASS(hook, 30)}`);

  // Option cards — pre-reveal
  quizOptions.forEach((opt, i) => {
    const y = optionYs[i];
    add(0.5 + i * 0.18, hookEndSec, 'QuizOpt',
      `{\\an5\\pos(540,${y})\\fad(250,0)\\bord0}${wrapASS(`${opt.label}  ${opt.text}`, 32)}`);
  });

  // Option cards — post-reveal
  quizOptions.forEach((opt, i) => {
    const y    = optionYs[i];
    const text = wrapASS(`${opt.label}  ${opt.text}`, 32);
    if (opt.correct) {
      add(hookEndSec, wordEndSec, 'QuizOptCorrect',
        `{\\an5\\pos(540,${y})\\fad(0,200)` +
        `\\fscx95\\fscy95\\t(0,150,\\fscx108\\fscy108)\\t(150,280,\\fscx100\\fscy100)}${text}`);
    } else {
      add(hookEndSec, wordEndSec, 'QuizOptWrong',
        `{\\an5\\pos(540,${y})\\fad(0,200)}${text}`);
    }
  });

  // Tick on correct answer
  const correctIdx = quizOptions.findIndex((o) => o.correct);
  if (correctIdx >= 0) {
    add(hookEndSec + 0.15, wordEndSec, 'QuizTick',
      `{\\an4\\pos(68,${optionYs[correctIdx]})\\fad(0,200)` +
      `\\fscx80\\fscy80\\t(0,180,\\fscx110\\fscy110)\\t(180,300,\\fscx100\\fscy100)}✓`);
  }

  // Full definition after reveal
  add(wordEndSec, ctaStartSec, 'Definition',
    `{\\an5\\fad(300,200)\\move(540,960,540,940)}${wrapASS(definition, 28)}`);

  // CTA
  add(ctaStartSec, duration, 'CTA',
    `{\\an5\\fad(350,250)\\move(540,920,540,890)}${wrapASS(cta, 24)}`);
  add(ctaStartSec + 0.4, duration, 'Follow',
    `{\\an5\\pos(540,1060)\\fad(250,200)\\fscx65\\fscy65` +
    `\\t(0,220,\\fscx105\\fscy105)\\t(220,380,\\fscx100\\fscy100)}▶ FOLLOW`);

  // Captions — 74px, positioned lower to not clash with quiz options
  lines.push(...buildCaptionEvents(captions, accentASS, 1800));

  return `[Script Info]
Title: ${word} - Quiz
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: QuizWord,Arial,112,${accentASS},${accentASS},${shadowASS},&H90000000&,1,0,0,0,100,100,2,0,1,5,4,5,40,40,60
Style: QuizIPA,Arial,30,&H00AAAAAA&,${accentASS},${shadowASS},&H60000000&,0,0,0,0,100,100,1,0,1,2,1,5,40,40,0
Style: QuizQ,Arial,40,${whiteASS},${whiteASS},${shadowASS},&H88000000&,0,0,0,0,100,100,0,0,1,2,2,5,60,60,0
Style: QuizOpt,Arial,34,${whiteASS},${whiteASS},${shadowASS},${darkBoxBg},1,0,0,0,100,100,1,0,3,0,0,5,80,80,0
Style: QuizOptCorrect,Arial,34,${whiteASS},${whiteASS},${shadowASS},${accentBoxBg},1,0,0,0,100,100,1,0,3,0,0,5,80,80,0
Style: QuizOptWrong,Arial,34,${dimASS},${dimASS},${shadowASS},${wrongBoxBg},0,0,0,0,100,100,1,0,3,0,0,5,80,80,0
Style: QuizTick,Arial,42,${accentASS},${accentASS},${shadowASS},&H00000000&,1,0,0,0,100,100,0,0,1,0,0,4,60,60,0
Style: Definition,Arial,44,${whiteASS},${whiteASS},${shadowASS},&H85000000&,0,0,0,0,100,100,0,0,1,3,2,5,70,70,0
Style: CTA,Arial,52,${whiteASS},${whiteASS},${shadowASS},&H85000000&,1,0,0,0,100,100,0,0,1,3,2,5,70,70,0
Style: Follow,Arial,44,${accentASS},${accentASS},${shadowASS},&H90000000&,1,0,0,0,100,100,2,0,3,3,1,2,70,70,360
${captionStyleLine(accentASS, whiteASS)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

// ── Standard ASS ──────────────────────────────────────────────────────────

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
  scrabbleScore?: number,
): string {
  const accentASS = hexToASS(theme.accentColor);
  const whiteASS  = '&H00FFFFFF&';
  const grayASS   = '&H00AAAAAA&';
  const shadowASS = '&H00000000&';
  const wordDisplay = word.charAt(0).toUpperCase() + word.slice(1);

  const lines: string[] = [];
  const add = (start: number, end: number, style: string, text: string, layer = 0) =>
    lines.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`);

  // Hook
  add(0, hookEndSec, 'Hook',
    `{\\an5\\fad(200,250)\\move(540,960,540,930)}${wrapASS(hook, 24)}`);

  // Guess-the-word countdown (no quiz options)
  if (format === 'guess-the-word' && hookEndSec > 2) {
    const p0 = hookEndSec - 2.0;
    add(p0,         hookEndSec - 1.3, 'Word', `{\\an5\\pos(540,960)\\fad(0,100)\\c${accentASS}}●`, 2);
    add(hookEndSec - 1.3, hookEndSec - 0.6, 'Word', `{\\an5\\pos(540,960)\\fad(0,100)\\c${accentASS}}● ●`, 2);
    add(hookEndSec - 0.6, hookEndSec,        'Word', `{\\an5\\pos(540,960)\\fad(0,100)\\c${accentASS}}● ● ●`, 2);
  }

  // Word reveal — 128px, hard scale punch
  add(hookEndSec, wordEndSec, 'Word',
    `{\\an5\\pos(540,880)\\fad(80,250)\\fscx60\\fscy60\\blur4` +
    `\\t(0,180,\\fscx135\\fscy135\\blur0)\\t(180,350,\\fscx100\\fscy100)}${wordDisplay}`);

  // Accent bar
  add(hookEndSec + 0.1, wordEndSec, 'AccentBar',
    `{\\an5\\pos(540,950)\\fad(150,200)\\fscx0\\t(150,400,\\fscx100)}▬▬▬▬▬`);

  // IPA
  if (ipa) {
    add(hookEndSec + 0.3, wordEndSec, 'IPA',
      `{\\an5\\pos(540,1000)\\fad(200,200)}${ipa}`);
  }

  // Scrabble score badge
  if (format === 'scrabble-word' && scrabbleScore) {
    add(hookEndSec + 0.4, wordEndSec, 'ScrabbleBadge',
      `{\\an5\\pos(540,1068)\\fad(300,200)\\fscx80\\fscy80\\t(0,200,\\fscx100\\fscy100)}` +
      `{\\c${accentASS}}${scrabbleScore} pts`);
  }

  // Definition
  add(wordEndSec, ctaStartSec, 'Definition',
    `{\\an5\\fad(300,200)\\move(540,960,540,940)}${wrapASS(definition, 28)}`);

  // CTA
  add(ctaStartSec, duration, 'CTA',
    `{\\an5\\fad(350,250)\\move(540,920,540,890)}${wrapASS(cta, 24)}`);
  add(ctaStartSec + 0.4, duration, 'Follow',
    `{\\an5\\pos(540,1060)\\fad(250,200)\\fscx65\\fscy65` +
    `\\t(0,220,\\fscx105\\fscy105)\\t(220,380,\\fscx100\\fscy100)}▶ FOLLOW`);

  // Captions — 74px
  lines.push(...buildCaptionEvents(captions, accentASS, 1740));

  return `[Script Info]
Title: ${word}
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,Arial,58,${whiteASS},${whiteASS},${shadowASS},&H80000000&,1,0,0,0,100,100,0,0,1,3,2,5,70,70,0
Style: Word,Arial,128,${accentASS},${accentASS},${shadowASS},&H90000000&,1,0,0,0,100,100,2,0,1,5,4,5,40,40,60
Style: AccentBar,Arial,24,${accentASS},${accentASS},&H00000000&,&H00000000&,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0
Style: IPA,Arial,32,${grayASS},${accentASS},${shadowASS},&H60000000&,0,0,0,0,100,100,1,0,1,2,1,5,40,40,0
Style: ScrabbleBadge,Arial,40,${accentASS},${accentASS},${shadowASS},&H88000000&,1,0,0,0,100,100,1,0,1,2,1,5,40,40,0
Style: Definition,Arial,44,${whiteASS},${whiteASS},${shadowASS},&H85000000&,0,0,0,0,100,100,0,0,1,3,2,5,70,70,0
Style: CTA,Arial,52,${whiteASS},${whiteASS},${shadowASS},&H85000000&,1,0,0,0,100,100,0,0,1,3,2,5,70,70,0
Style: Follow,Arial,44,${accentASS},${accentASS},${shadowASS},&H90000000&,1,0,0,0,100,100,2,0,3,3,1,2,70,70,360
${captionStyleLine(accentASS, whiteASS)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
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

  const theme   = pickTheme(word, script.format);
  const timings = calculateTimings(script, audio.durationSec);
  const bgStyle = bgStyleForFormat(script.format);

  log.info({
    word,
    format:   script.format,
    accent:   theme.accentColor,
    bgStyle,
    pexels:   !!bgVideoPath,
    hasQuiz:  !!(script.quizOptions?.length),
  }, 'Rendering video');

  // Save Remotion preview props
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
    bgStyle, format: script.format,
    ...(bgVideoFilename    ? { bgVideoPath: bgVideoFilename }      : {}),
    ...(captions?.length   ? { captions }                          : {}),
    ...(script.quizOptions ? { quizOptions: script.quizOptions }   : {}),
    ...(script.scrabbleScore ? { scrabbleScore: script.scrabbleScore } : {}),
  }, null, 2));

  return renderWithFFmpeg(word, ipa, definition, script, audio, theme, bgVideoPath, captions);
}

// ── FFmpeg Render ──────────────────────────────────────────────────────────

async function renderWithFFmpeg(
  word: string,
  ipa: string,
  definition: string,
  script: ShortScript,
  audio: AudioMixResult,
  theme: Theme,
  bgVideoPath?: string,
  captions?: CaptionWord[]
): Promise<{ videoPath: string; durationSec: number }> {
  const ffmpeg  = config.paths.ffmpeg;
  const wordDir = path.join(config.paths.output, 'words', word);
  mkdirSync(wordDir, { recursive: true });

  const outputPath = path.join(wordDir, 'video.mp4');
  const duration   = audio.durationSec;
  const timings    = calculateTimings(script, duration);
  const hookEndSec  = timings.hookEnd  / FPS;
  const wordEndSec  = timings.wordEnd  / FPS;
  const ctaStartSec = timings.ctaStart / FPS;

  const hasQuiz = script.format === 'guess-the-word'
    && Array.isArray(script.quizOptions)
    && script.quizOptions.length === 4;

  const assContent = hasQuiz
    ? generateQuizASS(word, ipa, definition, script.hook, script.cta, hookEndSec, wordEndSec, ctaStartSec, duration, theme, script.quizOptions!, captions)
    : generateASS(word, ipa, definition, script.hook, script.cta, hookEndSec, wordEndSec, ctaStartSec, duration, theme, captions, script.format, script.scrabbleScore);

  const assPath       = path.join(wordDir, 'overlay.ass');
  const assFilterPath = path.relative(process.cwd(), assPath).replace(/\\/g, '/');
  writeFileSync(assPath, assContent);

  // ── Pexels video (primary) ───────────────────────────────────────────────
  // Darkened overlay + ASS on top of the stock video
  if (bgVideoPath) {
    const videoArgs = [
      '-y',
      '-stream_loop', '-1',
      '-i', path.resolve(bgVideoPath),
      '-i', path.resolve(audio.mixedAudioPath),
      '-filter_complex',
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setpts=PTS-STARTPTS,` +
        `drawbox=x=0:y=0:w=1080:h=1920:color=black@0.52:t=fill,` +
        `ass=${assFilterPath}[outv]`,
      '-map', '[outv]',
      '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-pix_fmt', 'yuv420p',
      '-t', String(duration),
      outputPath,
    ];

    try {
      await execFileAsync(ffmpeg, videoArgs, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
      log.info({ outputPath, bg: 'pexels' }, 'Render complete');
      return { videoPath: outputPath, durationSec: duration };
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'Pexels video render failed — falling back to animated bg');
      // fall through to animated background
    }
  }

  // ── Animated background (fallback) ──────────────────────────────────────
  // Uses geq filter — see performance notes at top of file
  const animatedSource = buildAnimatedBg(theme, script.format, duration);
  const bgStyle        = bgStyleForFormat(script.format);

  log.info({ word, bgStyle, accent: theme.accentColor }, 'Rendering animated background');

  const animArgs = [
    '-y',
    '-f', 'lavfi',
    '-i', animatedSource,
    '-i', path.resolve(audio.mixedAudioPath),
    '-filter_complex',
      `[0:v]ass=${assFilterPath}[outv]`,
    '-map', '[outv]',
    '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-pix_fmt', 'yuv420p',
    outputPath,
  ];

  try {
    await execFileAsync(ffmpeg, animArgs, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    log.info({ outputPath, bg: bgStyle }, 'Render complete');
  } catch (err) {
    // Final fallback: plain solid colour — always works, 0 overhead
    log.warn({ error: (err as Error).message }, 'Animated bg failed — using solid colour fallback');
    const solidArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=${theme.bgColor1.replace('#', '0x')}:s=1080x1920:d=${duration}:r=30`,
      '-i', path.resolve(audio.mixedAudioPath),
      '-vf', `ass=${assFilterPath}`,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-pix_fmt', 'yuv420p',
      outputPath,
    ];
    await execFileAsync(ffmpeg, solidArgs, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    log.info({ outputPath, bg: 'solid-fallback' }, 'Render complete');
  }

  return { videoPath: outputPath, durationSec: duration };
}