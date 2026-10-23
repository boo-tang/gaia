// One shared clock for the whole app: a single one-second timer, whatever the number of components
// that use it. The first subscriber starts the timer; it stops after the last one leaves.
import { useSyncExternalStore } from 'react';

const TICK = 'tick';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const ticks = new EventTarget();
let now = nowSeconds();
let subscribers = 0;
let timer: number | undefined;

const tick = () => {
  now = nowSeconds();
  ticks.dispatchEvent(new Event(TICK));
};

const subscribe = (onTick: () => void) => {
  ticks.addEventListener(TICK, onTick);
  subscribers += 1;
  if (timer === undefined) {
    // The value can be old when no component used the clock for a while.
    tick();
    timer = window.setInterval(tick, 1000);
  }
  return () => {
    ticks.removeEventListener(TICK, onTick);
    subscribers -= 1;
    if (subscribers === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
};

const getNow = () => now;

/** The current time in Unix seconds, updated each second. */
export const useNowSeconds = () => useSyncExternalStore(subscribe, getNow);
