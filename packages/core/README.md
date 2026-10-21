# @gaia/core

Code that the web app (`packages/web`), the server (`packages/server`) and the root scripts share. No React and no map library.

- `grid`: the square grid. A square is its south-west corner in 1/100 degree. Longitude wraps. Packed key `(lat << 16) | lng`.
- `shape`: the shape rules and the prices of `GaiaAuction`. `validateShape` returns the name of the contract error.
- `settlement`: the chunk rule of `settleShape`. A chunk always continues to the end of its row.
- `deployment`: `parseDeployment` checks the JSON of a deployment file (`deployments/local.json`, and the same format for Base). It does not read files, so it works in Node and in the browser.
- `api`: the types of the server API (auction state, viewport snapshot, stream messages). First draft.
- `abis`: the ABIs of the six Gaia contracts, as `as const` TypeScript, for typed viem and wagmi calls.

The ABI files in `src/abis/` are generated from `artifacts/` and are in git. After a contract change, run `yarn hardhat compile` and `yarn workspace @gaia/core abis`, then commit the files. CI runs `yarn workspace @gaia/core abis:check`, which fails if the files are not the same as the artifacts.

The package exports its TypeScript source. The web app and the server compile it with their own build tool.

```
yarn workspace @gaia/core test
yarn workspace @gaia/core typecheck
```
