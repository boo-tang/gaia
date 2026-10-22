/// <reference types="vite/client" />

/** The deployment file, checked by `deployment-plugin.ts`. Use `config/app-config.ts`. */
declare module 'virtual:gaia-deployment' {
  const deployment: unknown;
  export default deployment;
}
