// Limits that the contract and the CLI's flag defaults share. No imports: the CLI loads it at start.

/** The longest `actions.wait`: just under the 2-hour limit of a Claude Code background task. */
export const MAX_WAIT_MS = 6_900_000;
