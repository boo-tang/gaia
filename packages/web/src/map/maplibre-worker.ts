// MapLibre looks for its web worker next to its own module file. Vite moves the module when it
// bundles it, so give MapLibre a worker that Vite bundles too (`worker.format: 'es'` in
// vite.config.ts). Import this file before a map is made.
import { setWorkerUrl } from 'maplibre-gl';
// eslint-disable-next-line no-restricted-imports -- the worker file of the package, not our build
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
