// The texts of the errors of a transaction: a revert of the simulation, a wallet rejection, or an
// error of the RPC node or the wallet.
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  UserRejectedRequestError,
  WebSocketRequestError,
} from 'viem';

/** The text of a contract error, by error name. It gets the decoded arguments of the error. */
export type ErrorTexts = Record<string, (args: readonly unknown[]) => string>;

/** A wallet rejection is not an error: the flow goes back to its start. */
export type TxErrorText = { rejected: true } | { rejected: false; text: string; detail?: string };

const firstLine = (text: string) => text.split('\n')[0];

const isRejection = (error: unknown) =>
  error instanceof UserRejectedRequestError || (error as { code?: unknown }).code === 4001;

const isNetworkError = (error: unknown) =>
  error instanceof HttpRequestError || error instanceof TimeoutError || error instanceof WebSocketRequestError;

/**
 * The text of a transaction error. `failed` starts the texts with no own entry in `texts`, for
 * example "The bid failed".
 */
export const describeTxError = (error: unknown, failed: string, texts: ErrorTexts): TxErrorText => {
  if (!(error instanceof BaseError)) {
    if (isRejection(error)) {
      return { rejected: true };
    }
    const message = error instanceof Error ? firstLine(error.message) : String(error);
    return { rejected: false, text: `${failed}: ${message}` };
  }
  if (error.walk(isRejection) !== null) {
    return { rejected: true };
  }
  const detail = firstLine(error.shortMessage);
  const reverted = error.walk(e => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    const name = reverted.data?.errorName;
    if (name !== undefined) {
      const text = texts[name];
      return {
        rejected: false,
        text: text === undefined ? `${failed}: ${name}.` : text(reverted.data?.args ?? []),
        detail,
      };
    }
    if (reverted.reason !== undefined) {
      return { rejected: false, text: `${failed}: ${reverted.reason}.`, detail };
    }
    const code = reverted.signature ?? reverted.raw;
    return { rejected: false, text: `${failed}: unknown error${code === undefined ? '' : ` (${code})`}.`, detail };
  }
  if (error.walk(isNetworkError) !== null) {
    return { rejected: false, text: 'Cannot reach the chain. Check your connection and try again.', detail };
  }
  return { rejected: false, text: `${failed}: ${detail}`, detail };
};
