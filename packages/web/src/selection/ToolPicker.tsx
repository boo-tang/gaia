// The tool buttons of the bid panel, as in an image editor. The keys of the tools work in the
// whole page, but not in an input.
import { useEffect } from 'react';

import { TOOLS } from './tools';
import { selectionStore, useSelection } from './useSelection';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const ToolPicker = () => {
  const active = useSelection(state => state.tool);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) {
        return;
      }
      const tool = TOOLS.find(t => t.key === event.key.toLowerCase());
      if (tool !== undefined) {
        selectionStore.setTool(tool.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="tool-picker" role="radiogroup" aria-label="Map tool">
      {TOOLS.map(({ id, label, key, Icon }) => {
        const name = `${label} (${key.toUpperCase()})`;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === active}
            aria-label={name}
            title={name}
            className="tool-button"
            onClick={() => selectionStore.setTool(id)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
};
