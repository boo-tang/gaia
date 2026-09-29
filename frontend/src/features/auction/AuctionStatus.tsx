import { useEffect, useState } from 'react';
import { formatEther } from 'viem';

import { useAuctionConfig, usePendingReturns, useWithdraw } from '../../chain/useGaiaAuction';

const formatDuration = (totalSeconds: number) => {
  const seconds = Math.max(0, totalSeconds);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ') || '0s';
};

const useNowSeconds = (intervalMs = 1000) => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};

export const AuctionStatus = () => {
  const { config } = useAuctionConfig();
  const nowSeconds = useNowSeconds();
  const { data: pendingReturnsData, refetch: refetchPendingReturns } = usePendingReturns();
  const { withdraw, isPending: isWithdrawing } = useWithdraw();

  if (!config) return null;

  const hasStarted = nowSeconds >= Number(config.startTime);
  const hasEnded = nowSeconds > Number(config.endTime);
  const secondsRemaining = hasStarted
    ? Number(config.endTime) - nowSeconds
    : Number(config.startTime) - nowSeconds;

  const pendingReturn = pendingReturnsData?.[0]?.result as bigint | undefined;

  const onWithdraw = async () => {
    await withdraw();
    refetchPendingReturns();
  };

  return (
    <div className="auction-status">
      <span>
        {hasEnded ? 'Auction ended' : `${hasStarted ? 'Ends' : 'Starts'} in ${formatDuration(secondsRemaining)}`}
      </span>
      {!!pendingReturn && pendingReturn > 0n && (
        <button onClick={onWithdraw} disabled={isWithdrawing}>
          {isWithdrawing ? 'Withdrawing…' : `Withdraw ${formatEther(pendingReturn)} ETH`}
        </button>
      )}
    </div>
  );
};
