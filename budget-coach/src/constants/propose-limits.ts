// The buffer applied over trailing received spend when proposing a Category
// Limit (ADR-0011): a limit set exactly at last period's spend would be
// breached by any normal variation, so each proposal gets 10% of headroom
// above what was actually spent. 1.1 = spent + 10%.
export const LIMIT_BUFFER_MULTIPLIER = 1.1;
