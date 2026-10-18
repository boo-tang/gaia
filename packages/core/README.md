# @gaia/core

Code that the web app (`apps/web`), the server (`apps/server`) and the root scripts share. No React and no map library.

- `grid`: the square grid. A square is its south-west corner in 1/100 degree. Longitude wraps. Packed key `(lat << 16) | lng`.
- `shape`: the shape rules and the prices of `GaiaAuction`. `validateShape` returns the name of the contract error.
- `settlement`: the chunk rule of `settleShape`. A chunk always continues to the end of its row.

The package exports its TypeScript source. The apps compile it with their own build tool.

```
npm test -w @gaia/core
npm run typecheck -w @gaia/core
```
