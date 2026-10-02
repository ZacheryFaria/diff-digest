// Run an API call from an event handler. A failure shows as a toast, with the error's hint.
import { z } from "zod";

const HintSchema = z.object({ data: z.object({ hint: z.string() }) });

export function errorText(e: unknown): string {
    const text = e instanceof Error ? e.message : String(e);
    const hint = HintSchema.safeParse(e).data?.data.hint;
    return hint === undefined ? text : `${text} ${hint}`;
}

export function attempt(toast: (text: string) => void, what: string, run: () => Promise<void>): void {
    run().then(
        () => null,
        (e: unknown) => {
            toast(`${what}: ${errorText(e)}`);
        },
    );
}
