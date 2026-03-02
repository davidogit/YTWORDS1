#!/bin/bash

echo "🚀 Bootstrapping yt-shorts-automator project..."

# Create directory structure
mkdir -p yt-shorts-automator/{db,assets/bgm,assets/fonts,remotion,src/{db,modules,utils},.github/workflows,temp}
cd yt-shorts-automator

# 1. package.json
cat << 'EOF' > package.json
{
  "name": "yt-shorts-automator",
  "version": "1.0.0",
  "scripts": {
    "produce": "ts-node src/cli.ts",
    "dev:remotion": "remotion preview remotion/Root.tsx",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.0",
    "dotenv": "^16.4.5",
    "fluent-ffmpeg": "^2.1.3",
    "googleapis": "^133.0.0",
    "openai": "^4.28.0",
    "remotion": "4.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.9",
    "@types/fluent-ffmpeg": "^2.1.24",
    "@types/node": "^20.11.24",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
EOF

# 2. tsconfig.json
cat << 'EOF' > tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF

# 3. .env.example
cat << 'EOF' > .env.example
# Reddit App (Type: Script)
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_username
REDDIT_PASSWORD=your_password

# LLM / TTS (OpenAI optional, Edge-TTS is free and requires no key)
OPENAI_API_KEY=sk-yourkey

# YouTube OAuth2
YT_CLIENT_ID=your_google_client_id
YT_CLIENT_SECRET=your_google_client_secret
YT_REFRESH_TOKEN=your_refresh_token

# System
FFMPEG_PATH=/usr/bin/ffmpeg
EOF

# 4. .gitignore
cat << 'EOF' > .gitignore
node_modules/
dist/
temp/
.env
db/*.sqlite
db/*.sqlite-journal
EOF

# 5. src/db/database.ts
cat << 'EOF' > src/db/database.ts
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '../../../db/words.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export const isWordUsed = (word: string): boolean => {
  const row = db.prepare('SELECT word FROM words WHERE word = ?').get(word);
  return !!row;
};

export const markWordUsed = (word: string, status: string = 'PROCESSED') => {
  db.prepare('INSERT OR REPLACE INTO words (word, status) VALUES (?, ?)').run(word, status);
};
EOF

# 6. src/modules/discoverReddit.ts
cat << 'EOF' > src/modules/discoverReddit.ts
export async function getCandidateWords(): Promise<string[]> {
  const auth = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&username=${process.env.REDDIT_USERNAME}&password=${process.env.REDDIT_PASSWORD}`
  });
  const tokenData = await tokenRes.json();
  
  const res = await fetch('https://oauth.reddit.com/r/logophilia/hot?limit=25', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'User-Agent': 'Node:YTShortsAuto:v1.0' }
  });
  const data = await res.json();
  
  return data.data.children.map((child: any) => {
    const title = child.data.title;
    const match = title.match(/^([A-Za-z]+)/);
    return match ? match[1].toLowerCase() : null;
  }).filter(Boolean);
}
EOF

# 7. src/modules/dictionaryLookup.ts
cat << 'EOF' > src/modules/dictionaryLookup.ts
export interface DictionaryResult { word: string; ipa: string; definition: string; }

export async function lookupWord(word: string): Promise<DictionaryResult | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
  if (!res.ok) return null;
  const data = await res.json();
  
  const entry = data[0];
  const ipa = entry.phonetics.find((p: any) => p.text)?.text || '';
  const definition = entry.meanings[0]?.definitions[0]?.definition || '';
  
  if (!definition) return null;
  return { word, ipa, definition };
}
EOF

# 8. src/modules/validator.ts
cat << 'EOF' > src/modules/validator.ts
export function isValid(word: string): boolean {
  const badWords = ['profanity1', 'profanity2']; // expand as needed
  if (badWords.includes(word.toLowerCase())) return false;
  if (word.length < 4 || word.length > 20) return false;
  return true;
}
EOF

# 9. src/modules/scriptGenerator.ts
cat << 'EOF' > src/modules/scriptGenerator.ts
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateScript(word: string, definition: string) {
  const prompt = `Write a 1-sentence engaging hook for a YouTube short about the weird word "${word}". Then define it simply. Keep it under 40 words total.`;
  
  const completion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'gpt-3.5-turbo',
  });

  const hook = completion.choices[0].message.content || `Did you know there's a specific word for this?`;
  const fullScript = `${hook}. The word is ${word}. It means ${definition}. Subscribe for more weird words!`;
  
  return { hook, fullScript };
}
EOF

# 10. src/modules/tts.ts
cat << 'EOF' > src/modules/tts.ts
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export async function generateAudio(text: string, outputPath: string): Promise<string> {
  const safeText = text.replace(/"/g, '\\"');
  await execPromise(`edge-tts --voice "en-US-ChristopherNeural" --text "${safeText}" --write-media "${outputPath}"`);
  return outputPath;
}
EOF

# 11. src/modules/audioMixer.ts
cat << 'EOF' > src/modules/audioMixer.ts
import ffmpeg from 'fluent-ffmpeg';

export async function mixAudio(voicePath: string, bgmPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(voicePath)
      .input(bgmPath)
      .complexFilter([
        '[1:a]volume=0.15[bg]',
        '[0:a][bg]amix=inputs=2:duration=first[out]'
      ])
      .outputOptions(['-map [out]'])
      .save(outputPath)
      .on('end', () => resolve())
      .on('error', reject);
  });
}
EOF

# 12. src/modules/remotionRender.ts
cat << 'EOF' > src/modules/remotionRender.ts
import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export async function renderVideo(wordData: any, outputPath: string): Promise<void> {
  process.env.REMOTION_DATA = JSON.stringify(wordData);
  const cmd = `npx remotion render remotion/Root.tsx WordShort ${outputPath} --props='${JSON.stringify(wordData)}'`;
  await execPromise(cmd);
}
EOF

# 13. src/modules/uploader.ts
cat << 'EOF' > src/modules/uploader.ts
import { google } from 'googleapis';
import fs from 'fs';

export async function uploadToYouTube(videoPath: string, metadata: any) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET
  );
  
  oauth2Client.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: ['shorts', 'vocabulary', 'words', 'education'],
        categoryId: '27',
      },
      status: { privacyStatus: 'private' }, // change to public for prod
    },
    media: { body: fs.createReadStream(videoPath) },
  });

  return res.data;
}
EOF

# 14. src/cli.ts
cat << 'EOF' > src/cli.ts
import { getCandidateWords } from './modules/discoverReddit';
import { lookupWord } from './modules/dictionaryLookup';
import { isValid } from './modules/validator';
import { generateScript } from './modules/scriptGenerator';
import { generateAudio } from './modules/tts';
import { mixAudio } from './modules/audioMixer';
import { renderVideo } from './modules/remotionRender';
import { uploadToYouTube } from './modules/uploader';
import { isWordUsed, markWordUsed } from './db/database';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const noUpload = process.argv.includes('--no-upload');

  console.log('1. Discovering words...');
  const words = await getCandidateWords();

  let targetWord = '';
  for (const word of words) {
    if (isValid(word) && !isWordUsed(word)) {
        targetWord = word;
        break;
    }
  }

  if (!targetWord) throw new Error('No valid, unused words found.');

  console.log(`2. Dictionary lookup for: ${targetWord}`);
  const dictData = await lookupWord(targetWord);
  if (!dictData) throw new Error('Could not find definition.');

  console.log('3. Generating Script...');
  const script = await generateScript(dictData.word, dictData.definition);

  const pipelineData = {
    id: Date.now().toString(),
    ...dictData,
    ...script,
    audioPath: `./temp/${targetWord}_voice.mp3`,
    mixedAudioPath: `./temp/${targetWord}_final.mp3`,
    videoPath: `./temp/${targetWord}_short.mp4`,
  };

  if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

  console.log('4. Generating TTS...');
  await generateAudio(pipelineData.fullScript, pipelineData.audioPath);

  console.log('5. Mixing Audio...');
  // Ensure you drop a lofi.mp3 file here before running
  await mixAudio(pipelineData.audioPath, 'assets/bgm/lofi.mp3', pipelineData.mixedAudioPath);

  console.log('6. Rendering Video...');
  await renderVideo(pipelineData, pipelineData.videoPath);

  console.log('7. Uploading...');
  if (!isDryRun && !noUpload) {
    const ytData = await uploadToYouTube(pipelineData.videoPath, {
      title: `${pipelineData.word} - Word of the Day! 🤯 #shorts`,
      description: `${pipelineData.word}: ${pipelineData.definition}\n\n#vocabulary #learning #words`,
    });
    console.log('Uploaded! Video ID:', ytData.id);
    markWordUsed(targetWord);
  } else {
    console.log('Skipping upload due to flags.');
    markWordUsed(targetWord, 'DRY_RUN');
  }
}

main().catch(console.error);
EOF

# 15. remotion/Root.tsx (Starter Stub)
cat << 'EOF' > remotion/Root.tsx
import { Composition } from 'remotion';
import React from 'react';

// Basic stub to prevent crash. You will build your real UI here.
const WordShort: React.FC = () => {
  return (
    <div style={{ flex: 1, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' }}>
      <h1>YouTube Short Automation!</h1>
    </div>
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WordShort"
        component={WordShort}
        durationInFrames={1800}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
EOF

# 16. GitHub Actions
cat << 'EOF' > .github/workflows/ci.yml
name: Daily Short Generator
on:
  schedule:
    - cron: '0 14 * * *'
  workflow_dispatch:

jobs:
  produce-short:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install System Dependencies
        run: |
          sudo apt-get update
          sudo apt-get install ffmpeg python3-pip
          pip3 install edge-tts
      - name: Install NPM Packages
        run: npm ci
      - name: Produce and Upload Short
        env:
          REDDIT_CLIENT_ID: ${{ secrets.REDDIT_CLIENT_ID }}
          # ... add other secrets here
        run: npm run produce
EOF

echo "✅ Project scaffolded successfully in ./yt-shorts-automator/"
echo "Next steps:"
echo "1. cd yt-shorts-automator"
echo "2. cp .env.example .env (and fill in your API keys)"
echo "3. npm install"
echo "4. npm run produce -- --dry-run"