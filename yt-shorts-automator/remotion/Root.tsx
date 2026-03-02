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
