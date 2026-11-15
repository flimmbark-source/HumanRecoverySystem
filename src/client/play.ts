// Playback position lives in its own small store so animation frames re-render only the token and the playbar.
import { useSyncExternalStore } from 'react';

export interface PlayState { t: number; playing: boolean; loop: boolean; steps: number }
let play: PlayState = { t: 0, playing: false, loop: false, steps: 0 };
const subs = new Set<() => void>();
export const getPlay = () => play;
export function setPlay(p: Partial<PlayState>) { play = { ...play, ...p }; subs.forEach((f) => f()); }
export function usePlay<T>(sel: (p: PlayState) => T): T {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => sel(play));
}
export const STEP_SECONDS = 2.6; // display time per step; real durations are shown as text, not as animation speed
export const MOVE_SHARE = 0.6; // first part of a step shows work in motion, the rest shows waiting

let raf = 0, last = 0;
function frame(ts: number) {
  if (!play.playing) return;
  if (last) {
    let t = play.t + Math.min((ts - last) / 1000, 0.1) / STEP_SECONDS;
    if (t >= play.steps) { if (play.loop && play.steps > 0) t = 0; else { setPlay({ t: play.steps, playing: false }); last = 0; return; } }
    setPlay({ t });
  }
  last = ts;
  raf = requestAnimationFrame(frame);
}
export function startPlay() {
  if (play.steps <= 0) return;
  if (play.t >= play.steps) play = { ...play, t: 0 };
  last = 0; setPlay({ playing: true });
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
export function pausePlay() { cancelAnimationFrame(raf); last = 0; setPlay({ playing: false }); }
export function resetPlay(steps: number) { pausePlay(); setPlay({ t: 0, steps }); }
