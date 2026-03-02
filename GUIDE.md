# GUIDE.md — Complete Implementation Guide

## C. Scripts & CLI

### package.json scripts

| Script | Description |
|---|---|
| `npm run produce` | Full pipeline: discover → validate → script → TTS → mix → render → upload |
| `npm run produce:dry` | Stop after script generation (no TTS/render/upload) |
| `npm run produce:no-upload` | Render but don't upload |
| `npm run produce:word` | Use "susurrus" as a demo |
| `npm run setup:oauth` | Interactive YouTube OAuth2 token setup |
| `npm run remotion:preview` | Preview Remotion composition in browser |
| `npm test` | Run vitest suite |

### CLI flags

```bash
npm run produce -- --dry-run           # Stop before TTS
npm run produce -- --no-upload         # Stop before YouTube upload
npm run produce -- --word=petrichor    # Use specific word
npm run produce -- --source=fallback   # Skip Reddit
npm run produce -- --verbose           # Debug logging
```

### .env.example
All required environment variables are listed in `.env.example` with comments. Required for minimum viable operation:

```
REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
TTS_ENGINE=edge-tts, TTS_VOICE=en-US-GuyNeural
YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (from setup:oauth)
```

---

## D. DB Schema & Access Patterns

### SQLite Schema (auto-created on first run)

```sql
CREATE TABLE words (
  id              TEXT PRIMARY KEY,          -- UUID
  word            TEXT NOT NULL UNIQUE,       -- Lowercase word (dedup key)
  status          TEXT NOT NULL DEFAULT 'discovered',
  source          TEXT NOT NULL,              -- 'reddit' | 'fallback' | 'manual'
  source_url      TEXT,
  subreddit       TEXT,
  ipa             TEXT,                       -- e.g. "/suːˈsʌɹəs/"
  definition      TEXT,
  part_of_speech  TEXT,
  quality_score   REAL,                       -- 0–1 quality rating
  hook            TEXT,
  script_json     TEXT,                       -- Full ShortScript as JSON
  voiceover_path  TEXT,
  mixed_audio_path TEXT,
  music_track     TEXT,
  video_path      TEXT,
  thumbnail_path  TEXT,
  duration_sec    REAL,
  youtube_video_id TEXT,
  youtube_url     TEXT,
  uploaded_at     TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX idx_words_status ON words(status);
CREATE INDEX idx_words_word ON words(word);
CREATE INDEX idx_words_created ON words(created_at);
```

### Common Access Patterns

```typescript
// Check for duplicates (used before inserting any new word)
isDuplicate(word: string): boolean
// → SELECT id FROM words WHERE LOWER(word) = LOWER(?)

// Insert a new word at 'discovered' stage
insertWord(word, source, sourceUrl?, subreddit?): PipelineItem
// → INSERT INTO words (id, word, source, ...) VALUES (...)

// Update status and fields as word progresses through pipeline
updateWord(id, { status: 'validated', ipa, definition, ... })
// → UPDATE words SET status=?, ipa=?, ... WHERE id=?

// Get pipeline statistics
getStats()
// → SELECT status, COUNT(*) FROM words GROUP BY status

// Get words by status (for debugging / monitoring)
getWordsByStatus('failed', 50): PipelineItem[]
```

---

## E. Example Pipeline Item — "susurrus"

