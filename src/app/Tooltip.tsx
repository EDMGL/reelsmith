import { useEffect } from 'react';

/**
 * App-wide styled tooltips built from the existing `title` attributes (so
 * every feature gets them for free and tests/markup keep their `title`).
 * While an element is hovered its `title` is parked in `data-tip-title`
 * (suppressing the native tooltip) and restored on leave — unless React set
 * a new title meanwhile. A trailing "(Shortcut)" is rendered as key caps.
 * One fixed DOM node, updated imperatively: no React renders on hover.
 */
const SHOW_DELAY = 450;
const SKIP = '.clip, .lane, .ruler, .resize-handle, [data-no-tooltip]';
const SHORTCUT_RE = /^(.*?)\s*\(([^()]{1,24})\)$/;

/** Splits "Split at playhead (S)" into text + key hint (only when the hint looks like keys). */
export function splitTooltip(title: string): { text: string; keys: string | null } {
  const m = SHORTCUT_RE.exec(title.trim());
  if (!m || !m[1]) return { text: title, keys: null };
  const hint = m[2]!.trim();
  // Key hints contain only key names/symbols, e.g. "S", "⇧⌘Z", "Ctrl+Shift+X", "Shift+Del", "Space", "-".
  const stripped = hint.replace(/Ctrl|Shift|Alt|Space|Del|Esc|Home|End|Enter|Backspace|or/g, '');
  const looksLikeKeys = !/[a-z]/.test(stripped) && !/[;,]/.test(hint) && hint.length <= 16;
  return looksLikeKeys ? { text: m[1], keys: hint } : { text: title, keys: null };
}

export function TooltipLayer() {
  useEffect(() => {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    let target: HTMLElement | null = null;
    let timer: number | undefined;

    const restore = () => {
      if (target) {
        const parked = target.getAttribute('data-tip-title');
        if (parked !== null) {
          if (!target.hasAttribute('title')) target.setAttribute('title', parked);
          target.removeAttribute('data-tip-title');
        }
      }
      target = null;
      window.clearTimeout(timer);
      tip.classList.remove('visible');
    };

    const show = (el: HTMLElement, title: string) => {
      const { text, keys } = splitTooltip(title);
      tip.textContent = '';
      const span = document.createElement('span');
      span.textContent = text;
      tip.appendChild(span);
      if (keys) {
        for (const part of keys.split(/\s+or\s+/).slice(0, 2)) {
          const k = document.createElement('span');
          k.className = 'kbd';
          k.textContent = part;
          tip.appendChild(k);
        }
      }
      const r = el.getBoundingClientRect();
      tip.style.left = '0px';
      tip.style.top = '0px';
      tip.classList.add('visible');
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let top = r.bottom + 8;
      if (top + th > window.innerHeight - 4) top = r.top - th - 8;
      const left = Math.max(4, Math.min(window.innerWidth - tw - 4, r.left + r.width / 2 - tw / 2));
      // Rail tabs: show to the right.
      if (el.closest('.tabs')) {
        tip.style.left = `${r.right + 8}px`;
        tip.style.top = `${r.top + r.height / 2 - th / 2}px`;
        return;
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(4, top)}px`;
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.buttons) return;
      const el = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null;
      if (!el || el === target) return;
      restore();
      if (el.closest(SKIP)) return;
      const title = el.getAttribute('title');
      if (!title) return;
      target = el;
      el.setAttribute('data-tip-title', title);
      el.removeAttribute('title');
      timer = window.setTimeout(() => {
        if (target === el && el.isConnected) show(el, title);
      }, SHOW_DELAY);
    };
    const onOut = (e: PointerEvent) => {
      if (!target) return;
      const to = e.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      restore();
    };
    const hide = () => restore();
    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    window.addEventListener('wheel', hide, { passive: true, capture: true });
    return () => {
      restore();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('wheel', hide, true);
      tip.remove();
    };
  }, []);
  return null;
}
