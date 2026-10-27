// A modal dialog with a title, a close button and text. The browser keeps the focus in it, Escape
// closes it, and the focus goes back to the button that opened it. A click on the backdrop also
// closes it.
import { type ReactNode, useEffect, useRef } from 'react';

interface InfoDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export const InfoDialog = ({ open, onClose, title, children }: InfoDialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="info-dialog"
      aria-label={title}
      onClose={onClose}
      // The dialog element fills the box; a click on it (not on its content) is a click on the backdrop.
      onClick={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="info-dialog-content">
        <div className="info-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="info-dialog-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
};
