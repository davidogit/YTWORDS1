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
