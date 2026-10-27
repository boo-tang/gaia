// The "How it works" panel opens by itself until the user closes it once. The browser can block
// the storage: then the panel opens at each visit.
const HELP_SEEN_KEY = 'gaia.help.seen';

// `localStorage` can throw (blocked site data).
const browserStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** True when the user closed the panel before, in this browser. */
export const readHelpSeen = () => {
  try {
    return browserStorage()?.getItem(HELP_SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

export const saveHelpSeen = () => {
  try {
    browserStorage()?.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // No storage: the panel opens again at the next visit.
  }
};
