// Backend failures in a publish report: one backend that fails does not stop the others.
import type { Backend, Published } from "../backends/types";
import { DigestError } from "../errors";
import type { BackendFailure } from "./schemas";

export type { BackendFailure } from "./schemas";

/** A backend error as a report entry. */
export function failureOf(backend: string, error: unknown): BackendFailure {
    return {
        backend,
        code: error instanceof DigestError ? error.code : "INTERNAL",
        message: error instanceof Error ? error.message : String(error),
    };
}

/** Throws BACKEND_FAILED when a backend failed and no backend published (the others were skipped). */
export function checkNotAllFailed(failures: readonly BackendFailure[], published: number): void {
    if (failures.length === 0 || published > 0) return;
    const [only] = failures;
    // One failure keeps its own code (for example BAD_INPUT for a body over the size limit).
    if (failures.length === 1 && only !== undefined) throw new DigestError(only.code, only.message, { data: failures });
    throw new DigestError(
        "BACKEND_FAILED",
        `No backend published: ${failures.map(f => f.backend).join(", ")} failed.`,
        {
            hint: failures.map(f => `${f.backend}: ${f.message}`).join("\n"),
            data: failures,
        },
    );
}

/** Runs `run` for each placed backend. A failed backend goes into `errors`; the others still run. */
export async function settleEach<T extends { readonly backend: Backend }>(
    items: readonly T[],
    run: (item: T) => Promise<Published>,
): Promise<{ readonly results: Published[]; readonly errors: BackendFailure[] }> {
    const settled = await Promise.allSettled(items.map(item => run(item)));
    const results: Published[] = [];
    const errors: BackendFailure[] = [];
    for (const [i, r] of settled.entries()) {
        if (r.status === "fulfilled") results.push(r.value);
        else errors.push(failureOf(items[i]?.backend.name ?? "", r.reason));
    }
    return { results, errors };
}
