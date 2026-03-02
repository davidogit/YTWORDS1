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
