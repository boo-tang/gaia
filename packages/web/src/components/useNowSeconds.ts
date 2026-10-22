import { useEffect, useState } from 'react';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The current time in Unix seconds, updated each second. */
export const useNowSeconds = () => {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowSeconds()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};
