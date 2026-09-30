#!/usr/bin/env node
// Usage:
//   diff-digest path
//   diff-digest hunks    [--base <ref>]
//   diff-digest check    <digest.md> [--base <ref>]
//   diff-digest serve    <digest.md> [--base <ref>] [--port <n>] [--open]
//   diff-digest wait     <digest.md> [--max-seconds <n>]
//   diff-digest comments <digest.md>
//   diff-digest resolve  <digest.md> <comment-id> <reply>
//   diff-digest note     <digest.md> <target-text> <body>
//   diff-digest export   <digest.md> [--base <ref>] [--open]
import { execFileSync, spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, watchFile, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GENERATED = [
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock)$/,
    /\.snap$/,
    /(^|\/)__generated__\//,
    /\.pb\.(ts|go)$|_pb2\.py$/,
    /\.min\.(js|css)$|\.map$/,
    ...(process.env.DIFF_DIGEST_GENERATED ?? "").split(",").filter(Boolean).map(r => new RegExp(r)),
];
const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)/;
const ANCHOR = /`([\w@#.\/-]+\.\w+):(\d+)(?:-(\d+))?`/g;
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

async function main() {
    switch (cmd) {
        case "path":
            return cmdPath();
        case "hunks":
            return cmdHunks();
        case "check":
            return cmdCheck();
        case "serve":
            return cmdServe();
        case "wait":
            return cmdWait();
        case "comments":
            return cmdComments();
        case "resolve":
            return cmdResolve();
        case "note":
            return cmdNote();
        case "export":
            return cmdExport();
        default:
            console.error("usage: diff-digest <path|hunks|check|serve|wait|comments|resolve|note|export> ...");
            process.exit(2);
    }
}

function cmdPath() {
    const remote = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" }).stdout.trim();
    const repo = remote ? basename(remote).replace(/\.git$/, "") : basename(root);
    const dir = process.env.DIFF_DIGEST_DIR ?? join(homedir(), ".diff-digest", repo);
    mkdirSync(dir, { recursive: true });
    const branch = git(["branch", "--show-current"]).trim() || git(["rev-parse", "--short", "HEAD"]).trim();
    console.log(join(dir, `${branch.replaceAll("/", "-")}.md`));
}

function cmdHunks() {
    const base = resolveBase(flags.base);
    const files = changedFiles(base);
    console.log(`base ${base.slice(0, 11)}  head ${git(["rev-parse", "--short", "HEAD"]).trim()}\n`);
    for (const f of files) {
        console.log(`${f.cls.padEnd(9)} ${f.status} ${f.oldPath !== f.path ? `${f.oldPath} -> ` : ""}${f.path}`);
        if (f.cls === "generated") continue;
        for (const h of reviewableHunks(base, f)) console.log(`          @@ ${h.start}-${h.end} (${h.size} lines)`);
    }
    console.log(`\nreviewable diff lines: ${diffLineCount(base, files)}`);
}

function cmdCheck() {
    const md = readFileSync(flags._[0], "utf8");
    const base = resolveBase(flags.base ?? frontmatter(md).base);
    const gaps = coverageGaps(md, base);
    if (gaps.length === 0) {
        console.log("OK: every reviewable hunk has an anchor. Import-only and moved-code hunks are ignored.");
        return;
    }
    console.log(`${gaps.length} hunk(s) have no anchor:\n`);
    for (const g of gaps) console.log(`  ${g}`);
    process.exit(1);
}

