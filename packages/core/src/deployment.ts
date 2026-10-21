// The deployment file: the addresses and the start values of one Gaia deployment.
//
// `yarn deploy:local` writes deployments/local.json. A Base deployment uses the same format.
// This module does not read files, so it works in Node and in the browser. Give it the parsed
// JSON.

import { z } from 'zod';

export type Address = `0x${string}`;

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address')
  .transform((value) => value as Address);

const uint = z.number().int().nonnegative();

export const deploymentSchema = z.object({
  chainId: uint.positive(),
  /** The first block with Gaia events. An indexer starts here. */
  deployBlock: uint,
  contracts: z.object({
    GaiaCountries: address,
    GaiaSquares: address,
    GaiaCountryAccount: address,
    GaiaAuction: address,
    GaiaLandSale: address,
    GaiaCountryMarket: address,
    ERC6551Registry: address,
  }),
  admin: address,
  treasury: address,
  /**
   * The auction times at deployment, in Unix seconds. A late bid moves `endTime` up to
   * `maxEndTime`, so read the current `endTime()` from the auction. Do not use this value for it.
   */
  auction: z
    .object({
      startTime: uint,
      endTime: uint,
      maxEndTime: uint,
    })
    .refine((t) => t.startTime < t.endTime && t.endTime <= t.maxEndTime, {
      message: 'must have startTime < endTime <= maxEndTime',
    }),
});

export type Deployment = z.infer<typeof deploymentSchema>;
export type ContractName = keyof Deployment['contracts'];

/**
 * Checks the JSON of a deployment file and returns it with types. Throws an error that names
 * each wrong field.
 */
export const parseDeployment = (json: unknown): Deployment => {
  const result = deploymentSchema.safeParse(json);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new Error(`Invalid deployment file:\n  ${problems.join('\n  ')}`);
};
