// Parameters that many commands share.

export const refPositional = {
    kind: "tuple",
    parameters: [
        {
            brief: "A branch, commit, range, or digest .md path (default: the current branch)",
            parse: String,
            placeholder: "ref",
            optional: true,
        },
    ],
} as const;

export interface JsonFlags {
    readonly json: boolean;
}

export const idFlag = {
    kind: "parsed",
    parse: String,
    brief: "The digest id (instead of a ref)",
    optional: true,
} as const;

export interface RefFlags extends JsonFlags {
    readonly id?: string;
}

export const refFlag = {
    kind: "parsed",
    parse: String,
    brief: "A branch, commit, range, or digest .md path",
    optional: true,
} as const;