function cmdServe() {
    const mdPath = resolve(flags._[0]);
    const sidecar = sidecarPaths(mdPath);
    const queue = [];
    const waiters = new Set();
    const clients = new Set();

    const broadcast = event => {
        for (const c of clients) c.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const status = () => ({ type: "status", listening: waiters.size > 0, queued: queue.length });
    const deliver = action => {
        const [waiter] = waiters;
        if (waiter) {
            waiters.delete(waiter);
            waiter.end(JSON.stringify(action));
        } else {
            queue.push(action);
        }
        broadcast(status());
    };

    watchFile(mdPath, { interval: 400 }, () => broadcast({ type: "digest" }));
    watchFile(sidecar.comments, { interval: 400 }, () => broadcast({ type: "comments" }));

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        try {
            if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/"))) {
                const file = url.pathname === "/" ? "index.html" : url.pathname.slice(4);
                const full = resolve(UI_DIR, file);
                if (!full.startsWith(UI_DIR)) return send(res, 403, "forbidden");
                res.writeHead(200, { "content-type": MIME[extname(full)] ?? "text/plain" });
                return res.end(readFileSync(full));
            }
            if (url.pathname === "/api/digest") return sendJson(res, digestPayload(mdPath, flags.base));
            if (url.pathname === "/api/file") {
                const base = baseFor(mdPath);
                return sendJson(res, filePayload(base, url.searchParams.get("path"), url.searchParams.get("rev")));
            }
            if (url.pathname === "/api/diff") {
                const base = baseFor(mdPath);
                const f = findFile(changedFiles(base), url.searchParams.get("path"));
                return sendJson(res, f ? { text: rawDiff(base, f, 3), path: f.path, oldPath: f.oldPath } : { text: "" });
            }
            if (url.pathname === "/api/comments" && req.method === "GET") {
                return sendJson(res, readComments(sidecar.comments));
            }
            if (url.pathname === "/api/comments" && req.method === "POST") {
                const body = JSON.parse(await readBody(req));
                const comments = readComments(sidecar.comments);
                const comment = {
                    id: randomUUID().slice(0, 8),
                    created: new Date().toISOString(),
                    author: "user",
                    status: "open",
                    target: body.target,
                    body: body.body,
                };
                comments.push(comment);
                writeComments(sidecar.comments, comments);
                return sendJson(res, comment);
            }
            const del = url.pathname.match(/^\/api\/comments\/([\w-]+)$/);
            if (del && req.method === "DELETE") {
                writeComments(
                    sidecar.comments,
                    readComments(sidecar.comments).filter(c => c.id !== del[1]),
                );
                return sendJson(res, { ok: true });
            }
            if (url.pathname === "/api/action" && req.method === "POST") {
                const { type } = JSON.parse(await readBody(req));
                if (type !== "apply" && type !== "review") return send(res, 400, "bad action");
                deliver({
                    type,
                    digest: mdPath,
                    comments: readComments(sidecar.comments).filter(c => c.status === "open"),
                });
                return sendJson(res, status());
            }
            if (url.pathname === "/api/wait") {
                if (queue.length > 0) {
                    res.end(JSON.stringify(queue.shift()));
                    return broadcast(status());
                }
                waiters.add(res);
                res.on("close", () => {
                    waiters.delete(res);
                    broadcast(status());
                });
                return broadcast(status());
            }
            if (url.pathname === "/api/events") {
                res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
                clients.add(res);
                res.write(`data: ${JSON.stringify(status())}\n\n`);
                req.on("close", () => clients.delete(res));
                return;
            }
            send(res, 404, "not found");
        } catch (err) {
            send(res, 500, String(err?.stack ?? err));
        }
    });
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.listen(Number(flags.port ?? 0), "127.0.0.1", () => {
        const url = `http://127.0.0.1:${server.address().port}/`;
        writeFileSync(sidecar.server, JSON.stringify({ url, pid: process.pid }));
        console.log(`serving ${mdPath}\n${url}`);
        if (flags.open) spawnSync("open", [url]);
    });
}

