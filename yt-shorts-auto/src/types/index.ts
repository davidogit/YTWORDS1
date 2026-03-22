// ─── Format Types ───────────────────────────────────────────────────────────

/** The content format / style of a Short */
export type ShortFormat =
  | 'word-of-the-day'   // classic: hook → word → definition → CTA
  | 'misused-word'      // "Affect vs Effect in 20 seconds"
  | 'funny-meaning'     // "The English word for someone who loves rain"
  | 'emotional-word'    // petrichor, sonder, hiraeth — feelings you couldn't name
  | 'guess-the-word';   // interactive: definition first → pause → reveal

// ─── Core pipeline interfaces ───────────────────────────────────────────────

/** Status of a word as it moves through the pipeline */
export type PipelineStatus =
  | 'discovered'
  | 'validated'
  | 'scripted'
  | 'tts_done'
  | 'audio_mixed'
  | 'rendered'
  | 'uploaded'
  | 'failed'
  | 'rejected';

/** A word candidate from discovery */
export interface WordCandidate {
  word: string;
  source: 'reddit' | 'rss' | 'fallback' | 'manual';
  sourceUrl?: string;
  subreddit?: string;
  redditScore?: number;
  discoveredAt: string; // ISO date
}

/** Dictionary lookup result */
export interface DictionaryResult {
  word: string;
  exists: boolean;
  ipa?: string;          // e.g. "/suːˈsʌɹəs/"
  definition?: string;   // One-line plain English
  partOfSpeech?: string; // noun, verb, adj, etc.
  origin?: string;       // etymology snippet
  audioUrl?: string;     // Pronunciation audio URL from API
}

/** Validation result with quality scoring */
export interface ValidationResult {
  valid: boolean;
  rejectReason?: string;
  qualityScore: number;  // 0–1: novelty + pronunciation interest
  isProfane: boolean;
  isDuplicate: boolean;
  frequencyRank?: number; // lower = more common
}

/** Generated script for the Short */
export interface ShortScript {
  hook: string;          // 2–5 s spoken hook, e.g. "Did you know there's a word for..."
  pronunciation: string; // "The word is susurrus, pronounced /suːˈsʌɹəs/"
  definition: string;    // 10–20 s simple definition with examples
  cta: string;           // 2–3 s CTA, e.g. "Follow for more fun words!"
  fullText: string;      // Concatenated script for TTS
  estimatedDuration: number; // seconds (word count / ~2.5 words per sec)
  format: ShortFormat;       // which content format this script uses
  pauseAfterHook?: boolean;  // for guess-the-word: insert a pause before reveal
  versusWord?: string;       // for misused-word: the word it's commonly confused with
}

/** A single word with timing from TTS subtitles */
export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** TTS output */
export interface TTSResult {
  audioPath: string;     // Path to .mp3/.wav voiceover file
  durationSec: number;
  engine: string;        // Which engine was used
  subtitlePath?: string; // Path to .vtt subtitle file (if generated)
  captions?: CaptionWord[]; // Word-level timing data parsed from VTT
}

/** A scheduled sound effect event */
export interface SFXEvent {
  sfxPath: string;       // Path to the SFX audio file
  startSec: number;      // When to play (seconds from start)
  volume: number;        // 0–1, typically 0.2–0.4
}

/** Audio mixing output */
export interface AudioMixResult {
  mixedAudioPath: string;
  durationSec: number;
  musicTrack: string;    // Which background track was used
}

/** The main pipeline item — passes through every stage */
export interface PipelineItem {
  id: string;             // UUID
  word: string;
  status: PipelineStatus;

  // Discovery
  source: WordCandidate['source'];
  sourceUrl?: string;
  subreddit?: string;

  // Dictionary
  ipa?: string;
  definition?: string;
  partOfSpeech?: string;

  // Validation
  qualityScore?: number;

  // Script
  hook?: string;
  script?: ShortScript;

  // Audio
  voiceoverPath?: string;
  mixedAudioPath?: string;
  musicTrack?: string;

  // Video
  videoPath?: string;
  thumbnailPath?: string;
  durationSec?: number;

  // Upload
  youtubeVideoId?: string;
  youtubeUrl?: string;
  uploadedAt?: string;

  // Meta
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/** Config shape (parsed from .env) */
export interface AppConfig {
  reddit: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    userAgent: string;
    subreddits: string[];
  };
  dictionary: {
    wordnikApiKey?: string;
  };
  tts: {
    engine: 'edge-tts' | 'coqui' | 'openai' | 'elevenlabs';
    voice: string;
    openaiVoice?: string;
    elevenLabsVoiceId?: string;
  };
  elevenlabs: {
    apiKey?: string;
  };
  pexels: {
    apiKey?: string;
  };
  openai: {
    apiKey?: string;
    baseUrl?: string;
  };
  youtube: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
    category: string;
    defaultTags: string[];
    privacy: 'public' | 'unlisted' | 'private';
  };
  paths: {
    ffmpeg: string;
    ffprobe: string;
    output: string;
    music: string;
    db: string;
  };
  content: {
    minWordLength: number;
    maxWordLength: number;
    minQualityScore: number;
  };
}

/** CLI options parsed by commander */
export interface CLIOptions {
  dryRun: boolean;
  noUpload: boolean;
  source: 'reddit' | 'rss' | 'fallback' | 'manual';
  word?: string;          // --word=susurrus to force a specific word
  verbose: boolean;
  batch: number;          // --batch=3 to produce multiple videos in one run
  schedule?: string;      // --schedule "9:10pm GMT" — ISO datetime for scheduled publish
  format?: ShortFormat;   // --format=emotional-word to force a specific format
}