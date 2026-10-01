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
