import { useSyncExternalStore } from 'react';

/** A phone is a screen narrower than 768 px. `styles.css` uses the same width. */
export const PHONE_MEDIA_QUERY = '(max-width: 767.98px)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_MEDIA_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const isPhoneNow = () => window.matchMedia(PHONE_MEDIA_QUERY).matches;

/** True on a phone. Phones get the view-only layout: no bid panel. */
export const useIsPhone = () => useSyncExternalStore(subscribe, isPhoneNow);