async function cmdWait() {
    const mdPath = resolve(flags._[0]);
    const { url } = JSON.parse(readFileSync(sidecarPaths(mdPath).server, "utf8"));
    const maxMs = Number(flags["max-seconds"] ?? 6900) * 1000;
    const result = await new Promise(done => {
        const req = request(new URL("api/wait", url), res => {
            let data = "";
            res.on("data", c => (data += c));
            res.on("end", () => done(data));
        });
        req.on("error", err => done(JSON.stringify({ type: "error", message: String(err) })));
        req.setTimeout(maxMs, () => {
            req.destroy();
            done(JSON.stringify({ type: "timeout" }));
        });
        req.end();
    });
    const action = JSON.parse(result);
    console.log(`ACTION: ${action.type}`);
    console.log(JSON.stringify(action, null, 2));
}

function cmdComments() {
    const comments = readComments(sidecarPaths(resolve(flags._[0])).comments).filter(c => c.status === "open");
    console.log(JSON.stringify(comments, null, 2));
}

function cmdResolve() {
    const [mdPath, id, ...reply] = flags._;
    const file = sidecarPaths(resolve(mdPath)).comments;
    const comments = readComments(file);
    const c = comments.find(x => x.id === id);
    if (!c) {
        console.error(`no comment ${id}`);
        process.exit(1);
    }
    c.status = "resolved";
    c.reply = reply.join(" ");
    writeComments(file, comments);
    console.log(`resolved ${id}`);
}

function cmdNote() {
    const [mdPath, text, ...body] = flags._;
    const file = sidecarPaths(resolve(mdPath)).comments;
    const comments = readComments(file);
    comments.push({
        id: randomUUID().slice(0, 8),
        created: new Date().toISOString(),
        author: "agent",
        status: "note",
        target: { kind: "digest", text },
        body: body.join(" "),
    });
    writeComments(file, comments);
    console.log("noted");
}

function cmdExport() {
    const mdPath = resolve(flags._[0]);
    const payload = { ...digestPayload(mdPath, flags.base), static: true, repoUrl: repoWebUrl() };
    const inline = name => readFileSync(join(UI_DIR, name), "utf8");
    const html = inline("index.html")
        .replace('<link rel="stylesheet" href="/ui/styles.css" />', () => `<style>${inline("styles.css")}</style>`)
        .replace(
            '<script type="module" src="/ui/app.js"></script>',
            () =>
                `<script>window.__DIGEST__ = ${JSON.stringify(payload).replace(/</g, "\\u003c")};</script>\n` +
                `<script type="module">${inline("app.js")}</script>`,
        );
    const out = mdPath.replace(/\.md$/, "") + ".html";
    writeFileSync(out, html);
    console.log(out);
    if (flags.open) spawnSync("open", [out]);
}

function parseFlags(args) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--open") out.open = true;
        else if (args[i].startsWith("--")) out[args[i].slice(2)] = args[++i];
        else out._.push(args[i]);
    }
    return out;
}

function git(args) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
}

function resolveBase(ref) {
    if (ref) return git(["rev-parse", ref]).trim();
    for (const b of ["origin/master", "origin/main", "master", "main"]) {
        const r = spawnSync("git", ["merge-base", "HEAD", b], { cwd: root, encoding: "utf8" });
        if (r.status === 0) return r.stdout.trim();
    }
    throw new Error("No base found. Use --base <ref>.");
}

function baseFor(mdPath) {
    return resolveBase(flags.base ?? frontmatter(readFileSync(mdPath, "utf8")).base);
}

function frontmatter(md) {
    const m = md.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    return Object.fromEntries(m[1].split("\n").map(l => l.split(/:\s*/, 2)).filter(p => p.length === 2));
}

function changedFiles(base) {
    return git(["diff", "--no-ext-diff", "--name-status", "-M", base])
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [status, a, b] = line.split("\t");
            const path = b ?? a;
            const cls = GENERATED.some(r => r.test(path)) ? "generated" : TEST.test(path) ? "test" : "source";
            return { status: status[0], oldPath: a, path, cls };
        });
}

