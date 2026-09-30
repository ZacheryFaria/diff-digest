#!/usr/bin/env bun
// Usage:
//   diff-digest path      [--name <name>]
//   diff-digest target    [<pr-url | #pr | branch | commit | a..b>]
//   diff-digest hunks     [--base <ref>] [--head <ref>]
//   diff-digest check     <digest.md> [--base <ref>] [--head <ref>]
//   diff-digest serve     <digest.md> [--port <n>] [--open]
//   diff-digest wait      <digest.md> [--max-seconds <n>]
//   diff-digest comments  <digest.md>
//   diff-digest resolve   <digest.md> <comment-id> <reply>
//   diff-digest note      <digest.md> <target-text> <body>
//   diff-digest publish   <digest.md> [--pr <pr>] [--dry-run]
//   diff-digest pull      <pr> [--force] [--body-file <file>]
//   diff-digest review-md <digest.md>
//   diff-digest export    <digest.md> [--open]
//   diff-digest config    [--init]
//   diff-digest format | prompt review-agent
import { execFileSync, spawnSync } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, watchFile, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BUILTIN_GENERATED = [
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.sum|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock)$/,
    /\.snap$/,
    /(^|\/)__generated__\//,
    /\.pb\.(ts|go)$|_pb2\.py$/,
    /\.min\.(js|css)$|\.map$/,
];
const HOME_DIR = process.env.DIFF_DIGEST_HOME ?? join(homedir(), ".diff-digest");
const CONFIG_PATH = join(HOME_DIR, "config.json");
const CONFIG_TEMPLATE = {
    generated: [],
    repos: {},
};
const TEST = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/__tests__\/)|(_test\.(go|py)$)|((^|\/)test_[^/]+\.py$)/;
const ANCHOR = /`([\w@#.\/-]+\.\w+):(\d+)(?:-(\d+))?`/g;
const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIR = join(REPO_DIR, "ui");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const DIGEST_MARK = "<!-- diff-digest:";
const COMMENTS_MARK = "<!-- diff-digest-comments:";
const COMMENT_LIMIT = 65536;

