import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export async function generateAudio(text: string, outputPath: string): Promise<string> {
  const safeText = text.replace(/"/g, '\\"');
  await execPromise(`edge-tts --voice "en-US-ChristopherNeural" --text "${safeText}" --write-media "${outputPath}"`);
  return outputPath;
}
