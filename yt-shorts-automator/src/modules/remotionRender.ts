import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

export async function renderVideo(wordData: any, outputPath: string): Promise<void> {
  process.env.REMOTION_DATA = JSON.stringify(wordData);
  const cmd = `npx remotion render remotion/Root.tsx WordShort ${outputPath} --props='${JSON.stringify(wordData)}'`;
  await execPromise(cmd);
}
