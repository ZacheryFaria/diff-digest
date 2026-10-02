// Joins the class names that are on (a `false` part is off).
export function classes(parts: readonly (string | false)[]): string {
    return parts.filter(p => p !== false).join(" ");
}
