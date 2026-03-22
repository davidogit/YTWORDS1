// ─── Format Types ───────────────────────────────────────────────────────────

/** The content format / style of a Short */
export type ShortFormat =
  | 'word-of-the-day'   // classic: hook → word → definition → CTA
  | 'misused-word'      // "Affect vs Effect in 20 seconds"
  | 'funny-meaning'     // "The English word for someone who loves rain"
  | 'emotional-word'    // petrichor, sonder, hiraeth — feelings you couldn't name
  | 'guess-the-word'    // interactive: 4 options shown, correct reveals after pause
  | 'scrabble-word';    // board-game edge: high-value, surprising, valid Scrabble words

// ─── Quiz Option ─────────────────────────────────────────────────────────────

/** One of four definition options shown in the guess-the-word quiz card */
export interface QuizOption {
  text: string;     // The definition shown in the card
  correct: boolean; // Whether this is the correct answer
  label: string;    // 'A', 'B', 'C', or 'D'
}

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
  hook: string;          // 2–5 s spoken hook
  pronunciation: string; // "The word is susurrus."
  definition: string;    // 10–20 s simple definition
  cta: string;           // 2–3 s CTA
  fullText: string;      // Concatenated script for TTS
  estimatedDuration: number; // seconds
  format: ShortFormat;
  pauseAfterHook?: boolean;  // insert a pause before reveal (guess-the-word)
  versusWord?: string;       // for misused-word
  quizOptions?: QuizOption[]; // for guess-the-word: 4 definition options (1 correct, 3 distractors)
  scrabbleScore?: number;     // for scrabble-word: approximate Scrabble point value
}

/** A single word with timing from TTS subtitles */
export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

/** TTS output */
export interface TTSResult {
  audioPath: string;
  durationSec: number;
  engine: string;
  subtitlePath?: string;
  captions?: CaptionWord[];
}

/** A scheduled sound effect event */
export interface SFXEvent {
  sfxPath: string;
  startSec: number;
  volume: number;
}

/** Audio mixing output */
export interface AudioMixResult {
  mixedAudioPath: string;
  durationSec: number;
  musicTrack: string;
}

/** The main pipeline item */
export interface PipelineItem {
  id: string;
  word: string;
  status: PipelineStatus;
  source: WordCandidate['source'];
  sourceUrl?: string;
  subreddit?: string;
  ipa?: string;
  definition?: string;
  partOfSpeech?: string;
  qualityScore?: number;
  hook?: string;
  script?: ShortScript;
  voiceoverPath?: string;
  mixedAudioPath?: string;
  musicTrack?: string;
  videoPath?: string;
  thumbnailPath?: string;
  durationSec?: number;
  youtubeVideoId?: string;
  youtubeUrl?: string;
  uploadedAt?: string;
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
  word?: string;
  verbose: boolean;
  batch: number;
  schedule?: string;
  format?: ShortFormat;
}