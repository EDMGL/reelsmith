/**
 * Lightweight template preview drawn with plain DOM boxes (no media, no
 * canvas): numbered colored placeholders where the slots are, the template's
 * texts in their fonts, stepping through the real cut rhythm while `playing`.
 * Only the hovered/focused card plays, so a gallery of 100+ cards stays idle.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { getAspectPreset } from '../../core';
import type { SlotFrame, SlotLook, VideoTemplate } from './types';

const HUES = [172, 212, 262, 330, 28, 48, 140, 196, 296, 8];
const FULL: SlotFrame = { x: 0.5, y: 0.5, w: 1, h: 1 };
/** Longest time one preview frame is held (long holds are sped up). */
const MAX_HOLD = 1.1;
const MIN_HOLD = 0.12;
const MAX_FRAMES = 24;

/** Times at which the picture changes (slot starts), capped for very busy templates. */
export function previewTimes(t: VideoTemplate): number[] {
  const times = [...new Set([0, ...t.slots.map((s) => s.start)].map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b).filter((x) => x < t.duration);
  if (times.length <= MAX_FRAMES) return times;
  const step = times.length / MAX_FRAMES;
  return Array.from({ length: MAX_FRAMES }, (_, i) => times[Math.floor(i * step)]!);
}

function boxStyle(look: SlotLook, hue: number, z: number, copy: boolean): CSSProperties {
  const f = look.frame ?? FULL;
  // 'contain' shows letterboxing: suggest it with a slightly smaller box.
  const k = look.fit === 'contain' && !look.frame ? 0.82 : look.fit === 'contain' ? 0.94 : 1;
  const w = f.w * k;
  const h = f.h * k;
  const round = look.shape?.kind === 'circle' ? '50%' : look.shape?.kind === 'rounded' ? '7%' : undefined;
  return {
    left: `${(f.x - w / 2) * 100}%`,
    top: `${(f.y - h / 2) * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    zIndex: z,
    borderRadius: round,
    transform: look.rotation ? `rotate(${look.rotation}deg)` : undefined,
    background: copy
      ? `linear-gradient(160deg, hsl(${hue} 35% 22%), hsl(${hue + 30} 30% 12%))`
      : `linear-gradient(150deg, hsl(${hue} 62% 52%), hsl(${hue + 28} 58% 34%))`,
    boxShadow: look.shape?.border ? `0 0 0 ${Math.max(1, look.shape.border / 6)}px ${look.shape.borderColor}` : undefined,
    opacity: look.opacity ?? 1,
  };
}

export function TemplatePreview({ template, playing = false, label }: { template: VideoTemplate; playing?: boolean; label?: string }) {
  const times = useMemo(() => previewTimes(template), [template]);
  const [idx, setIdx] = useState(Math.min(1, times.length - 1));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing || times.length < 2) return;
    let i = 0;
    setIdx(0);
    const step = () => {
      const cur = times[i]!;
      const next = i + 1 < times.length ? times[i + 1]! : template.duration;
      const hold = Math.min(MAX_HOLD, Math.max(MIN_HOLD, next - cur));
      timer.current = setTimeout(() => {
        i = (i + 1) % times.length;
        setIdx(i);
        step();
      }, hold * 1000);
    };
    step();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      setIdx(Math.min(1, times.length - 1));
    };
  }, [playing, times, template.duration]);

  const preset = getAspectPreset(template.aspect);
  const W = preset?.width ?? 1080;
  const H = preset?.height ?? 1920;
  const t = (times[idx] ?? 0) + 1e-3;
  const shortSideCqw = (Math.min(W, H) / W) * 100;
  const active = template.slots.filter((s) => s.start <= t && t < s.start + s.duration);
  const texts = template.texts.filter((x) => x.start <= t && t < x.start + x.duration);

  return (
    <div className={`tp-preview${playing ? ' is-playing' : ''}`} style={{ aspectRatio: `${W} / ${H}`, ['--ar' as string]: String(W / H) }} role="img" aria-label={label ?? `Preview of ${template.name}`}>
      {active.flatMap((s) => {
        const n = template.slots.indexOf(s);
        const hue = HUES[n % HUES.length]!;
        return [
          ...(s.copies ?? []).map((c, i) => <div key={`${s.id}-c${i}`} className="tp-box tp-copy" style={boxStyle(c, hue, c.layer + 10, true)} />),
          <div key={s.id} className="tp-box" style={boxStyle(s, hue, s.layer + 10, false)}>
            <span className="tp-num">{n + 1}</span>
          </div>,
        ];
      })}
      {texts.map((x) => {
        const st = x.style;
        const size = ((st.fontSize ?? 96) / 1080) * shortSideCqw * (x.scale ?? 1);
        return (
          <span
            key={x.id}
            className="tp-text"
            style={{
              left: `${x.x * 100}%`,
              top: `${x.y * 100}%`,
              fontSize: `max(5px, ${size.toFixed(2)}cqw)`,
              fontFamily: st.fontFamily,
              fontWeight: st.fontWeight,
              fontStyle: st.italic ? 'italic' : undefined,
              color: st.color ?? '#fff',
              background: st.background?.color,
              transform: `translate(-50%, -50%)${x.rotation ? ` rotate(${x.rotation}deg)` : ''}`,
              WebkitTextStroke: st.stroke ? `${Math.max(0.3, (st.stroke.width / 1080) * shortSideCqw * 0.5).toFixed(2)}cqw ${st.stroke.color}` : undefined,
            }}
          >
            {x.text.split('\n')[0]}
          </span>
        );
      })}
    </div>
  );
}

/** True once the element has been near the viewport (always true without IntersectionObserver). */
export function useNearViewport<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}