This JSON represents a word after completing the full pipeline:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "word": "susurrus",
  "status": "uploaded",
  "source": "reddit",
  "sourceUrl": "https://reddit.com/r/logophilia/comments/abc123/susurrus/",
  "subreddit": "logophilia",
  "ipa": "/suːˈsʌɹəs/",
  "definition": "A whispering or rustling sound.",
  "partOfSpeech": "noun",
  "qualityScore": 0.75,
  "hook": "This word sounds completely made up, but it's real.",
  "script": {
    "hook": "This word sounds completely made up, but it's real.",
    "pronunciation": "The word is susurrus, pronounced soo-SUR-us.",
    "definition": "It's a noun. A whispering or rustling sound, like wind through leaves or a murmuring brook. Next time you hear that gentle rustle outside your window, you'll know the word for it.",
    "cta": "Follow for a new word every day!",
    "fullText": "This word sounds completely made up, but it's real. The word is susurrus, pronounced soo-SUR-us. It's a noun. A whispering or rustling sound, like wind through leaves or a murmuring brook. Next time you hear that gentle rustle outside your window, you'll know the word for it. Follow for a new word every day!",
    "estimatedDuration": 25
  },
  "voiceoverPath": "output/tts/a1b2c3d4.mp3",
  "mixedAudioPath": "output/mixed/a1b2c3d4_mixed.mp3",
  "musicTrack": "lofi-chill-01.mp3",
  "videoPath": "output/videos/a1b2c3d4.mp4",
  "durationSec": 26.5,
  "youtubeVideoId": "dQw4w9WgXcQ",
  "youtubeUrl": "https://youtube.com/shorts/dQw4w9WgXcQ",
  "uploadedAt": "2026-02-23T14:30:00Z",
  "createdAt": "2026-02-23T14:28:00Z",
  "updatedAt": "2026-02-23T14:30:00Z"
}
```

---

## F. Dev Checklist — Zero to First Short

### 1. Prerequisites
- [ ] Node.js ≥ 20 (`node --version`)
- [ ] FFmpeg (`ffmpeg -version`)
- [ ] Python 3 + edge-tts (`pip install edge-tts && edge-tts --list-voices`)

### 2. API Credentials
- [ ] Reddit: create script app at https://www.reddit.com/prefs/apps
- [ ] YouTube: enable Data API v3 in Google Cloud Console, create OAuth 2.0 Desktop credentials
- [ ] OpenAI (optional): get API key for LLM hooks

### 3. Project Bootstrap
```bash
git clone <repo> && cd yt-shorts-auto
npm install
cp .env.example .env    # Fill in credentials
npm run setup:oauth     # Get YouTube refresh token
```

### 4. Add Music (optional)
Download 2–3 royalty-free tracks into `assets/music/`:
- Pixabay Music (pixabay.com/music)
- YouTube Audio Library (studio.youtube.com)
- Incompetech (incompetech.com) — CC-BY

### 5. Test Stages
```bash
npm run produce -- --dry-run --word=susurrus     # Test discovery + scripting
npm run produce -- --no-upload --word=susurrus    # Test TTS + render
npm run produce                                   # Full run with upload
```

### 6. Verify
```bash
npm run stats           # Check DB pipeline stats
npm test                # Run test suite
```

---

## Security Notes

- **Never commit `.env`** — it's in `.gitignore`
- Store all secrets in **GitHub Secrets** for CI/CD workflows
- YouTube refresh tokens grant upload access — treat them like passwords
- Use a dedicated Reddit bot account, not your personal one
- Set OpenAI spending limits if using LLM hooks
- The OAuth setup script runs a temporary local server on port 3000

---

## Deployment

### GitHub Actions (recommended)
See `.github/workflows/daily-post.yml`. SQLite DB is persisted via artifacts.

### VPS with PM2
```bash
npm install -g pm2
pm2 start --cron-restart="0 14 * * *" -- npx tsx src/cli.ts produce
pm2 save && pm2 startup
```

### Scaling
- YouTube API: 10K units/day ≈ 6 uploads. Apply for quota increase.
- Remotion: CPU-heavy renders; use Remotion Lambda for parallelism.
- SQLite: handles 100K+ words. Switch to PostgreSQL only for multi-instance.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `edge-tts` not found | `pip install edge-tts` |
| Reddit 401/403 | Re-check .env; ensure app type = "script" |
| YouTube 403 | Re-run `npm run setup:oauth`; check GCP quota |
| Video > 60s | Reduce text in scriptGenerator templates |
| No candidates | Add subreddits; `--source=fallback`; `npm run db:reset` |
| Remotion crash | Uses FFmpeg fallback automatically |
| TTS quality poor | Try different `TTS_VOICE` value; switch engine |

---

## Copyright & Compliance

- **Reddit**: Official API only (Snoowrap), proper User-Agent, respect rate limits
- **YouTube**: Follow Community Guidelines; no spam; set correct category/tags
- **Music**: Royalty-free only; keep licenses; credit in descriptions
- **Definitions**: dictionaryapi.dev = free/open; Wiktionary = CC-BY-SA
- **Profanity**: `bad-words` filter + custom blocklist; add manual review for brand safety

---

## Third-Party Services

| Service | Free | Paid Alternative | Env Var |
|---|---|---|---|
| Reddit API | ✅ 60 req/min | — | `REDDIT_*` |
| dictionaryapi.dev | ✅ No key | Oxford API ($) | — |
| Wiktionary REST | ✅ No key | Wordnik (free key) | `WORDNIK_API_KEY` |
| edge-tts | ✅ Unlimited | OpenAI TTS ($15/1M ch), ElevenLabs (~$5/mo) | `TTS_ENGINE` |
| Coqui TTS | ✅ Local/OSS | — | `TTS_ENGINE` |
| FFmpeg | ✅ Free | — | `FFMPEG_PATH` |
| Remotion | ✅ Personal | License ($) for companies | — |
| YouTube Data API | ✅ 10K/day | Quota increase (apply) | `YT_*` |
| OpenAI (optional) | — | $0.15/1M tok (4o-mini) | `OPENAI_API_KEY` |
