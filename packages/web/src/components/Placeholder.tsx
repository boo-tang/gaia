import type { ReactNode } from 'react';

/** An empty area with a title, for a part of the app that is not written yet. */
export const Placeholder = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="placeholder">
    <h2 className="placeholder-title">{title}</h2>
    {children}
  </div>
);
