/**
 * ShortVideo.tsx — Remotion composition for a vertical YouTube Short.
 *
 * Layout: 1080×1920 (9:16 vertical)
 * Sections timed to the voiceover:
 *   0–4s:    Hook screen (attention-grabbing text)
 *   4–9s:    Word + IPA pronunciation
 *   9–25s:   Definition with animated text
 *   25–30s:  CTA screen
 *
 * All durations are driven by `inputProps` so they adapt to the actual script.
 * Text animations powered by remotion-bits (AnimatedText, TypeWriter, StaggeredMotion).
 */

import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
} from 'remotion';
import { AnimatedText, TypeWriter, StaggeredMotion } from 'remotion-bits';

// ── Input Props Interface ──────────────────────────────────────────────────

interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ShortVideoProps {
  word: string;
  ipa: string;
  definition: string;
  hook: string;
  cta: string;
  audioPath: string;
  durationInFrames: number;
  hookEnd: number;
  wordEnd: number;
  ctaStart: number;
  accentColor?: string;
  bgColor1?: string;
  bgColor2?: string;
  bgStyle?: 'aurora' | 'particles' | 'aurora-particles';
  bgVideoPath?: string;
  captions?: CaptionWord[];
}

// ── Aurora Mesh Background ─────────────────────────────────────────────────
// Multiple radial gradient blobs that shift position slowly — premium feel

