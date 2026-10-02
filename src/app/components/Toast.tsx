// A short message at the bottom of the page.
import { useEffect, type ReactNode } from "react";

export interface ToastMessage {
    readonly text: string;
    readonly url?: string | undefined;
    readonly at: number;
}

export function Toast({
    message,
    onDone,
}: {
    readonly message: ToastMessage | null;
    readonly onDone: () => void;
}): ReactNode {
    useEffect(() => {
        const timer = message === null ? undefined : setTimeout(onDone, message.url === undefined ? 3500 : 8000);
        return () => {
            clearTimeout(timer);
        };
    }, [message, onDone]);
    if (message === null) return null;
    return (
        <div id="toast">
            {message.text}{" "}
            {message.url === undefined ? null : (
                <a href={message.url} target="_blank" rel="noreferrer">
                    Open
                </a>
            )}
        </div>
    );
}