function findFile(files, suffix) {
    if (!suffix) return undefined;
    return files.find(f => matchesPath(f.path, suffix) || matchesPath(f.oldPath, suffix));
}

function matchesPath(file, suffix) {
    return file === suffix || file.endsWith(`/${suffix}`);
}

function parseDiff(text) {
    const hunks = [];
    let cur = null;
    let oldN = 0;
    let newN = 0;
    for (const line of text.split("\n")) {
        const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (m) {
            oldN = Number(m[1]);
            newN = Number(m[3]);
            const count = m[4] === undefined ? 1 : Number(m[4]);
            cur = {
                start: Math.max(newN, 1),
                end: Math.max(newN + count - 1, newN, 1),
                oldStart: oldN,
                oldCount: m[2] === undefined ? 1 : Number(m[2]),
                newStart: newN,
                newCount: count,
                removed: [],
                added: [],
            };
            hunks.push(cur);
        } else if (!cur || /^(\+\+\+|---) /.test(line)) {
            continue;
        } else if (line.startsWith("-")) {
            cur.removed.push({ n: oldN++, text: line.slice(1) });
        } else if (line.startsWith("+")) {
            cur.added.push({ n: newN++, text: line.slice(1) });
        } else if (line.startsWith(" ")) {
            oldN++;
            newN++;
        }
    }
    for (const h of hunks) h.size = h.removed.length + h.added.length;
    return hunks;
}

function rawDiff(base, f, context = 0) {
    const paths = f.oldPath !== f.path ? [f.oldPath, f.path] : [f.path];
    return git(["diff", "--no-ext-diff", `-U${context}`, "-M", base, "--", ...paths]);
}

// Drops hunks that only touch imports, and hunks whose lines all moved within the file.
function reviewableHunks(base, f) {
    const hunks = parseDiff(rawDiff(base, f));
    const oldImports = f.status === "A" ? new Set() : importLines(git(["show", `${base}:${f.oldPath}`]));
    const newImports = f.status === "D" ? new Set() : importLines(readFileSync(join(root, f.path), "utf8"));
    const allRemoved = new Set(hunks.flatMap(h => h.removed.map(l => l.text.trim())));
    const allAdded = new Set(hunks.flatMap(h => h.added.map(l => l.text.trim())));
    return hunks.filter(h => {
        const importOnly =
            h.removed.every(l => oldImports.has(l.n) || !l.text.trim()) &&
            h.added.every(l => newImports.has(l.n) || !l.text.trim());
        const moved =
            h.added.every(l => !l.text.trim() || allRemoved.has(l.text.trim())) &&
            h.removed.every(l => !l.text.trim() || allAdded.has(l.text.trim()));
        return !importOnly && !moved;
    });
}

function importLines(text) {
    const lines = new Set();
    let inImport = false;
    text.split("\n").forEach((line, i) => {
        if (/^\s*import\b/.test(line) || /^\s*export\s+(\*|\{[^}]*\})\s+from\b/.test(line)) inImport = true;
        if (inImport) lines.add(i + 1);
        if (inImport && /(from\s+["'][^"']+["']|^\s*import\s+["'][^"']+["'])\s*;?\s*$/.test(line)) inImport = false;
    });
    return lines;
}

function diffLineCount(base, files) {
    return files
        .filter(f => f.cls !== "generated")
        .reduce((n, f) => n + parseDiff(rawDiff(base, f)).reduce((s, h) => s + h.size, 0), 0);
}

function anchors(md) {
    return [...md.matchAll(ANCHOR)].map(m => ({ path: m[1], start: Number(m[2]), end: Number(m[3] ?? m[2]) }));
}

