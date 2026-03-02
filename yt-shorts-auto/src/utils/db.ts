import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { moduleLogger } from './logger.js';
import type { PipelineItem, PipelineStatus } from '../types/index.js';

const log = moduleLogger('db');

// ── Initialize DB ──────────────────────────────────────────────────────────

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.paths.db);
    db.pragma('journal_mode = WAL'); // Better concurrent read performance
    initSchema();
    log.info({ path: config.paths.db }, 'Database connected');
  }
  return db;
}

function initSchema() {
  getDbRaw().exec(`
    CREATE TABLE IF NOT EXISTS words (
      id          TEXT PRIMARY KEY,
      word        TEXT NOT NULL UNIQUE,
      status      TEXT NOT NULL DEFAULT 'discovered',
      source      TEXT NOT NULL,           -- 'reddit' | 'fallback' | 'manual'
      source_url  TEXT,
      subreddit   TEXT,
      ipa         TEXT,
      definition  TEXT,
      part_of_speech TEXT,
      quality_score REAL,
      hook        TEXT,
      script_json TEXT,                    -- Full ShortScript as JSON
      voiceover_path TEXT,
      mixed_audio_path TEXT,
      music_track TEXT,
      video_path  TEXT,
      thumbnail_path TEXT,
      duration_sec REAL,
      youtube_video_id TEXT,
      youtube_url TEXT,
      uploaded_at TEXT,
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
    CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
    CREATE INDEX IF NOT EXISTS idx_words_created ON words(created_at);
  `);
}

/** Direct access for schema init (avoids circular getDb call) */
function getDbRaw(): Database.Database {
  if (!db) db = new Database(config.paths.db);
  return db;
}

// ── Deduplication ──────────────────────────────────────────────────────────

/** Check if a word has already been used or is in the pipeline */
export function isDuplicate(word: string): boolean {
  const row = getDb()
    .prepare('SELECT id FROM words WHERE LOWER(word) = LOWER(?)')
    .get(word);
  return !!row;
}

// ── CRUD Operations ────────────────────────────────────────────────────────

/** Insert a new word into the pipeline */
export function insertWord(
  word: string,
  source: string,
  sourceUrl?: string,
  subreddit?: string
): PipelineItem {
  const id = randomUUID();
  const now = new Date().toISOString();

  getDb().prepare(`
    INSERT INTO words (id, word, source, source_url, subreddit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, word.toLowerCase(), source, sourceUrl ?? null, subreddit ?? null, now, now);

  log.info({ id, word, source }, 'Word inserted');
  return {
    id, word: word.toLowerCase(), status: 'discovered', source: source as any,
    sourceUrl, subreddit, createdAt: now, updatedAt: now,
  };
}

/** Update a pipeline item's status and fields */
export function updateWord(id: string, updates: Partial<Record<string, any>>) {
  const setClauses: string[] = ['updated_at = datetime(\'now\')'];
  const values: any[] = [];

  // Map camelCase to snake_case for DB columns
  const keyMap: Record<string, string> = {
    status: 'status', ipa: 'ipa', definition: 'definition',
    partOfSpeech: 'part_of_speech', qualityScore: 'quality_score',
    hook: 'hook', script: 'script_json', voiceoverPath: 'voiceover_path',
    mixedAudioPath: 'mixed_audio_path', musicTrack: 'music_track',
    videoPath: 'video_path', thumbnailPath: 'thumbnail_path',
    durationSec: 'duration_sec', youtubeVideoId: 'youtube_video_id',
    youtubeUrl: 'youtube_url', uploadedAt: 'uploaded_at', error: 'error',
  };

  for (const [key, val] of Object.entries(updates)) {
    const col = keyMap[key];
    if (!col) continue;
    // Serialize objects to JSON
    const dbVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : val;
    setClauses.push(`${col} = ?`);
    values.push(dbVal);
  }

  values.push(id);
  getDb().prepare(`UPDATE words SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

/** Get a word by ID */
export function getWordById(id: string): PipelineItem | undefined {
  const row = getDb().prepare('SELECT * FROM words WHERE id = ?').get(id) as any;
  return row ? rowToItem(row) : undefined;
}

/** Get recent words by status */
export function getWordsByStatus(status: PipelineStatus, limit = 50): PipelineItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM words WHERE status = ? ORDER BY created_at DESC LIMIT ?')
    .all(status, limit) as any[];
  return rows.map(rowToItem);
}

/** Get statistics */
export function getStats() {
  return getDb().prepare(`
    SELECT status, COUNT(*) as count FROM words GROUP BY status
  `).all();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function rowToItem(row: any): PipelineItem {
  return {
    id: row.id,
    word: row.word,
    status: row.status,
    source: row.source,
    sourceUrl: row.source_url,
    subreddit: row.subreddit,
    ipa: row.ipa,
    definition: row.definition,
    partOfSpeech: row.part_of_speech,
    qualityScore: row.quality_score,
    hook: row.hook,
    script: row.script_json ? JSON.parse(row.script_json) : undefined,
    voiceoverPath: row.voiceover_path,
    mixedAudioPath: row.mixed_audio_path,
    musicTrack: row.music_track,
    videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path,
    durationSec: row.duration_sec,
    youtubeVideoId: row.youtube_video_id,
    youtubeUrl: row.youtube_url,
    uploadedAt: row.uploaded_at,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Close the database connection */
export function closeDb() {
  if (db) db.close();
}
