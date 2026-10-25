// The selection tools, as in an image editor. The tool picker, the keys and the map read only this
// list, so a new tool (for example free draw or an ellipse) is one more entry with its own
// `begin`.
import type { Square } from '@gaia/core';

import type { ComponentType } from 'react';

import { type DragSession, rectangleSession } from './drag';
import type { ToolId } from './selection-store';
import { HandIcon, RectangleIcon } from './tool-icons';

export interface SelectionTool {
  id: ToolId;
  label: string;
  /** The keyboard shortcut (lower case). */
  key: string;
  Icon: ComponentType;
  /** The map cursor. Undefined: the cursor of MapLibre (grab, grabbing). */
  cursor?: string;
  /** True: a drag pans the map. False: a drag selects squares (`begin`). */
  panOnDrag: boolean;
  /** Starts a drag at the square under the pointer. Only for `panOnDrag = false`. */
  begin?: (start: Square) => DragSession;
}

export const TOOLS: readonly SelectionTool[] = [
  { id: 'pan', label: 'Pan', key: 'h', Icon: HandIcon, panOnDrag: true },
  {
    id: 'rectangle',
    label: 'Rectangle',
    key: 'r',
    Icon: RectangleIcon,
    cursor: 'crosshair',
    panOnDrag: false,
    begin: rectangleSession,
  },
];

export const toolById = (id: ToolId): SelectionTool => TOOLS.find(tool => tool.id === id) ?? TOOLS[0];
