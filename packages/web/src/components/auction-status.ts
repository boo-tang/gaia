// The text of the auction status, from `GET /auction` and the current time.
import type { AuctionResponse } from '@gaia/core';

/** A duration as "2 d 4 h", "2 h 10 min", "5 min 3 s" or "42 s". */
export const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (days > 0) {
    return `${days} d ${hours} h`;
  }
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${rest} s`;
  }
  return `${rest} s`;
};

const formatTime = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export type AuctionPhase = 'cancelled' | 'paused' | 'notStarted' | 'open' | 'ended';

export interface AuctionStatusText {
  phase: AuctionPhase;
  text: string;
}

/** The phase and the text of the status bar at `nowSeconds` (Unix seconds). */
export const describeAuction = ({ rules, status }: AuctionResponse, nowSeconds: number): AuctionStatusText => {
  if (status.cancelled) {
    return { phase: 'cancelled', text: 'Auction cancelled. You can withdraw all your bids.' };
  }
  if (status.paused) {
    return { phase: 'paused', text: `Auction paused. End: ${formatTime(status.endTime)}` };
  }
  if (nowSeconds < rules.startTime) {
    return {
      phase: 'notStarted',
      text: `Starts ${formatTime(rules.startTime)} (in ${formatDuration(rules.startTime - nowSeconds)})`,
    };
  }
  if (nowSeconds < status.endTime) {
    return {
      phase: 'open',
      text: `Ends ${formatTime(status.endTime)} (in ${formatDuration(status.endTime - nowSeconds)})`,
    };
  }
  return { phase: 'ended', text: `Ended ${formatTime(status.endTime)}` };
};