const [cmd, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
// null means the working tree. A pinned digest reads the head commit instead.
let headRef = null;

async function main() {
    const commands = {
        path: cmdPath,
        target: cmdTarget,
        hunks: cmdHunks,
        check: cmdCheck,
        serve: cmdServe,
        wait: cmdWait,
        comments: cmdComments,
        resolve: cmdResolve,
        note: cmdNote,
        publish: cmdPublish,
        pull: cmdPull,
        "review-md": cmdReviewMd,
        export: cmdExport,
        config: cmdConfig,
        format: () => process.stdout.write(readFileSync(join(REPO_DIR, "docs", "format.md"), "utf8")),
        prompt: () => process.stdout.write(readFileSync(join(REPO_DIR, "prompts", `${flags._[0]}.md`), "utf8")),
    };
    const run = commands[cmd];
    if (!run) {
        console.error(`usage: diff-digest <${Object.keys(commands).join("|")}> ...`);
        process.exit(2);
    }
    try {
        await run();
    } catch (err) {
        console.error(`diff-digest ${cmd}: ${err.message}`);
        process.exit(1);
    }
}

function cmdConfig() {
    if (flags.init === "true" && !existsSync(CONFIG_PATH)) {
        mkdirSync(HOME_DIR, { recursive: true });
        writeFileSync(CONFIG_PATH, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`);
    }
    const cfg = repoConfig();
    console.log(
        JSON.stringify(
            {
                path: CONFIG_PATH,
                exists: existsSync(CONFIG_PATH),
                repo: cfg.repoKeys,
                digestDir: digestDir(),
                generated: cfg.generated,
            },
            null,
            2,
        ),
    );
}

function cmdPath() {
    console.log(join(digestDir(), `${slug(flags.name ?? currentBranch())}.md`));
}

function cmdTarget() {
    console.log(JSON.stringify(resolveTarget(flags._[0]), null, 2));
}

function cmdHunks() {
    const base = resolveBase(flags.base);
    if (flags.head) headRef = rev(flags.head);
    const files = changedFiles(base);
    console.log(`base ${short(base)}  head ${headRef ? short(headRef) : "working tree"}\n`);
    for (const f of files) {
        console.log(`${f.cls.padEnd(9)} ${f.status} ${f.oldPath !== f.path ? `${f.oldPath} -> ` : ""}${f.path}`);
        if (!isReviewable(f)) continue;
        for (const h of reviewableHunks(base, f)) console.log(`          @@ ${h.start}-${h.end} (${h.size} lines)`);
    }
    console.log(`\nreviewable diff lines: ${diffLineCount(base, files)}`);
}

function cmdCheck() {
    const mdPath = resolve(flags._[0]);
    const base = contextFor(mdPath);
    const gaps = coverageGaps(readFileSync(mdPath, "utf8"), base);
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
        const route = `${req.method} ${url.pathname}`;
        try {
            if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui/"))) {
                const file = url.pathname === "/" ? "index.html" : url.pathname.slice(4);
                const full = resolve(UI_DIR, file);
                if (!full.startsWith(UI_DIR)) return send(res, 403, "forbidden");
                res.writeHead(200, { "content-type": MIME[extname(full)] ?? "text/plain" });
                return res.end(readFileSync(full));
            }
            if (route === "GET /api/digest") return sendJson(res, digestPayload(mdPath));
            if (route === "GET /api/file") {
                const base = contextFor(mdPath);
                return sendJson(res, filePayload(base, url.searchParams.get("path"), url.searchParams.get("rev")));
            }
            if (route === "GET /api/diff") {
                const base = contextFor(mdPath);
                const f = findFile(changedFiles(base), url.searchParams.get("path"));
                return sendJson(res, f ? { text: rawDiff(base, f, 3), path: f.path, oldPath: f.oldPath } : { text: "" });
            }
            if (route === "GET /api/comments") return sendJson(res, readComments(sidecar.comments));
            if (route === "POST /api/comments") {
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
                writeComments(sidecar.comments, readComments(sidecar.comments).filter(c => c.id !== del[1]));
                return sendJson(res, { ok: true });
            }
            if (route === "POST /api/action") {
                const { type } = JSON.parse(await readBody(req));
                if (type !== "apply" && type !== "review") return send(res, 400, "bad action");
                deliver({
                    type,
                    digest: mdPath,
                    comments: readComments(sidecar.comments).filter(c => c.status === "open"),
                });
                return sendJson(res, status());
            }
            if (route === "GET /api/review-md") {
                const open = readComments(sidecar.comments).filter(c => c.status === "open" && c.author === "user");
                return sendJson(res, { body: reviewMarkdown(mdPath), count: open.length });
            }
            if (route === "POST /api/post-review") {
                const { body } = JSON.parse(await readBody(req));
                return sendJson(res, postReview(mdPath, body));
            }
            if (route === "POST /api/publish") return sendJson(res, publishDigest(mdPath));
            if (route === "GET /api/wait") {
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
            if (route === "GET /api/events") {
                res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
                clients.add(res);
                res.write(`data: ${JSON.stringify(status())}\n\n`);
                req.on("close", () => clients.delete(res));
                return;
            }
            send(res, 404, "not found");
        } catch (err) {
            send(res, 500, err?.message ?? String(err));
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
    const action = JSON.parse(result || '{"type":"error","message":"empty response"}');
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
    if (!c) throw new Error(`no comment ${id}`);
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

function cmdPublish() {
    const result = publishDigest(resolve(flags._[0]), flags.pr);
    if (result.dryRun) process.stdout.write(result.body);
    else console.log(JSON.stringify(result, null, 2));
}

function cmdPull() {
    const ref = parsePrRef(flags._[0] ?? "");
    if (!ref) throw new Error("Give a PR URL or number.");
    const pr = prInfo(ref);
    ensureCommits(pr);
    const out = join(digestDir(), `${slug(pr.headRef)}.md`);
    if (existsSync(out) && flags.force !== "true") {
        throw new Error(`${out} already exists. Use it, or run pull again with --force to replace it.`);
    }
    const checkedOut = pr.headRef === currentBranch();
    const base = mergeBase(pr.baseSha, pr.headSha);
    const found = flags["body-file"]
        ? { body: readFileSync(flags["body-file"], "utf8"), html_url: flags["body-file"] }
        : findComment(pr, DIGEST_MARK);
    if (!found) {
        console.log(JSON.stringify({ found: false, path: out, checkedOut, pr, base, head: pr.headSha }, null, 2));
        return;
    }
    const md = fromGithub(found.body, pr, !checkedOut);
    writeFileSync(out, md);
    const fm = frontmatter(md);
    const digestHead = hasCommit(fm.head) ? rev(fm.head) : null;
    console.log(
        JSON.stringify(
            {
                found: true,
                path: out,
                comment: found.html_url,
                checkedOut,
                pr,
                digestHead,
                stale: digestHead !== pr.headSha,
                headMissing: !digestHead,
            },
            null,
            2,
        ),
    );
}

function cmdReviewMd() {
    process.stdout.write(reviewMarkdown(resolve(flags._[0])));
}

function cmdExport() {
    const mdPath = resolve(flags._[0]);
    const payload = { ...digestPayload(mdPath), static: true, repoUrl: repoWebUrl() };
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

// ---- targets and GitHub ----

function resolveTarget(arg) {
    const target = arg ?? (currentBranch() || "HEAD");
    const withPath = t => {
        const digest = join(digestDir(), `${t.name}.md`);
        return { ...t, digest, digestExists: existsSync(digest) };
    };
    const ref = parsePrRef(target);
    if (ref) {
        const pr = prInfo(ref);
        const checkedOut = pr.headRef === currentBranch();
        return withPath({
            kind: "pr",
            name: slug(pr.headRef),
            branch: pr.headRef,
            checkedOut,
            base: checkedOut ? resolveBase() : null,
            head: pr.headSha,
            pr,
        });
    }
    if (target.includes("..")) {
        const [a, b] = target.split(/\.{2,3}/);
        const head = rev(b || "HEAD");
        const name = `range-${short(rev(a))}-${short(head)}`;
        return withPath({ kind: "range", name, checkedOut: false, base: rev(a), head, pr: null });
    }
    const sha = tryRev(target);
    if (!sha) throw new Error(`Not a PR, branch, or commit: ${target}`);
    const branch = [`refs/heads/${target}`, `refs/remotes/origin/${target}`].some(r =>
        spawnSync("git", ["show-ref", "--verify", "--quiet", r], { cwd: root }).status === 0,
    );
    if (branch) {
        const name = target.replace(/^origin\//, "");
        return withPath({
            kind: "branch",
            name: slug(name),
            branch: name,
            checkedOut: name === currentBranch(),
            base: resolveBase(undefined, sha),
            head: sha,
            pr: findPrForBranch(name),
        });
    }
    const name = `commit-${short(sha)}`;
    return withPath({ kind: "commit", name, checkedOut: false, base: rev(`${sha}^`), head: sha, pr: null });
}

function parsePrRef(arg) {
    const url = arg.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (url) return { host: url[1], owner: url[2], repo: url[3], number: Number(url[4]) };
    const num = arg.match(/^#?(\d+)$/);
    if (num) return { ...originRepo(), number: Number(num[1]) };
    return null;
}

function prInfo(ref) {
    const p = JSON.parse(gh(ref.host, ["api", `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`]));
    return {
        ...ref,
        url: p.html_url,
        title: p.title,
        state: p.state,
        baseRef: p.base.ref,
        baseSha: p.base.sha,
        headRef: p.head.ref,
        headSha: p.head.sha,
    };
}

function findPrForBranch(branch) {
    const repo = originRepo();
    if (!repo) return null;
    const r = spawnSync("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--limit", "1"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GH_HOST: repo.host },
    });
    const [hit] = r.status === 0 ? JSON.parse(r.stdout || "[]") : [];
    return hit ? prInfo({ ...repo, number: hit.number }) : null;
}

function ensureCommits(pr) {
    if (!hasCommit(pr.headSha)) spawnSync("git", ["fetch", "-q", "origin", `pull/${pr.number}/head`], { cwd: root });
    if (!hasCommit(pr.baseSha)) spawnSync("git", ["fetch", "-q", "origin", pr.baseRef], { cwd: root });
    for (const sha of [pr.headSha, pr.baseSha]) {
        if (!hasCommit(sha)) throw new Error(`Could not fetch commit ${short(sha)} from origin.`);
    }
}

function findComment(pr, mark) {
    const out = gh(pr.host, [
        "api",
        "--paginate",
        `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
        "--jq",
        `.[] | select(.body | startswith("${mark}")) | {id, html_url, body}`,
    ]);
    const hits = out.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
    return hits.at(-1) ?? null;
}

function postComment(pr, body, existingId) {
    const path = existingId
        ? `repos/${pr.owner}/${pr.repo}/issues/comments/${existingId}`
        : `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`;
    const out = gh(pr.host, ["api", "-X", existingId ? "PATCH" : "POST", path, "--input", "-"], JSON.stringify({ body }));
    return JSON.parse(out);
}

function publishDigest(mdPath, prArg) {
    const base = contextFor(mdPath);
    const md = readFileSync(mdPath, "utf8");
    const fm = frontmatter(md);
    const ref = parsePrRef(prArg ?? fm.pr ?? "");
    const pr = ref ? prInfo(ref) : findPrForBranch(fm.branch ?? currentBranch());
    if (!pr) throw new Error("No PR found. Use --pr <url>.");
    const head = rev(fm.head ?? "HEAD");
    const body = toGithub(md, { pr, head, base, files: changedFiles(base) });
    if (body.length > COMMENT_LIMIT) {
        throw new Error(`The digest is ${body.length} characters. GitHub allows ${COMMENT_LIMIT}. Make it shorter.`);
    }
    if (flags["dry-run"] === "true") return { dryRun: true, body };
    const existing = findComment(pr, DIGEST_MARK);
    const c = postComment(pr, body, existing?.id);
    if (fm.pr !== pr.url) writeFileSync(mdPath, setFrontmatter(md, { pr: pr.url }));
    const warnings = [];
    if (head !== pr.headSha) warnings.push(`The digest is for ${short(head)}, but the PR head is ${short(pr.headSha)}.`);
    return { url: c.html_url, updated: Boolean(existing), warnings };
}

function postReview(mdPath, body) {
    const ref = parsePrRef(frontmatter(readFileSync(mdPath, "utf8")).pr ?? "");
    if (!ref) throw new Error("This digest has no PR.");
    const c = postComment(ref, body);
    const file = sidecarPaths(mdPath).comments;
    const comments = readComments(file);
    for (const x of comments) {
        if (x.status === "open" && x.author === "user") {
            x.status = "posted";
            x.reply = c.html_url;
        }
    }
    writeComments(file, comments);
    return { url: c.html_url };
}

function toGithub(md, { pr, head, base, files }) {
    const fm = frontmatter(md);
    const web = `https://${pr.host}/${pr.owner}/${pr.repo}`;
    const body = stripFrontmatter(md).replace(ANCHOR, (m, p, s, e) => {
        const full = findFile(files, p)?.path ?? resolveTracked(p);
        if (!full) return m;
        return `[${m}](${web}/blob/${head}/${full}#L${s}${e ? `-L${e}` : ""})`;
    });
    const meta = { v: 1, base, head, branch: fm.branch ?? pr.headRef };
    return (
        `${DIGEST_MARK} ${JSON.stringify(meta)} -->\n${body.trim()}\n\n` +
        `<sub>diff-digest · open locally: <code>/diff-digest ${pr.url}</code></sub>\n`
    );
}

function fromGithub(raw, pr, pinned) {
    const text = raw.replace(/\r\n/g, "\n");
    const m = text.match(/^<!-- diff-digest: (\{.*?\}) -->\n?/);
    if (!m) throw new Error("The comment has no diff-digest marker.");
    const meta = JSON.parse(m[1]);
    const body = text
        .slice(m[0].length)
        .replace(/\[(`[^`\n]+`)\]\(https?:\/\/[^)\s]+\/blob\/[^)\s]+\)/g, "$1")
        .replace(/\n*<sub>diff-digest ·[\s\S]*?<\/sub>\s*$/, "");
    const fm = { branch: meta.branch, base: meta.base, head: meta.head, pr: pr.url, pr_head: pr.headSha };
    if (pinned) fm.pinned = "true";
    return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${body.trim()}\n`;
}

function reviewMarkdown(mdPath) {
    const md = readFileSync(mdPath, "utf8");
    const fm = frontmatter(md);
    const comments = readComments(sidecarPaths(mdPath).comments).filter(c => c.status === "open" && c.author === "user");
    const ref = parsePrRef(fm.pr ?? "");
    const web = ref ? `https://${ref.host}/${ref.owner}/${ref.repo}` : repoWebUrl();
    const sha = { head: tryRev(fm.head ?? "") ?? fm.head, base: tryRev(fm.base ?? "") ?? fm.base };
    const indent = s => s.split("\n").map(l => `  ${l}`).join("\n");
    const quote = s => (s.length > 160 ? `${s.slice(0, 157)}…` : s).replace(/\|/g, "\\|");
    const out = [`${COMMENTS_MARK} ${JSON.stringify({ v: 1, head: sha.head })} -->`, "### Comments on the digest and code", ""];

    const onDigest = comments.filter(c => c.target.kind === "digest");
    if (onDigest.length) {
        out.push("**On the digest**", "");
        for (const c of onDigest) {
            const where = c.target.section ? `**${c.target.section}** · ` : "";
            out.push(`- ${where}“${quote(c.target.text ?? "")}”`, indent(c.body), "");
        }
    }
    const onCode = comments
        .filter(c => c.target.kind === "code")
        .sort((a, b) => a.target.path.localeCompare(b.target.path) || a.target.line - b.target.line);
    if (onCode.length) {
        out.push("**On the code**", "");
        for (const c of onCode) {
            const { path, line, rev: side, text } = c.target;
            const at = side === "base" ? sha.base : sha.head;
            const label = `\`${path.split("/").slice(-2).join("/")}:${line}\``;
            const link = web && at ? `[${label}](${web}/blob/${at}/${path}#L${line})` : label;
            out.push(`- ${link} (${side === "base" ? "before" : "after"}) — \`${quote(text ?? "")}\``, indent(c.body), "");
        }
    }
    if (!onDigest.length && !onCode.length) out.push("_No open comments._", "");
    out.push("<sub>diff-digest</sub>");
    return `${out.join("\n")}\n`;
}

function gh(host, args, input) {
    return execFileSync("gh", args, {
        cwd: root,
        encoding: "utf8",
        input,
        maxBuffer: 1 << 28,
        env: { ...process.env, ...(host ? { GH_HOST: host } : {}) },
    });
}

function originRepo() {
    const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
    const m = r.stdout.trim().match(/^(?:ssh:\/\/)?(?:git@|https?:\/\/)([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
    return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

function repoWebUrl() {
    const o = originRepo();
    return o ? `https://${o.host}/${o.owner}/${o.repo}` : undefined;
}

// ---- diff analysis ----

function parseFlags(args) {
    const out = { _: [] };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--open") out.open = true;
        else if (args[i] === "--dry-run") out["dry-run"] = "true";
        else if (args[i] === "--force") out.force = "true";
        else if (args[i] === "--init") out.init = "true";
        else if (args[i].startsWith("--")) out[args[i].slice(2)] = args[++i];
        else out._.push(args[i]);
    }
    return out;
}

function git(args, input) {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, input });
}

function rev(ref) {
    return git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

function tryRev(ref) {
    if (!ref) return null;
    const r = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
}

function hasCommit(sha) {
    return Boolean(sha) && spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root }).status === 0;
}

function short(sha) {
    return sha.slice(0, 11);
}

function mergeBase(a, b) {
    return git(["merge-base", a, b]).trim();
}

function currentBranch() {
    return git(["branch", "--show-current"]).trim();
}

function slug(s) {
    return (s || git(["rev-parse", "--short", "HEAD"]).trim()).replace(/[^\w.-]+/g, "-");
}

function digestDir() {
    const cfg = repoConfig();
    const repo = cfg.repoKeys[0];
    const dir = cfg.digestDir
        ? expandHome(cfg.digestDir.replaceAll("{repo}", repo))
        : join(HOME_DIR, "digests", repo);
    mkdirSync(dir, { recursive: true });
    return dir;
}

// Global settings, with the first matching entry in `repos` on top. A repo matches by name or by host/owner/name.
function repoConfig() {
    if (repoConfig.cache) return repoConfig.cache;
    let cfg = {};
    if (existsSync(CONFIG_PATH)) {
        try {
            cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
        } catch (err) {
            throw new Error(`${CONFIG_PATH} is not valid JSON: ${err.message}`);
        }
    }
    const o = originRepo();
    const repoKeys = [o?.repo ?? basename(root), ...(o ? [`${o.host}/${o.owner}/${o.repo}`] : [])];
    const key = repoKeys.find(k => cfg.repos?.[k]);
    const local = key ? cfg.repos[key] : {};
    const generated = [...(cfg.generated ?? []), ...(local.generated ?? [])];
    for (const r of generated) {
        try {
            new RegExp(r);
        } catch {
            throw new Error(`Bad regex in ${CONFIG_PATH}: ${r}`);
        }
    }
    repoConfig.cache = { repoKeys, digestDir: local.digestDir ?? cfg.digestDir, generated };
    return repoConfig.cache;
}

function generatedPatterns() {
    return [...BUILTIN_GENERATED, ...repoConfig().generated.map(r => new RegExp(r))];
}

function expandHome(p) {
    return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function resolveBase(ref, head = "HEAD") {
    if (ref) return rev(ref);
    for (const b of ["origin/HEAD", "origin/main", "origin/master", "main", "master"]) {
        const r = spawnSync("git", ["merge-base", head, b], { cwd: root, encoding: "utf8" });
        if (r.status === 0) return r.stdout.trim();
    }
    throw new Error("No base found. Use --base <ref>.");
}

// Reads the digest, sets headRef, and returns the base commit.
function contextFor(mdPath) {
    const fm = frontmatter(readFileSync(mdPath, "utf8"));
    headRef = flags.head ? rev(flags.head) : fm.pinned === "true" && fm.head ? rev(fm.head) : null;
    return resolveBase(flags.base ?? fm.base, headRef ?? "HEAD");
}

function frontmatter(md) {
    const m = md.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
}

function stripFrontmatter(md) {
    return md.replace(/^---\n[\s\S]*?\n---\n/, "");
}

function setFrontmatter(md, values) {
    const fm = { ...frontmatter(md), ...values };
    return `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${stripFrontmatter(md)}`;
}

function rangeArgs(base) {
    return headRef ? [base, headRef] : [base];
}

function newText(path) {
    return headRef ? git(["show", `${headRef}:${path}`]) : readFileSync(join(root, path), "utf8");
}

function newExists(path) {
    if (!headRef) return existsSync(join(root, path));
    return spawnSync("git", ["cat-file", "-e", `${headRef}:${path}`], { cwd: root }).status === 0;
}

function isReviewable(f) {
    return f.cls === "source" || f.cls === "test";
}

function changedFiles(base) {
    const range = rangeArgs(base);
    const files = git(["diff", "--no-ext-diff", "--name-status", "-M", ...range])
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [status, a, b] = line.split("\t");
            return { status: status[0], oldPath: a, path: b ?? a };
        });
    const binary = binaryPaths(range);
    const attrs = checkAttrs(files.map(f => f.path));
    const patterns = generatedPatterns();
    for (const f of files) {
        const a = attrs[f.path] ?? {};
        const isSet = v => v === "set" || v === "true";
        // linguist-generated=false only changes GitHub's diff view, so it does not make a file reviewable.
        if (isSet(a["linguist-generated"]) || isSet(a["linguist-vendored"])) f.cls = "generated";
        else if (a.filter === "lfs" || binary.has(f.path)) f.cls = "binary";
        else if (patterns.some(r => r.test(f.path))) f.cls = "generated";
        else f.cls = TEST.test(f.path) ? "test" : "source";
    }
    return files;
}

function binaryPaths(range) {
    const tokens = git(["diff", "--no-ext-diff", "--numstat", "-z", "-M", ...range]).split("\0");
    const out = new Set();
    for (let i = 0; i < tokens.length; i++) {
        const m = tokens[i].match(/^(\S+)\t(\S+)\t(.*)$/);
        if (!m) continue;
        const path = m[3] || tokens[i + 2];
        if (!m[3]) i += 2;
        if (m[1] === "-") out.add(path);
    }
    return out;
}

function checkAttrs(paths) {
    if (!paths.length) return {};
    const source = headRef ? [`--source=${headRef}`] : [];
    const out = git(
        ["check-attr", "-z", "--stdin", ...source, "linguist-generated", "linguist-vendored", "filter"],
        paths.join("\0") + "\0",
    ).split("\0");
    const attrs = {};
    for (let i = 0; i + 2 < out.length; i += 3) (attrs[out[i]] ??= {})[out[i + 1]] = out[i + 2];
    return attrs;
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
    return git(["diff", "--no-ext-diff", `-U${context}`, "-M", ...rangeArgs(base), "--", ...paths]);
}

// Drops hunks that only touch imports, and hunks whose lines all moved within the file.
function reviewableHunks(base, f) {
    const hunks = parseDiff(rawDiff(base, f));
    const oldImports = f.status === "A" ? new Set() : importLines(git(["show", `${base}:${f.oldPath}`]));
    const newImports = f.status === "D" ? new Set() : importLines(newText(f.path));
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
        .filter(isReviewable)
        .reduce((n, f) => n + parseDiff(rawDiff(base, f)).reduce((s, h) => s + h.size, 0), 0);
}

function anchors(md) {
    return [...md.matchAll(ANCHOR)].map(m => ({ path: m[1], start: Number(m[2]), end: Number(m[3] ?? m[2]) }));
}

function coverageGaps(md, base) {
    const as = anchors(md);
    const gaps = [];
    for (const f of changedFiles(base)) {
        if (!isReviewable(f)) continue;
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

function digestPayload(mdPath) {
    const base = contextFor(mdPath);
    const md = readFileSync(mdPath, "utf8");
    const fm = frontmatter(md);
    const files = changedFiles(base);
    const body = stripFrontmatter(md);
    const head = headRef ?? git(["rev-parse", "HEAD"]).trim();
    return {
        md: body,
        files,
        head,
        meta: {
            ...fm,
            pinned: Boolean(headRef),
            stale: Boolean(fm.pr_head && !fm.pr_head.startsWith(fm.head ?? "") && !(fm.head ?? "").startsWith(fm.pr_head)),
            diffLines: diffLineCount(base, files),
            digestLines: body.split("\n").filter(l => l.trim()).length,
            generated: files.filter(f => !isReviewable(f)).length,
            files: files.length,
        },
        version: statSync(mdPath).mtimeMs,
    };
}

function filePayload(base, suffix, side) {
    const f = findFile(changedFiles(base), suffix);
    const path = f?.path ?? resolveTracked(suffix);
    if (!path) return { error: `No file matches ${suffix}` };
    const oldPath = f?.oldPath ?? path;
    const hunks = f ? parseDiff(rawDiff(base, f)) : [];
    if (side === "base") {
        if (f?.status === "A") return { path, rev: side, text: "", marks: {}, error: "Added in this change" };
        const marks = {};
        for (const h of hunks) for (const l of h.removed) marks[l.n] = "removed";
        return { path: oldPath, rev: side, text: git(["show", `${base}:${oldPath}`]), marks, hunks: hunkSummary(hunks) };
    }
    if (!newExists(path)) return { path, rev: "head", text: "", marks: {}, error: "Deleted in this change" };
    const marks = {};
    for (const h of hunks) {
        for (const l of h.added) marks[l.n] = h.removed.length ? "changed" : "added";
        if (h.added.length === 0) marks[h.start] = marks[h.start] ?? "deleted-after";
    }
    return { path, oldPath, rev: "head", text: newText(path), marks, hunks: hunkSummary(hunks) };
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
    const args = headRef ? ["ls-tree", "-r", "--name-only", headRef] : ["ls-files"];
    const r = spawnSync("git", [...args, "--", suffix, `**/${suffix}`], { cwd: root, encoding: "utf8" });
    const hits = r.stdout.trim().split("\n").filter(Boolean);
    return hits.length === 1 ? hits[0] : undefined;
}

// ---- sidecar files and HTTP helpers ----

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
