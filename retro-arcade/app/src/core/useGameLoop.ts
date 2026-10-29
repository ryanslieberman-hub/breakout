import { useEffect, useRef } from 'react';

/** Calls `tick(dtSeconds)` every frame while `running`. dt is clamped so a stall cannot teleport things. */
export function useGameLoop(tick: (dt: number) => void, running: boolean) {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (last) tickRef.current(Math.min((t - last) / 1000, 1 / 20));
      last = t;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}
