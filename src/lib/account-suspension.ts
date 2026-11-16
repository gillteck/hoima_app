export function priorBanDuration(originalBannedUntil: string | null, now: number): string {
  const remaining = originalBannedUntil ? Date.parse(originalBannedUntil) - now : 0;
  return remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : "none";
}

export function ownsSuspension(appliedBannedUntil: string | null, currentBannedUntil: string | undefined): boolean {
  return Boolean(appliedBannedUntil && currentBannedUntil && Date.parse(appliedBannedUntil) === Date.parse(currentBannedUntil));
}