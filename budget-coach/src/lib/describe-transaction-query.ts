import type { Category } from "@/domain/categories";
import { SHORT_MONTH_NAMES } from "@/constants/month-names";

export interface TransactionQuery {
  category?: Category;
  search?: string;
  month?: string;
  startDate?: string;
  endDate?: string;
}

const ordinal = (day: number): string => {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};

// Formats from the ISO string directly rather than via Date, so a timezone
// offset can never shift the displayed day.
const formatDay = (isoDate: string): string =>
  `${ordinal(Number(isoDate.slice(8, 10)))} ${SHORT_MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1]}`;

const formatMonth = (isoMonth: string): string => `${SHORT_MONTH_NAMES[Number(isoMonth.slice(5, 7)) - 1]} ${isoMonth.slice(0, 4)}`;

// The lead-in sentence the listTransactions card shows above its rows, e.g.
// "On 18th Sep, you had 4 transactions:".
export const describeTransactionQuery = (query: TransactionQuery, count: number): string => {
  const { category, search, month, startDate, endDate } = query;
  const when =
    startDate && startDate === endDate
      ? `On ${formatDay(startDate)}`
      : startDate && endDate
        ? `Between ${formatDay(startDate)} and ${formatDay(endDate)}`
        : startDate
          ? `Since ${formatDay(startDate)}`
          : endDate
            ? `Up to ${formatDay(endDate)}`
            : month
              ? `In ${formatMonth(month)}`
              : undefined;
  const noun = `${category ? `${category} ` : ""}transaction${count === 1 ? "" : "s"}${search ? ` matching "${search}"` : ""}`;
  return when ? `${when}, you had ${count} ${noun}:` : `You had ${count} ${noun}:`;
};
