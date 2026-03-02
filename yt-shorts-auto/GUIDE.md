# GUIDE.md — Complete Implementation Guide

## C. Scripts & CLI

### package.json scripts

#### Production Pipeline
| Script | Description |
|---|---|
| `npm run produce` | Full pipeline: RSS word discovery → validate → script → TTS → mix → render → upload |
| `npm run produce:dry` | Stop after script generation (no TTS/render/upload) |
| `npm run produce:no-upload` | Render but don't upload |
| `npm run produce:rss` | Explicitly use RSS feeds as word source |
| `npm run produce:word` | Use "susurrus" as a demo |
| `npm run produce:batch` | Produce multiple videos in one run |

#### Trend Scout — Content Discovery
| Script | Description |
|---|---|
| `npm run scout` | Full scout: YouTube keywords + adjacent niches + Reddit |
| `npm run scout:dry` | Preview results without writing any files |
| `npm run scout:yt` | YouTube keyword search only (no RSS) |
| `npm run scout:rss` | RSS feeds only (no YouTube) |
| `npm run scout:competitors` | Check competitor channels only |
| `npm run scout:review` | Interactively review pending ideas (A/R/S/Q) + Claude script generation |
| `npm run scout:review:no-claude` | Review ideas without calling Claude API |

#### Setup & Dev
| Script | Description |
|---|---|
| `npm run setup:oauth` | Interactive YouTube OAuth2 token setup |
| `npm run remotion:preview` | Preview Remotion composition in browser (design only) |
| `npm test` | Run vitest suite |

### CLI flags

```bash
npm run produce -- --dry-run           # Stop before TTS
npm run produce -- --no-upload         # Stop before YouTube upload
npm run produce -- --word=petrichor    # Use specific word
npm run produce -- --source=fallback   # Use curated fallback word list
npm run produce -- --batch 3           # Produce 3 videos in one run
npm run produce -- --verbose           # Debug logging
npm run produce -- --schedule "2026-02-26T21:10:00Z"  # Schedule publish at specific time (ISO 8601)
```

| Flag | Description | Default |
|---|---|---|
| `--dry-run` | Stop after script generation (no TTS/render/upload) | `false` |
| `--no-upload` | Render the video but skip YouTube upload | `false` |
| `--source <source>` | Word source: `rss` (default), `reddit`, `fallback`, `manual` | `rss` |
| `--word <word>` | Use a specific word (skips discovery) | — |
| `--batch <count>` | Produce multiple videos in one run | `1` |
| `--verbose` | Enable debug logging | `false` |
| `--schedule <datetime>` | Schedule publish at ISO datetime (uploads as private, auto-publishes at time) | — |

### Scout CLI flags

```bash
npm run scout -- --dry-run           # Preview ideas, don't write files
npm run scout -- --min-score=5       # Only save ideas with outlier score ≥ 5
npm run scout -- --yt-only           # Skip RSS feeds
npm run scout -- --rss-only          # Skip YouTube
npm run scout -- --competitors-only  # Competitor channels only

npm run scout:review -- --no-claude  # Review without Claude script generation
npm run scout:review -- --approved   # Re-review already-approved ideas
npm run scout:review -- --min-score=6 # Only show ideas above score threshold
```

### Scout config — `scripts/scout-config.ts`

Edit this file to customise the scout behaviour:

| Setting | What it controls |
|---|---|
| `primaryKeywords` | YouTube search terms in your exact niche |
| `adjacentKeywords` | Neighbouring niches to bend ideas from |
| `competitorChannelIds` | Channel IDs to monitor (find at commentpicker.com/youtube-channel-id.php) |
| `rss.feeds` | RSS/Atom feed URLs to scout (language sources + Reddit public RSS) |
| `minOutlierScore` | Minimum score (0–10) for an idea to be saved |
| `publishedAfterDays` | Only consider videos published within N days |
| `minViewsForConsideration` | Skip videos with fewer views than this |

### Trend Scout workflow

```
npm run scout           → ideas saved to content-ideas/pending/
npm run scout:review    → browse ideas, press A to approve (Claude writes a script)
                          open content-ideas/approved/<file>.md
                          pick a word from the candidates
npm run produce -- --word=YOURWORD   → run the full production pipeline
                          move the idea file to content-ideas/produced/ when done
```

### Outlier Score explained

The score (0–10) measures how far a video outperforms its channel size:

- **Views ÷ subscribers** — a 5K-sub channel with 500K views is a strong signal
- **Engagement rate** — (likes + comments) ÷ views
- **Recency bonus** — fresher content scores higher

A score of **7+** is a strong outlier worth replicating. Scores below 3 are filtered out by default.

### Content ideas folder

```
content-ideas/
  pending/    ← new ideas from scout (review these)
  approved/   ← your picks, with Claude-generated adapted scripts
  rejected/   ← discarded ideas
  produced/   ← manually move here after you've made the video
```

Each idea file is a plain markdown document you can open and edit. The approved file contains the Claude-generated adapted hook and full script ready to hand off to the production pipeline.

---

### .env.example
All required environment variables are listed in `.env.example` with comments. Required for minimum viable operation:

```
TTS_ENGINE=edge-tts, TTS_VOICE=en-US-GuyNeural
YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (from setup:oauth)
```

> **Note:** Reddit credentials (`REDDIT_*`) are no longer required. The production pipeline defaults to RSS feeds (no authentication needed). Reddit can still be used via `--source=reddit` if credentials are configured.

Optional (for Trend Scout Claude script generation):
```
ANTHROPIC_API_KEY=sk-ant-...   # Get at console.anthropic.com
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
npm run produce                                   # Full run with immediate upload
npm run produce -- --schedule "2026-02-27T14:00:00Z"  # Upload scheduled for 2 PM GMT
npm run produce -- --batch 3                      # Produce & upload 3 videos in one run
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
- FFmpeg+ASS: Primary renderer (~60s per video). Remotion kept for preview/design only.
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
| Scheduled video not publishing | Ensure `--schedule` uses ISO 8601 format with timezone (e.g. `2026-02-26T21:10:00Z`) |
| TTS quality poor | Try different `TTS_VOICE` value; switch engine |
| Scout finds no ideas | Lower `--min-score`; expand keywords/feeds in `scout-config.ts`; check YT API quota |
| Scout YouTube 403 | Add `YT_API_KEY` to `.env` (GCP Console → Credentials → API Key) |
| Claude script generation fails | Check `ANTHROPIC_API_KEY` in `.env`; use `--no-claude` to skip |
| Scout uses too much YT quota | Reduce `maxResultsPerQuery` or `primaryKeywords` in `scout-config.ts` |
| RSS feed returns 0 ideas | Feed URL may have changed; remove or replace it in `scout-config.ts` |

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
| Anthropic Claude (optional) | — | ~$0.25/1M tok (Haiku) | `ANTHROPIC_API_KEY` |
