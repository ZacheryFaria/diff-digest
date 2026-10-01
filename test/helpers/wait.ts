/** Calls `check` until it gives true, and throws when `timeoutMs` passes first. Use it in place of fixed sleeps. */
export async function waitUntil(
    check: () => boolean | Promise<boolean>,
    timeoutMs = 2000,
    deadline = Date.now() + timeoutMs,
): Promise<void> {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`The condition was not true after ${timeoutMs} ms.`);
    await Bun.sleep(10);
    await waitUntil(check, timeoutMs, deadline);
}