const AuroraBackground: React.FC<{ color1: string; color2: string; accent: string }> = ({
  color1,
  color2,
  accent,
}) => {
  const frame = useCurrentFrame();

  // Each blob moves on a slow sine/cosine orbit
  const t = frame / 300;
  const blob1x = 30 + Math.sin(t * 1.1) * 20;
  const blob1y = 20 + Math.cos(t * 0.9) * 15;
  const blob2x = 70 + Math.cos(t * 0.7) * 25;
  const blob2y = 70 + Math.sin(t * 1.3) * 20;
  const blob3x = 50 + Math.sin(t * 1.5 + 1) * 18;
  const blob3y = 45 + Math.cos(t * 0.8 + 2) * 22;

  return (
    <AbsoluteFill
      style={{
        background: color1,
        overflow: 'hidden',
      }}
    >
      {/* Blob 1 — color2 tinted */}
      <div
        style={{
          position: 'absolute',
          width: 900,
          height: 900,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color2}CC 0%, transparent 70%)`,
          left: `${blob1x}%`,
          top: `${blob1y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(80px)',
        }}
      />
      {/* Blob 2 — accent tinted */}
      <div
        style={{
          position: 'absolute',
          width: 700,
          height: 700,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}55 0%, transparent 65%)`,
          left: `${blob2x}%`,
          top: `${blob2y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(100px)',
        }}
      />
      {/* Blob 3 — color2 highlight */}
      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${color2}88 0%, transparent 60%)`,
          left: `${blob3x}%`,
          top: `${blob3y}%`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(60px)',
        }}
      />
      {/* Subtle vignette to keep edges dark and focus on center */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

// ── Floating Bokeh Particles ───────────────────────────────────────────────
// Soft glowing orbs rising upward at staggered speeds

const PARTICLES = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  x: (i * 37 + 11) % 100,           // spread across width
  size: 8 + (i * 13) % 22,          // 8–30px
  speed: 0.18 + (i * 7) % 20 / 100, // 0.18–0.38 px/frame equivalent
  delay: (i * 17) % 90,             // stagger start
  opacity: 0.18 + (i * 11) % 35 / 100, // 0.18–0.53
}));

const ParticlesBackground: React.FC<{ color1: string; color2: string; accent: string }> = ({
  color1,
  color2,
  accent,
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, ${color1} 0%, ${color2} 100%)`,
        overflow: 'hidden',
      }}
    >
      {PARTICLES.map((p) => {
        const elapsed = Math.max(0, frame - p.delay);
        // Y travels from 1920+size (below screen) upward; wrap when above top
        const totalTravel = 1920 + p.size;
        const rawY = 1920 + p.size - (elapsed * p.speed * 30) % totalTravel;
        const pulseOpacity = p.opacity * (0.75 + 0.25 * Math.sin(elapsed * 0.05 + p.id));

        return (
          <div
            key={p.id}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              left: `${p.x}%`,
              top: rawY,
              opacity: pulseOpacity,
              background: `radial-gradient(circle, ${p.id % 3 === 0 ? accent : p.id % 3 === 1 ? color2 : '#ffffff'}CC 0%, transparent 70%)`,
              filter: `blur(${p.size * 0.4}px)`,
              boxShadow: `0 0 ${p.size * 2}px ${p.id % 3 === 0 ? accent : color2}66`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ── Combined: Aurora + Particles ──────────────────────────────────────────

const AuroraParticlesBackground: React.FC<{ color1: string; color2: string; accent: string }> = (
  props
) => (
  <>
    <AuroraBackground {...props} />
    {/* Particles rendered on top at reduced opacity so aurora shows through */}
    <AbsoluteFill style={{ opacity: 0.6 }}>
      <ParticlesBackground {...props} />
    </AbsoluteFill>
  </>
);

// ── Word-by-Word Caption Overlay ───────────────────────────────────────────
// Hormozi-style: bold, active word highlighted, scale pop on current word

const MAX_WORDS_PER_LINE = 5;

const CaptionOverlay: React.FC<{ captions: CaptionWord[]; accent: string }> = ({
  captions,
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  // Find current caption index
  const activeIdx = captions.findIndex(
    (c) => currentMs >= c.startMs && currentMs < c.endMs
  );

  // Build visible window: show a chunk of words around the active one
  // Group captions into lines of MAX_WORDS_PER_LINE
  const lineIdx = activeIdx >= 0 ? Math.floor(activeIdx / MAX_WORDS_PER_LINE) : -1;
  const lineStart = lineIdx * MAX_WORDS_PER_LINE;
  const lineEnd = Math.min(lineStart + MAX_WORDS_PER_LINE, captions.length);
  const visibleWords = lineIdx >= 0 ? captions.slice(lineStart, lineEnd) : [];

  if (visibleWords.length === 0) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: 220,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 10,
          padding: '12px 28px',
          borderRadius: 16,
          backgroundColor: 'rgba(0,0,0,0.45)',
          maxWidth: 900,
        }}
      >
        {visibleWords.map((word, i) => {
          const globalIdx = lineStart + i;
          const isActive = globalIdx === activeIdx;
          const isPast = currentMs >= word.endMs;

          // Pop animation for active word
          const popProgress = isActive
            ? interpolate(
                currentMs - word.startMs,
                [0, 80, 200],
                [0.92, 1.15, 1.0],
                { extrapolateRight: 'clamp' }
              )
            : 1;

          return (
            <span
              key={globalIdx}
              style={{
                fontSize: 38,
                fontWeight: 900,
                fontFamily: "'Montserrat', 'Segoe UI', system-ui, sans-serif",
                textTransform: 'uppercase',
                color: isActive ? accent : isPast ? 'rgba(255,255,255,0.55)' : '#FFFFFF',
                textShadow: isActive
                  ? `0 0 20px ${accent}88, 0 2px 8px rgba(0,0,0,0.5)`
                  : '0 2px 6px rgba(0,0,0,0.5)',
                transform: `scale(${popProgress})`,
                transition: 'color 0.1s',
                letterSpacing: '0.02em',
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── Video Background ──────────────────────────────────────────────────────
// Pexels stock video played behind a dark overlay so text stays readable

const VideoBackground: React.FC<{ src: string; color1: string }> = ({ src, color1 }) => {
  // src is a filename in public/ — use staticFile() to resolve it
  const videoSrc = staticFile(src);
  return (
    <AbsoluteFill style={{ backgroundColor: color1 }}>
      <OffthreadVideo
        src={videoSrc}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
        muted
      />
      {/* Dark overlay for text legibility */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.6) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

// ── Background Router ──────────────────────────────────────────────────────

const Background: React.FC<{
  bgStyle: ShortVideoProps['bgStyle'];
  bgVideoPath?: string;
  color1: string;
  color2: string;
  accent: string;
}> = ({ bgStyle, bgVideoPath, color1, color2, accent }) => {
  if (bgVideoPath) return <VideoBackground src={bgVideoPath} color1={color1} />;
  if (bgStyle === 'particles') return <ParticlesBackground color1={color1} color2={color2} accent={accent} />;
  if (bgStyle === 'aurora-particles') return <AuroraParticlesBackground color1={color1} color2={color2} accent={accent} />;
  // default: 'aurora'
  return <AuroraBackground color1={color1} color2={color2} accent={accent} />;
};

// ── Hook Screen ────────────────────────────────────────────────────────────

const HookScreen: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const pulse = interpolate(frame % (fps * 2), [0, fps, fps * 2], [1, 1.18, 1], {
    extrapolateRight: 'clamp',
  });

  const emojiOpacity = spring({ frame, fps, config: { damping: 14, stiffness: 100 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 40,
        padding: '0 60px',
      }}
    >
      {/* Pulsing emoji */}
      <div
        style={{
          fontSize: 90,
          transform: `scale(${pulse * emojiOpacity})`,
          opacity: emojiOpacity,
        }}
      >
        🤯
      </div>

      {/* Word-by-word slide-up + blur reveal */}
      <AnimatedText
        transition={{
          split: 'word',
          splitStagger: 4,
          duration: 22,
          y: [38, 0],
          blur: [10, 0],
          opacity: [0, 1],
          easing: 'easeOutCubic',
        }}
        style={{
          fontSize: 52,
          fontWeight: 700,
          color: '#FFFFFF',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          textShadow: '0 3px 24px rgba(0,0,0,0.4)',
          justifyContent: 'center',
          lineHeight: 1.3,
          textAlign: 'center',
        }}
      >
        {text}
      </AnimatedText>

      {/* Subtle swipe indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 120,
          opacity: interpolate(frame, [30, 50], [0, 0.45], { extrapolateRight: 'clamp' }),
          fontSize: 26,
          color: '#fff',
        }}
      >
        ▼
      </div>
    </AbsoluteFill>
  );
};

// ── Word + IPA Screen ──────────────────────────────────────────────────────

const WordScreen: React.FC<{ word: string; ipa: string; accent: string }> = ({
  word,
  ipa,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();

  // Accent underline sweep
  const underlineScale = spring({ frame: frame - 20, fps, config: { damping: 16, stiffness: 90 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Character-by-character reveal with blur + scale */}
      <AnimatedText
        transition={{
          split: 'character',
          splitStagger: 2,
          duration: 16,
          blur: [18, 0],
          scale: [0.6, 1],
          opacity: [0, 1],
          easing: 'easeOutQuart',
        }}
        style={{
          fontSize: 96,
          fontWeight: 900,
          color: accent,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          letterSpacing: '0.04em',
          textShadow: `0 0 40px ${accent}66`,
          justifyContent: 'center',
        }}
      >
        {word.charAt(0).toUpperCase() + word.slice(1)}
      </AnimatedText>

      {/* Accent underline */}
      <div
        style={{
          width: 80,
          height: 4,
          borderRadius: 3,
          backgroundColor: accent,
          transform: `scaleX(${underlineScale})`,
          transformOrigin: 'center',
          opacity: 0.85,
        }}
      />

      {/* IPA — typewriter reveal */}
      {ipa && (
        <TypeWriter
          text={ipa}
          typeSpeed={2}
          cursor
          delay={22}
          showCursorAfterComplete={false}
          style={{
            fontSize: 38,
            color: 'rgba(255,255,255,0.75)',
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            fontWeight: 400,
            letterSpacing: '0.08em',
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// ── Definition Screen ──────────────────────────────────────────────────────

const DefinitionScreen: React.FC<{ word: string; definition: string; accent: string }> = ({
  word,
  definition,
  accent,
}) => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 36,
        padding: '0 60px',
      }}
    >
      {/* Word label — instant fade in */}
      <AnimatedText
        transition={{
          opacity: [0, 1],
          y: [12, 0],
          duration: 14,
          easing: 'easeOutSine',
        }}
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: accent,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          letterSpacing: '0.12em',
          justifyContent: 'center',
        }}
      >
        {word.toUpperCase()}
      </AnimatedText>

      {/* Divider */}
      <StaggeredMotion
        transition={{
          delay: 10,
          scaleX: [0, 1],
          opacity: [0, 1],
          duration: 18,
          easing: 'easeOutCubic',
        }}
      >
        <div
          style={{
            width: 64,
            height: 3,
            borderRadius: 2,
            backgroundColor: accent,
            opacity: 0.7,
          }}
        />
      </StaggeredMotion>

      {/* Definition — word-by-word stagger */}
      <AnimatedText
        transition={{
          split: 'word',
          splitStagger: 2,
          duration: 16,
          delay: 8,
          y: [22, 0],
          blur: [6, 0],
          opacity: [0, 1],
          easing: 'easeOutCubic',
        }}
        style={{
          fontSize: 40,
          fontWeight: 400,
          color: '#FFFFFF',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          lineHeight: 1.45,
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {definition}
      </AnimatedText>
    </AbsoluteFill>
  );
};

// ── CTA Screen ─────────────────────────────────────────────────────────────

const CTAScreen: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 48,
        padding: '0 60px',
      }}
    >
      {/* CTA text — word-by-word with slight scale */}
      <AnimatedText
        transition={{
          split: 'word',
          splitStagger: 5,
          duration: 20,
          y: [28, 0],
          scale: [0.88, 1],
          opacity: [0, 1],
          easing: 'easeOutCubic',
        }}
        style={{
          fontSize: 46,
          fontWeight: 700,
          color: '#FFFFFF',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          textShadow: '0 2px 20px rgba(0,0,0,0.3)',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        {text}
      </AnimatedText>

      {/* Follow button — bounce in */}
      <StaggeredMotion
        transition={{
          delay: 18,
          y: [50, 0],
          scale: [0.7, 1],
          opacity: [0, 1],
          duration: 22,
          easing: 'easeOutQuart',
        }}
      >
        <div
          style={{
            backgroundColor: accent,
            paddingTop: 20,
            paddingBottom: 20,
            paddingLeft: 52,
            paddingRight: 52,
            borderRadius: 60,
            fontSize: 30,
            fontWeight: 800,
            color: '#FFFFFF',
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            letterSpacing: '0.06em',
            boxShadow: `0 8px 32px ${accent}88`,
          }}
        >
          ▶ FOLLOW
        </div>
      </StaggeredMotion>
    </AbsoluteFill>
  );
};

// ── Main Composition ───────────────────────────────────────────────────────

export const ShortVideo: React.FC<ShortVideoProps> = ({
  word,
  ipa,
  definition,
  hook,
  cta,
  audioPath,
  durationInFrames,
  hookEnd,
  wordEnd,
  ctaStart,
  accentColor = '#FF6B35',
  bgColor1 = '#0A0A2E',
  bgColor2 = '#1A1A4E',
  bgStyle = 'aurora',
  bgVideoPath,
  captions,
}) => {
  const hookDuration = hookEnd;
  const wordDuration = wordEnd - hookEnd;
  const defDuration = ctaStart - wordEnd;
  const ctaDuration = durationInFrames - ctaStart;

  return (
    <AbsoluteFill>
      <Background bgStyle={bgStyle} bgVideoPath={bgVideoPath} color1={bgColor1} color2={bgColor2} accent={accentColor} />

      {/* Audio track — omitted when empty (local file:// paths not supported in renderer) */}
      {audioPath ? <Audio src={audioPath} /> : null}

      <Sequence from={0} durationInFrames={hookDuration}>
        <HookScreen text={hook} accent={accentColor} />
      </Sequence>

      <Sequence from={hookEnd} durationInFrames={wordDuration}>
        <WordScreen word={word} ipa={ipa} accent={accentColor} />
      </Sequence>

      <Sequence from={wordEnd} durationInFrames={defDuration}>
        <DefinitionScreen word={word} definition={definition} accent={accentColor} />
      </Sequence>

      <Sequence from={ctaStart} durationInFrames={ctaDuration}>
        <CTAScreen text={cta} accent={accentColor} />
      </Sequence>

      {/* Word-by-word caption overlay — full duration, synced to audio timing */}
      {captions && captions.length > 0 && (
        <CaptionOverlay captions={captions} accent={accentColor} />
      )}
    </AbsoluteFill>
  );
};
