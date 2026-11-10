import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = {
  amount: string;
  currency: string;
};

export function toDecimal(value: string | number): Decimal {
  return new Decimal(value);
}

export function normalizeAmount(value: string | number): string {
  return toDecimal(value).toFixed(6);
}

export function amountsEqual(a: string | number, b: string | number): boolean {
  return toDecimal(a).eq(toDecimal(b));
}

export function formatMoney(amount: string | number, currency: string, locale = "pt-BR"): string {
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(toDecimal(amount).toNumber());
  } catch {
    return `${currency} ${toDecimal(amount).toFixed(decimals)}`;
  }
}

export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function priceDifference(a: string | number, b: string | number): {
  amount: string;
  percent: string;
} {
  const first = toDecimal(a);
  const second = toDecimal(b);
  const diff = second.minus(first);
  const percent = first.isZero() ? new Decimal(0) : diff.dividedBy(first).times(100);
  return {
    amount: diff.toFixed(6),
    percent: percent.toFixed(6),
  };
}

export function sumAmounts(amounts: Array<string | number>): string {
  return amounts.reduce((total, amount) => total.plus(toDecimal(amount)), new Decimal(0)).toFixed(6);
}
