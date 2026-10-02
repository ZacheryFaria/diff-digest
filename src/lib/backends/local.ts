// The local backend: Markdown files in a folder (for glow, vim, or an Obsidian vault).
import { join } from "node:path";
import { expandHome } from "../paths";
import { unrenderLinks } from "../render";
import { slug } from "../repo";
import type { BackendConfig } from "../schemas";
import { unwrapFrontmatter, wrapFrontmatter } from "./envelope";
import type { Anchor } from "../digest";
import { DigestError } from "../errors";
import type { Backend, BackendDeps, DigestMeta, LinkContext, Location, Published, Pulled } from "./types";

type LocalConfig = Extract<BackendConfig, { type: "local" }>;

function fill(template: string, values: Readonly<Record<string, string>>): string {
    return template.replaceAll(/\{(\w+)\}/gu, (match: string, key: string) => values[key] ?? match);
}

function fillDeep(value: unknown, values: Readonly<Record<string, string>>): unknown {
    if (typeof value === "string") return fill(value, values);
    if (Array.isArray(value)) return value.map((v: unknown) => fillDeep(v, values));
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]: readonly [string, unknown]) => [k, fillDeep(v, values)]),
        );
    }
    return value;
}

type LocalLocation = Extract<Location, { type: "local" }>;

function localEnvelope(config: LocalConfig, loc: LocalLocation, body: string, meta: DigestMeta): string {
    const extra = fillDeep(config.frontmatter ?? {}, { repo: loc.repo, branch: meta.branch });
    const record = typeof extra === "object" && extra !== null ? Object.fromEntries(Object.entries(extra)) : {};
    return wrapFrontmatter(body, meta, record);
}

function publishLocal(
    name: string,
    config: LocalConfig,
    deps: BackendDeps,
    loc: LocalLocation,
    body: string,
    meta: DigestMeta,
): Published {
    const updated = deps.readFile(loc.digestPath) !== null;
    deps.writeFile(loc.digestPath, localEnvelope(config, loc, body, meta));
    return { backend: name, ref: loc.digestPath, updated, warnings: [] };
}

function pullLocal(deps: BackendDeps, loc: LocalLocation): Pulled | null {
    const text = deps.readFile(loc.digestPath);
    if (text === null) return null;
    const { body, meta } = unwrapFrontmatter(text, loc.digestPath);
    return { body: unrenderLinks(body), meta, ref: loc.digestPath };
}

function linkLocal(config: LocalConfig, anchor: Anchor, ctx: LinkContext): string | null {
    const template = config.linkTemplate ?? "none";
    if (template === "none") return null;
    const path = ctx.resolvePath(anchor.path) ?? anchor.path;
    return fill(template, {
        root: ctx.root,
        path,
        start: String(anchor.start),
        end: String(anchor.end),
        sha: ctx.head,
    });
}

export function createLocalBackend(name: string, config: LocalConfig, deps: BackendDeps): Backend {
    const at = (location: Location): Promise<LocalLocation> =>
        location.type === "local"
            ? Promise.resolve(location)
            : Promise.reject(new DigestError("BAD_INPUT", `${name} is a local backend.`));
    return {
        name,
        type: "local",
        locate: input => {
            const dir = expandHome(
                fill(config.dir, { repo: input.repo, branch: slug(input.branch === "" ? input.name : input.branch) }),
            );
            return Promise.resolve({
                type: "local",
                digestPath: join(dir, `${input.name}.md`),
                reviewPath: join(dir, `${input.name}.review.md`),
                repo: input.repo,
            });
        },
        envelope: async (location, body, meta) => localEnvelope(config, await at(location), body, meta),
        publish: async (location, body, meta) => publishLocal(name, config, deps, await at(location), body, meta),
        publishReview: async (location, review) => {
            const loc = await at(location);
            const updated = deps.readFile(loc.reviewPath) !== null;
            deps.writeFile(loc.reviewPath, review);
            return { backend: name, ref: loc.reviewPath, updated, warnings: [] };
        },
        pull: async location => pullLocal(deps, await at(location)),
        anchorLink: (anchor, ctx) => linkLocal(config, anchor, ctx),
    };
}
