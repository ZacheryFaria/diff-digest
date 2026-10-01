export const ERROR_CODES = [
    "BAD_INPUT",
    "NOT_FOUND",
    "LINT_FAILED",
    "COVERAGE_GAP",
    "STALE",
    "NO_BACKEND",
    "BACKEND_FAILED",
    "BAD_CONFIG",
    "SERVER_DOWN",
    "GIT_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Exit code for each error code. Usage errors from the CLI parser exit with 2. */
export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
    BAD_INPUT: 3,
    NOT_FOUND: 4,
    LINT_FAILED: 5,
    COVERAGE_GAP: 6,
    STALE: 7,
    NO_BACKEND: 8,
    BACKEND_FAILED: 9,
    BAD_CONFIG: 10,
    SERVER_DOWN: 11,
    GIT_FAILED: 12,
};

export interface DigestErrorOptions {
    hint?: string;
    data?: unknown;
    cause?: unknown;
}

export class DigestError extends Error {
    readonly code: ErrorCode;
    readonly hint: string | undefined;
    readonly data: unknown;

    constructor(code: ErrorCode, message: string, options: Readonly<DigestErrorOptions> = {}) {
        super(message, { cause: options.cause });
        this.name = "DigestError";
        this.code = code;
        this.hint = options.hint;
        this.data = options.data;
    }

    toJSON(): { code: ErrorCode; message: string; hint?: string; data?: unknown } {
        return {
            code: this.code,
            message: this.message,
            ...(this.hint === undefined ? {} : { hint: this.hint }),
            ...(this.data === undefined ? {} : { data: this.data }),
        };
    }
}
