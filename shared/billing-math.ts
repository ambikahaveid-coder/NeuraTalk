export function calculateBillableSecondsForBudget(options: {
  budgetPaise: number;
  ratePerMinutePaise: number;
  perSecondBilling: boolean;
}): number {
  const budgetPaise = Math.max(0, Math.floor(options.budgetPaise));
  const ratePerMinutePaise = Math.max(0, Math.floor(options.ratePerMinutePaise));

  if (budgetPaise <= 0 || ratePerMinutePaise <= 0) {
    return 0;
  }

  if (options.perSecondBilling) {
    return Math.floor((budgetPaise * 60) / ratePerMinutePaise);
  }

  return Math.floor(budgetPaise / ratePerMinutePaise) * 60;
}

export function calculateChargeIncrement(options: {
  elapsedPaidSeconds: number;
  ratePerMinutePaise: number;
  billedRemainder: number;
  perSecondBilling: boolean;
  seconds?: number;
}): { deltaPaise: number; nextRemainder: number } {
  const ratePerMinutePaise = Math.max(0, Math.floor(options.ratePerMinutePaise));
  const seconds = Math.max(0, Math.floor(options.seconds ?? 1));
  const elapsedPaidSeconds = Math.max(0, Math.floor(options.elapsedPaidSeconds));
  const billedRemainder = Math.max(0, Math.floor(options.billedRemainder));

  if (ratePerMinutePaise <= 0 || seconds <= 0 || elapsedPaidSeconds <= 0) {
    return { deltaPaise: 0, nextRemainder: billedRemainder };
  }

  if (options.perSecondBilling) {
    const accumulated = billedRemainder + (ratePerMinutePaise * seconds);
    const deltaPaise = Math.floor(accumulated / 60);
    return {
      deltaPaise,
      nextRemainder: accumulated - (deltaPaise * 60),
    };
  }

  const previousPaidSeconds = Math.max(0, elapsedPaidSeconds - seconds);
  const billedUnitsBefore = previousPaidSeconds > 0 ? Math.ceil(previousPaidSeconds / 60) : 0;
  const billedUnitsAfter = Math.ceil(elapsedPaidSeconds / 60);
  const deltaUnits = Math.max(0, billedUnitsAfter - billedUnitsBefore);

  return {
    deltaPaise: deltaUnits * ratePerMinutePaise,
    nextRemainder: 0,
  };
}

export function simulateChargeForDuration(options: {
  durationSeconds: number;
  ratePerMinutePaise: number;
  perSecondBilling: boolean;
}): { totalPaise: number; remainderPaise: number } {
  let totalPaise = 0;
  let remainderPaise = 0;

  for (let elapsedPaidSeconds = 1; elapsedPaidSeconds <= Math.max(0, Math.floor(options.durationSeconds)); elapsedPaidSeconds += 1) {
    const next = calculateChargeIncrement({
      elapsedPaidSeconds,
      ratePerMinutePaise: options.ratePerMinutePaise,
      billedRemainder: remainderPaise,
      perSecondBilling: options.perSecondBilling,
    });
    totalPaise += next.deltaPaise;
    remainderPaise = next.nextRemainder;
  }

  return { totalPaise, remainderPaise };
}
