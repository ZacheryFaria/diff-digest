// `pull` looks for the digest in each backend in order. A backend that fails does not stop the search.
import type { Backend, LocateInput, Pulled } from "../backends/types";
import { DigestError } from "../errors";
import { failureOf, type BackendFailure } from "./failures";

export { backendsFor } from "../backends/registry";

interface Found {
    readonly backend: string;
    readonly pulled: Pulled;
}

async function pullFrom(backend: Backend, input: LocateInput): Promise<Pulled | null> {
    const location = await backend.locate(input);
    return location === null ? null : backend.pull(location);
}

/** Tries each backend in order and stops at the first one that has the digest. A failed backend is skipped. */
async function firstPull(
    backends: readonly Backend[],
    input: LocateInput,
    failures: readonly BackendFailure[] = [],
    index = 0,
): Promise<{ readonly found: Found | null; readonly failures: readonly BackendFailure[] }> {
    const backend = backends[index];
    if (backend === undefined) return { found: null, failures };
    let pulled: Pulled | null;
    try {
        pulled = await pullFrom(backend, input);
    } catch (error) {
        return firstPull(backends, input, [...failures, failureOf(backend.name, error)], index + 1);
    }
    if (pulled !== null) return { found: { backend: backend.name, pulled }, failures };
    return firstPull(backends, input, failures, index + 1);
}

function notFound(name: string, failures: readonly BackendFailure[]): DigestError {
    const failed = failures.map(f => `${f.backend} failed: ${f.message}`);
    return new DigestError("NOT_FOUND", `No backend has a digest for ${name}.`, {
        hint: [...failed, "Make one with `diff-digest init`."].join("\n"),
        ...(failures.length === 0 ? {} : { data: failures }),
    });
}

/** The digest from the first backend that has it, or NOT_FOUND (with the failed backends in the hint). */
export async function findPulled(backends: readonly Backend[], input: LocateInput): Promise<Found> {
    const { found, failures } = await firstPull(backends, input);
    if (found === null) throw notFound(input.name, failures);
    return found;
}
