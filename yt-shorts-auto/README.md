# YouTube Shorts Autopilot — "Word of the Day" Faceless Channel

## A. Solution Overview

This project automates a faceless YouTube Shorts channel that publishes daily "fun word" videos. Each Short follows a proven format: a curiosity-driven hook ("Did you know there's a word for…"), the word with pronunciation, a plain-English definition, and a call-to-action — all in 15–45 seconds.

**Tech stack & rationale:**

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 + TypeScript | Async-native, huge ecosystem, Remotion compatibility |
| Word Discovery | Reddit API (Snoowrap) + dictionaryapi.dev | Reddit surfaces novel/fun words organically; dictionaryapi.dev is free & reliable |
| Validation | dictionaryapi.dev + bad-words filter | Confirms existence, fetches IPA & definition, blocks profanity |
| Script | Template engine + optional OpenAI | Deterministic templates work; LLM adds variety when available |
| TTS | edge-tts (free, Microsoft voices) | Zero cost, high quality, many voices; Coqui/OpenAI as alternatives |
| Audio | FFmpeg (mixing/ducking) | Industry standard, scriptable, free |
| Video | FFmpeg + ASS subtitles | Fast (~60s), rich animations via ASS override tags; Remotion kept for preview |
| Upload | YouTube Data API v3 (googleapis) | Official API, resumable uploads, metadata automation |
| DB | SQLite via better-sqlite3 | Zero-config, file-based, perfect for dedup & history |
| Scheduler | node-cron / GitHub Actions / PM2 | Flexible: local cron, CI/CD, or VPS |

**Pipeline flow:** `npm run produce` executes:
```
Discover → Validate → Script → TTS → Audio Mix → Render → Upload
```
Each stage is an independent module with typed interfaces, retry logic, and logging.

---

## B. File / Folder Scaffold

```
yt-shorts-auto/
├── .env.example              # All required env vars
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md                 # This file
│
├── src/
│   ├── cli.ts                # Main entrypoint — `npm run produce`
│   ├── config.ts             # Centralized config from env
│   ├── pipeline.ts           # Orchestrates all stages
│   │
│   ├── types/
│   │   └── index.ts          # Shared interfaces (PipelineItem, WordCandidate, etc.)
│   │
│   ├── modules/
│   │   ├── discoverReddit.ts # Reddit word discovery via Snoowrap
│   │   ├── discoverFallback.ts # Fallback: random word APIs, Wiktionary
│   │   ├── dictionaryLookup.ts # dictionaryapi.dev + Wiktionary fallback
│   │   ├── validator.ts      # Spelling, profanity, frequency, quality scoring
│   │   ├── scriptGenerator.ts # Hook + script generation (template + LLM option)
│   │   ├── tts.ts            # TTS: edge-tts primary, Coqui/OpenAI alternatives
│   │   ├── audioMixer.ts     # FFmpeg: mix VO + music with ducking
│   │   ├── remotionRender.ts # FFmpeg+ASS renderer (primary) + Remotion preview support
│   │   └── uploader.ts       # YouTube Data API v3 upload with OAuth2
│   │
│   ├── remotion/
│   │   ├── Root.tsx           # Remotion <Composition> root
│   │   ├── ShortVideo.tsx     # Main video component (hook → word → def → CTA)
│   │   ├── components/
│   │   │   ├── AnimatedWord.tsx
│   │   │   ├── HookScreen.tsx
│   │   │   ├── DefinitionScreen.tsx
│   │   │   ├── CTAScreen.tsx
│   │   │   └── GradientBackground.tsx
│   │   └── index.ts          # Remotion entry
│   │
│   └── utils/
│       ├── db.ts             # SQLite setup, queries, dedup
│       ├── logger.ts         # Structured logging (pino)
│       ├── retry.ts          # Generic retry with exponential backoff
│       └── profanityFilter.ts # bad-words wrapper
│
├── assets/
│   ├── music/                # Royalty-free background tracks (.mp3)
│   │   └── .gitkeep
│   └── fonts/                # Custom fonts for Remotion
│       └── .gitkeep
│
├── db/
│   └── words.db              # SQLite database (gitignored)
│
├── output/                   # Rendered videos & audio (gitignored)
│
├── tests/
│   ├── dictionary.test.ts
│   ├── validator.test.ts
│   └── dedup.test.ts
│
├── scripts/
│   ├── setup-oauth.ts        # Interactive YouTube OAuth token setup
│   └── seed-music.ts         # Download royalty-free tracks
│
└── .github/
    └── workflows/
        ├── ci.yml            # Lint + test on push
        └── daily-post.yml    # Optional scheduled daily run
```

---

## C–F: Full Documentation

All scripts, CLI flags, module signatures, example pipeline JSON, dev checklist, security notes, deployment, troubleshooting, and compliance information are provided in the companion document `GUIDE.md`.
