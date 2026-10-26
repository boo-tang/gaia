// The selection tools, as in an image editor. The tool picker, the keys and the map read only this
// list, so a new tool (for example free draw or an ellipse) is one more entry with its own
// `begin`.
import type { Square } from '@gaia/core';

import type { ComponentType } from 'react';

import { type DrawSession, rectangleSession } from './draw';
import type { ToolId } from './selection-store';
import { PointerIcon, RectangleIcon } from './tool-icons';

export interface SelectionTool {
  id: ToolId;
  label: string;
  /** The keyboard shortcut (lower case). */
  key: string;
  Icon: ComponentType;
  /** The map cursor. Undefined: the cursor of MapLibre (grab, grabbing). */
  cursor?: string;
  /**
   * Starts drawing at the clicked square; the next click ends it. Undefined: a click selects or
   * deselects one square. With every tool a drag pans the map.
   */
  begin?: (start: Square) => DrawSession;
}

export const TOOLS: readonly SelectionTool[] = [
  { id: 'pan', label: 'Pointer', key: 'h', Icon: PointerIcon },
  {
    id: 'rectangle',
    label: 'Rectangle',
    key: 'r',
    Icon: RectangleIcon,
    cursor: 'crosshair',
    begin: rectangleSession,
  },
];

export const toolById = (id: ToolId): SelectionTool => TOOLS.find(tool => tool.id === id) ?? TOOLS[0];
