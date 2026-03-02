import React from 'react';
import { Composition } from 'remotion';
import { ShortVideo, type ShortVideoProps } from './ShortVideo';

// Default props for preview / testing
const defaultProps: ShortVideoProps = {
  word: 'susurrus',
  ipa: '/suːˈsʌɹəs/',
  definition: "It's a noun. A whispering or rustling sound, like wind through trees or a murmuring brook.",
  hook: 'This word sounds completely made up, but it\'s real.',
  cta: 'Follow for a new word every day!',
  audioPath: '',  // Empty for preview — will be set by render script
  durationInFrames: 30 * 25, // 25 seconds at 30fps
  hookEnd: 30 * 4,           // 4 seconds
  wordEnd: 30 * 9,           // 9 seconds
  ctaStart: 30 * 22,         // 22 seconds
  accentColor: '#FF6B35',
  bgColor1: '#0A0A2E',
  bgColor2: '#1A1A4E',
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ShortVideo"
        component={ShortVideo as unknown as React.FC<Record<string, unknown>>}
        durationInFrames={defaultProps.durationInFrames}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultProps}
      />
    </>
  );
};