function coverageGaps(md, base) {
    const as = anchors(md);
    const gaps = [];
    for (const f of changedFiles(base)) {
        if (f.cls === "generated") continue;
        const own = as.filter(a => matchesPath(f.path, a.path) || matchesPath(f.oldPath, a.path));
        if (f.status === "D") {
            if (!md.includes(f.oldPath.split("/").pop())) gaps.push(`${f.oldPath} (deleted)`);
            continue;
        }
        for (const h of reviewableHunks(base, f)) {
            if (!own.some(a => a.start <= h.end + 1 && a.end >= h.start - 1)) gaps.push(`${f.path}:${h.start}-${h.end}`);
        }
    }
    return gaps;
}

function digestPayload(mdPath, baseFlag) {
    const md = readFileSync(mdPath, "utf8");
    const fm = frontmatter(md);
    const base = resolveBase(baseFlag ?? fm.base);
    const files = changedFiles(base);
    const body = md.replace(/^---\n[\s\S]*?\n---\n/, "");
    return {
        md: body,
        files,
        head: git(["rev-parse", "HEAD"]).trim(),
        meta: {
            ...fm,
            diffLines: diffLineCount(base, files),
            digestLines: body.split("\n").filter(l => l.trim()).length,
            generated: files.filter(f => f.cls === "generated").length,
            files: files.length,
        },
        version: statSync(mdPath).mtimeMs,
    };
}

function filePayload(base, suffix, rev) {
    const f = findFile(changedFiles(base), suffix);
    const path = f?.path ?? resolveTracked(suffix);
    if (!path) return { error: `No file matches ${suffix}` };
    const oldPath = f?.oldPath ?? path;
    const hunks = f ? parseDiff(rawDiff(base, f)) : [];
    if (rev === "base") {
        if (f?.status === "A") return { path, rev, text: "", marks: {}, error: "Added in this change" };
        const marks = {};
        for (const h of hunks) for (const l of h.removed) marks[l.n] = "removed";
        return { path: oldPath, rev, text: git(["show", `${base}:${oldPath}`]), marks, hunks: hunkSummary(hunks) };
    }
    const full = join(root, path);
    if (!existsSync(full)) return { path, rev: "head", text: "", marks: {}, error: "Deleted in this change" };
    const marks = {};
    for (const h of hunks) {
        for (const l of h.added) marks[l.n] = h.removed.length ? "changed" : "added";
        if (h.added.length === 0) marks[h.start] = marks[h.start] ?? "deleted-after";
    }
    return { path, oldPath, rev: "head", text: readFileSync(full, "utf8"), marks, hunks: hunkSummary(hunks) };
}

function hunkSummary(hunks) {
    return hunks.map(h => ({
        oldStart: h.oldStart,
        oldCount: h.oldCount,
        newStart: h.newStart,
        newCount: h.newCount,
        added: h.added.map(l => l.n),
        removed: h.removed,
    }));
}

function resolveTracked(suffix) {
    if (!suffix || suffix.includes("..")) return undefined;
    const r = spawnSync("git", ["ls-files", "--", suffix, `**/${suffix}`], { cwd: root, encoding: "utf8" });
    const hits = r.stdout.trim().split("\n").filter(Boolean);
    return hits.length === 1 ? hits[0] : undefined;
}

function repoWebUrl() {
    const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
    const m = r.stdout.trim().match(/^(?:git@|https:\/\/)([^:/]+)[:/](.+?)(?:\.git)?$/);
    return m ? `https://${m[1]}/${m[2]}` : undefined;
}

function sidecarPaths(mdPath) {
    const stem = mdPath.replace(/\.md$/, "");
    return { comments: `${stem}.comments.json`, server: `${stem}.server.json` };
}

function readComments(file) {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

function writeComments(file, comments) {
    writeFileSync(file, JSON.stringify(comments, null, 2));
}

function readBody(req) {
    return new Promise(done => {
        let data = "";
        req.on("data", c => (data += c));
        req.on("end", () => done(data));
    });
}

function send(res, code, text) {
    res.writeHead(code, { "content-type": "text/plain" });
    res.end(text);
}

function sendJson(res, obj) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
}

await main();
