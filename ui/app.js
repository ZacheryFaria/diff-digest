import { marked } from "https://cdn.jsdelivr.net/npm/marked@12/lib/marked.esm.js";
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import hljs from "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/es/highlight.min.js";

const STATIC = Boolean(window.__DIGEST__);
const ANCHOR_RE = /^([\w@#.\/-]+\.\w+)(?::(\d+)(?:-(\d+))?)?$/;
const BLOCKS = "h1, h2, h3, h4, p, li, tbody tr, pre, blockquote";
const LANGS = { ts: "typescript", tsx: "typescript", js: "javascript", mjs: "javascript", jsx: "javascript",
    scss: "scss", css: "css", json: "json", yml: "yaml", yaml: "yaml", py: "python", go: "go",
    bzl: "python", bazel: "python", md: "markdown", sh: "bash" };

const $ = sel => document.querySelector(sel);
const content = $("#content");
const digestEl = $("#digest");
const state = { digest: null, comments: [], code: null, listening: false };

mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    themeVariables: {
        background: "#18191b", primaryColor: "#212225", primaryBorderColor: "#363a3f",
        primaryTextColor: "#edeef0", lineColor: "#868a92", fontFamily: "Inter, system-ui, sans-serif",
    },
});

await init();

async function init() {
    if (STATIC) document.body.classList.add("static");
    await loadDigest();
    if (!STATIC) {
        await loadComments();
        if (new URLSearchParams(location.search).get("live") !== "0") connectEvents();
        $("#apply").onclick = () => sendAction("apply");
        $("#review").onclick = () => sendAction("review");
        $("#publish").onclick = publishDigest;
        $("#post-review").onclick = openReviewDialog;
        $("#review-copy").onclick = () => navigator.clipboard.writeText($("#review-body").value).then(() => toast("Copied."));
        $("#review-post").onclick = postReview;
    }
    for (const b of document.querySelectorAll(".tabs button[data-rev]")) {
        b.onclick = () => state.code && openCode({ ...state.code, rev: b.dataset.rev });
    }
    const deep = location.hash.match(/^#code=(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    if (deep && !STATIC) {
        const start = deep[2] ? Number(deep[2]) : undefined;
        await openCode({ path: decodeURIComponent(deep[1]), start, end: deep[3] ? Number(deep[3]) : start, rev: "diff" });
    }
    $("#code-menu-btn").onclick = e => {
        e.stopPropagation();
        $("#code-menu").hidden = !$("#code-menu").hidden;
    };
    document.addEventListener("click", e => {
        if (!e.target.closest(".menu-wrap")) $("#code-menu").hidden = true;
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") $("#code-menu").hidden = true;
    });
    $("#code-close").onclick = () => {
        $("#code").hidden = true;
        state.code = null;
        markActiveAnchor();
        markActiveFile();
    };
}

async function loadDigest() {
    state.digest = STATIC ? window.__DIGEST__ : await getJson("/api/digest");
    const scroll = digestEl.scrollTop;
    renderMeta();
    renderTree();
    await renderDigest();
    renderComments();
    digestEl.scrollTop = scroll;
}

async function loadComments() {
    state.comments = await getJson("/api/comments");
    renderComments();
    if (state.code) renderCodeComments();
    const open = state.comments.filter(c => c.status === "open").length;
    $("#apply").textContent = `Apply comments (${open})`;
    $("#apply").title = "Claude acts on your comments now: edits the digest, answers questions, or changes code";
    $("#apply").disabled = open === 0;
    $("#post-review").disabled = open === 0 || !state.digest?.meta.pr;
}

function connectEvents() {
    const es = new EventSource("/api/events");
    es.onmessage = e => {
        const ev = JSON.parse(e.data);
        if (ev.type === "status") setListening(ev);
        if (ev.type === "digest") loadDigest();
        if (ev.type === "comments") loadComments();
    };
    es.onerror = () => setListening({ listening: false, offline: true });
}

function setListening({ listening, queued, offline }) {
    state.listening = listening;
    const el = $("#listen");
    el.classList.toggle("on", listening);
    el.textContent = offline ? "Server offline" : listening ? "Claude is listening" : queued ? `Queued (${queued})` : "Claude is not listening";
}

async function publishDigest() {
    const pr = state.digest.meta.pr;
    if (!confirm(`Post this digest to ${pr ?? "the PR for this branch"}? If a digest comment already exists, it is updated.`)) return;
    try {
        const r = await postJson("/api/publish", {});
        toast(`${r.updated ? "Updated" : "Posted"} the digest comment.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}`, r.url);
    } catch (err) {
        toast(`Could not post: ${err.message}`);
    }
}

async function openReviewDialog() {
    const { body, count } = await getJson("/api/review-md");
    $("#review-body").value = body;
    $("#review-count").textContent = `${count} comment${count === 1 ? "" : "s"} · ${state.digest.meta.pr ?? ""}`;
    $("#review-post").disabled = !state.digest.meta.pr;
    $("#review-dialog").showModal();
}

async function postReview() {
    try {
        const r = await postJson("/api/post-review", { body: $("#review-body").value });
        $("#review-dialog").close();
        toast("Posted the review comment.", r.url);
        await loadComments();
    } catch (err) {
        toast(`Could not post: ${err.message}`);
    }
}

async function sendAction(type) {
    const wasListening = state.listening;
    await fetch("/api/action", { method: "POST", body: JSON.stringify({ type }) });
    toast(wasListening
        ? type === "apply" ? "Sent. Claude is applying your comments." : "Sent. A new agent will review the digest."
        : "Queued. Claude gets it when its wait task starts again.");
}

function renderMeta() {
    const { meta } = state.digest;
    const chip = (k, v) => `<span class="chip">${k} <b>${escapeHtml(String(v))}</b></span>`;
    const ratio = meta.diffLines ? Math.round((meta.digestLines / meta.diffLines) * 100) : 0;
    const prNum = meta.pr?.match(/\/pull\/(\d+)/)?.[1];
    const shortSha = s => (s ?? "").slice(0, 11);
    $("#meta").innerHTML = [
        prNum && `<a class="chip" href="${escapeHtml(meta.pr)}" target="_blank">PR <b>#${prNum}</b></a>`,
        meta.pinned && `<span class="chip" title="The code comes from the head commit, not the working tree">code <b>pinned</b></span>`,
        meta.stale && `<span class="chip warn" title="The PR has commits that the digest does not describe">⚠️ digest is for <b>${shortSha(meta.head)}</b>, PR head is <b>${shortSha(meta.pr_head)}</b></span>`,
        meta.branch && chip("branch", meta.branch),
        meta.base && chip("base", shortSha(meta.base)),
        meta.head && chip("head", shortSha(meta.head)),
        chip("files", `${meta.files} (${meta.generated} generated)`),
        chip("diff", `${meta.diffLines} lines`),
        chip("digest", `${meta.digestLines} lines · ${ratio}%`),
    ].filter(Boolean).join("");
    if (!STATIC) {
        $("#publish").hidden = !meta.pr;
        $("#post-review").hidden = !meta.pr;
    }
    document.title = (state.digest.md.match(/^# (.*)$/m) ?? [, "Diff digest"])[1];
}

async function renderDigest() {
    const renderer = new marked.Renderer();
    const baseCode = renderer.code.bind(renderer);
    renderer.code = (code, lang, escaped) => {
        const text = typeof code === "object" ? code.text : code;
        const l = typeof code === "object" ? code.lang : lang;
        if (l === "mermaid") return `<pre class="mermaid" data-src="${escapeHtml(text)}">${escapeHtml(text)}</pre>`;
        return baseCode(code, lang, escaped);
    };
    content.innerHTML = marked.parse(state.digest.md, { renderer, gfm: true });
    try {
        await mermaid.run({ nodes: [...content.querySelectorAll("pre.mermaid")] });
    } catch (err) {
        console.error("mermaid", err);
    }

    let section = "";
    const seen = new Set();
    for (const el of content.querySelectorAll(BLOCKS)) {
        if (/^H[23]$/.test(el.tagName)) section = norm(el.textContent);
        if ([...seen].some(s => s.contains(el) && !(s.tagName === "LI" && el.tagName === "LI"))) continue;
        seen.add(el);
        const text = el.classList.contains("mermaid") ? el.dataset.src : norm(el.textContent);
        el.dataset.cid = hash(`${section}|${text}`);
        el.dataset.section = section;
        el.dataset.text = text.slice(0, 300);
        el.classList.add("commentable");
        const btn = commentButton(() => openComposer(el, { kind: "digest", cid: el.dataset.cid, section, text: el.dataset.text }));
        (el.tagName === "TR" ? el.firstElementChild : el).prepend(btn);
    }

    for (const c of content.querySelectorAll(":not(pre) > code")) linkAnchor(c);
    for (const tr of content.querySelectorAll("tr")) if (tr.textContent.includes("⚠️")) tr.classList.add("warn");
    markActiveAnchor();
}

// Changed files as a folder tree. A source or test file can be marked generated for future digests.
function renderTree() {
    const root = { dirs: new Map(), files: [] };
    for (const f of state.digest.files) {
        const parts = f.path.split("/");
        let node = root;
        for (const dir of parts.slice(0, -1)) {
            if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
            node = node.dirs.get(dir);
        }
        node.files.push({ ...f, name: parts.at(-1) });
    }
    const list = node => {
        const ul = document.createElement("ul");
        for (const [name, child] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b))) {
            // Join folders that hold only one folder, as GitHub does.
            let label = name;
            let n = child;
            while (n.files.length === 0 && n.dirs.size === 1) {
                const [[next, c]] = n.dirs;
                label += `/${next}`;
                n = c;
            }
            const li = document.createElement("li");
            li.innerHTML = `<div class="dir">${escapeHtml(label)}/</div>`;
            li.append(list(n));
            ul.append(li);
        }
        for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) ul.append(fileItem(f));
        return ul;
    };
    const tree = $("#tree");
    tree.innerHTML = "";
    tree.append(list(root));
    markActiveFile();
}

function fileItem(f) {
    const li = document.createElement("li");
    li.className = `file ${f.cls}`;
    li.dataset.path = f.path;
    li.title = f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path;
    li.innerHTML = `<span class="status s-${f.status}">${f.status}</span><span class="name">${escapeHtml(f.name)}</span>` +
        `<span class="cls">${f.cls}</span>`;
    if (!STATIC) li.onclick = () => openCode({ path: f.path, rev: f.status === "D" ? "base" : "diff" });
    return li;
}

function codeFile() {
    const path = state.code?.resolved ?? state.code?.path;
    return path && state.digest.files.find(f => f.path === path || f.path.endsWith(`/${path}`));
}

// The ⋯ menu in the code pane. A source or test file can be marked generated for future digests.
function renderCodeMenu() {
    const f = codeFile();
    const menu = $("#code-menu");
    const canMark = !STATIC && f && (f.marked || f.cls === "source" || f.cls === "test");
    $("#code-menu-btn").hidden = !canMark;
    menu.hidden = true;
    menu.innerHTML = "";
    if (!canMark) return;
    const b = document.createElement("button");
    b.textContent = f.marked ? "Unmark generated" : "Mark generated";
    b.title = f.marked
        ? "Review this file again in future digests"
        : "List this file as generated in future digests. Saved in ~/.diff-digest/config.json";
    b.onclick = async () => {
        menu.hidden = true;
        const name = f.path.split("/").pop();
        try {
            await postJson("/api/generated", { path: f.path, on: !f.marked });
            toast(f.marked ? `${name} is reviewable again.` : `${name} is marked generated.`);
            await loadDigest();
        } catch (err) {
            toast(`Could not save: ${err.message}`);
        }
    };
    menu.append(b);
}

function markActiveFile() {
    const path = state.code?.resolved ?? state.code?.path;
    renderCodeMenu();
    for (const li of document.querySelectorAll("#tree li.file")) {
        li.classList.toggle("active", Boolean(path) && (li.dataset.path === path || li.dataset.path.endsWith(`/${path}`)));
    }
}

function linkAnchor(codeEl) {
    const m = codeEl.textContent.match(ANCHOR_RE);
    if (!m) return;
    const [, path, s, e] = m;
    const start = s ? Number(s) : undefined;
    const end = e ? Number(e) : start;
    const a = document.createElement("a");
    a.className = "anchor";
    a.dataset.path = path;
    if (STATIC) {
        const f = state.digest.files.find(x => x.path === path || x.path.endsWith(`/${path}`));
        if (!f || !state.digest.repoUrl) return;
        a.href = `${state.digest.repoUrl}/blob/${state.digest.head}/${f.path}${start ? `#L${start}-L${end}` : ""}`;
        a.target = "_blank";
    } else {
        a.onclick = () => openCode({ path, start, end, rev: "diff" });
    }
    codeEl.replaceWith(a);
    a.appendChild(codeEl);
}

function markActiveAnchor() {
    for (const a of content.querySelectorAll("a.anchor")) {
        a.classList.toggle("active", Boolean(state.code) && a.dataset.path === state.code.anchor);
    }
}

function renderComments() {
    if (STATIC || !state.digest) return;
    for (const el of content.querySelectorAll(".thread, .thread-row")) el.remove();
    for (const el of content.querySelectorAll(".has-comments")) el.classList.remove("has-comments");
    const blocks = [...content.querySelectorAll("[data-cid]")];
    const groups = new Map();
    const orphans = [];
    for (const c of state.comments) {
        if (c.target.kind !== "digest") {
            orphans.push(c);
            continue;
        }
        const el = c.target.cid
            ? blocks.find(b => b.dataset.cid === c.target.cid)
            : blocks.find(b => norm(b.dataset.text).includes(norm(c.target.text)));
        if (!el) orphans.push(c);
        else groups.set(el, [...(groups.get(el) ?? []), c]);
    }
    for (const [el, list] of groups) {
        el.classList.add("has-comments");
        threadFor(el).append(...list.map(commentEl));
    }
    const box = $("#orphans");
    box.innerHTML = "";
    if (orphans.length) {
        box.innerHTML = "<h2>Other comments</h2>";
        for (const c of orphans) {
            const t = document.createElement("div");
            t.className = "thread";
            const where = c.target.kind === "code"
                ? `<code>${escapeHtml(c.target.path)}:${c.target.line}${c.target.endLine ? `-${c.target.endLine}` : ""}</code> (${c.target.rev})`
                : `<em>${escapeHtml((c.target.text ?? "").slice(0, 120))}</em> (text changed)`;
            t.innerHTML = `<div class="who">On ${where}</div>`;
            t.append(commentEl(c));
            box.append(t);
            const code = t.querySelector("code");
            if (code) linkAnchor(code);
        }
    }
}

function threadFor(el) {
    if (el.tagName === "TR") {
        let row = el.nextElementSibling;
        if (!row?.classList.contains("thread-row")) {
            row = document.createElement("tr");
            row.className = "thread-row";
            row.innerHTML = `<td colspan="${el.children.length}"><div class="thread"></div></td>`;
            el.after(row);
        }
        return row.querySelector(".thread");
    }
    let t = el.nextElementSibling;
    if (!t?.classList.contains("thread")) {
        t = document.createElement("div");
        t.className = "thread";
        if (el.tagName === "LI") el.append(t);
        else el.after(t);
    }
    return t;
}

function commentEl(c) {
    const d = document.createElement("div");
    d.className = `comment ${c.status}`;
    const who = c.author === "agent" ? "Agent · note" : c.status === "open" ? "You" : `You · ${c.status}`;
    const reply = c.status === "posted"
        ? `<a href="${escapeHtml(c.reply)}" target="_blank">Posted to the PR</a>`
        : escapeHtml(c.reply ?? "");
    d.innerHTML = `<div class="who">${who}</div><div>${escapeHtml(c.body)}</div>` +
        (c.reply ? `<div class="reply">↳ ${reply}</div>` : "");
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "Delete";
    del.onclick = async () => {
        await fetch(`/api/comments/${c.id}`, { method: "DELETE" });
        await loadComments();
    };
    d.prepend(del);
    return d;
}

function openComposer(el, target) {
    if (STATIC) return;
    const host = el.classList.contains("code-line") ? codeThreadFor(el) : threadFor(el);
    if (host.querySelector(".composer")) return host.querySelector("textarea").focus();
    const box = document.createElement("div");
    box.className = "composer";
    box.innerHTML = `<textarea placeholder="Comment for Claude…"></textarea>
        <div class="row"><button class="cancel">Cancel</button><button class="primary save">Comment</button></div>`;
    host.append(box);
    const ta = box.querySelector("textarea");
    ta.focus();
    const close = () => {
        box.remove();
        clearRange();
        if (!host.children.length) (host.closest(".thread-row, .code-thread") ?? host).remove();
    };
    box.querySelector(".cancel").onclick = close;
    const save = async () => {
        if (!ta.value.trim()) return close();
        await fetch("/api/comments", { method: "POST", body: JSON.stringify({ target, body: ta.value.trim() }) });
        await loadComments();
    };
    box.querySelector(".save").onclick = save;
    ta.onkeydown = e => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        if (e.key === "Escape") close();
    };
}

async function openCode({ path, start, end, rev, unchanged }) {
    state.code = { path, start, end, rev: unchanged ? "diff" : rev, anchor: path };
    $("#code").hidden = false;
    for (const b of document.querySelectorAll(".tabs button[data-rev]")) b.classList.toggle("on", b.dataset.rev === state.code.rev);
    markActiveFile();
    markActiveAnchor();
    const body = $("#code-body");
    if (rev === "diff") {
        const d = await getJson(`/api/diff?path=${encodeURIComponent(path)}`);
        $("#code-path").textContent = d.path ?? path;
        state.code.resolved = d.path;
        markActiveFile();
        body.innerHTML = "";
        if (!d.text) return openCode({ path, start, end, rev: "head", unchanged: true });
        body.append(diffTable(d, start, end, highlighterFor(d.path)));
        renderCodeComments();
        (body.querySelector(".hunk-focus") ?? body.querySelector(".added, .removed"))?.scrollIntoView({ block: "center" });
        return;
    }
    const file = await getJson(`/api/file?path=${encodeURIComponent(path)}&rev=${rev}`);
    $("#code-path").textContent = file.path ?? path;
    if (unchanged) {
        const tag = document.createElement("span");
        tag.className = "chip";
        tag.textContent = `unchanged from ${(state.digest.meta.base ?? "base").slice(0, 11)}`;
        $("#code-path").append(" ", tag);
    }
    state.code.resolved = file.path;
    markActiveFile();
    if (!file.text) {
        body.innerHTML = `<div class="code-error">${escapeHtml(file.error ?? "Empty file")}</div>`;
        return;
    }
    const highlight = highlighterFor(file.path);
    const related = start ? (file.hunks ?? []).filter(h => overlapsAnchor(h, start, end)) : [];
    const table = document.createElement("table");
    table.className = "code-table";

    const lineRow = (line, n) => {
        const tr = document.createElement("tr");
        tr.className = `code-line ${file.marks[n] ?? ""}`;
        Object.assign(tr.dataset, { path: file.path, rev, line: String(n) });
        if (rev === "head" && start && n >= start && n <= end) tr.classList.add(related.length ? "anchor-range" : "focus");
        tr.dataset.text = line;
        tr.innerHTML = `<td class="ln">${n}</td><td>${highlight(line)}</td>`;
        tr.firstElementChild.prepend(codeCommentButton(tr));
        return tr;
    };
    const removedRow = l => {
        const tr = document.createElement("tr");
        tr.className = "code-line removed inline-old";
        Object.assign(tr.dataset, { path: file.oldPath ?? file.path, rev: "base", line: String(l.n) });
        tr.dataset.text = l.text;
        tr.innerHTML = `<td class="ln">−${l.n}</td><td>${highlight(l.text)}</td>`;
        tr.firstElementChild.prepend(codeCommentButton(tr));
        return tr;
    };

    // Head: show the removed lines of each related hunk inline, above their replacement.
    const before = new Map();
    const after = new Map();
    if (rev === "head") {
        for (const h of related) {
            if (!h.removed.length) continue;
            if (h.added.length) before.set(h.added[0], h);
            else after.set(h.newStart, h);
        }
    }
    const lines = file.text.replace(/\n$/, "").split("\n");
    const rowsByHunk = new Map(related.map(h => [h, []]));
    const hunkOf = n => related.find(h => (rev === "head" ? h.added.includes(n) : h.removed.some(l => l.n === n)));
    const pushInline = h => {
        for (const l of h.removed) {
            const tr = removedRow(l);
            rowsByHunk.get(h).push(tr);
            table.append(tr);
        }
    };
    if (after.has(0)) pushInline(after.get(0));
    lines.forEach((line, i) => {
        const n = i + 1;
        if (before.has(n)) pushInline(before.get(n));
        const tr = lineRow(line, n);
        const h = hunkOf(n);
        if (h) rowsByHunk.get(h).push(tr);
        table.append(tr);
        if (after.has(n)) pushInline(after.get(n));
    });
    for (const rows of rowsByHunk.values()) {
        rows.forEach(tr => tr.classList.add("hunk-focus"));
        rows[0]?.classList.add("hunk-top");
        rows.at(-1)?.classList.add("hunk-bottom");
    }

    body.innerHTML = "";
    body.append(table);
    renderCodeComments();
    const focus = body.querySelector(".hunk-focus") ?? body.querySelector(".focus") ?? body.querySelector(".added, .changed, .removed");
    focus?.scrollIntoView({ block: "center" });
}

function overlapsAnchor(h, start, end) {
    const lo = h.newStart;
    const hi = h.newCount > 0 ? h.newStart + h.newCount - 1 : h.newStart + 1;
    return lo <= end + 1 && hi >= start - 1;
}

function diffTable(d, start, end, highlight) {
    const table = document.createElement("table");
    table.className = "code-table diff-table";
    const groups = [];
    let group = null;
    let inHeader = false;
    let oldN = 0;
    let newN = 0;
    for (const line of d.text.split("\n")) {
        if (line.startsWith("diff ")) {
            inHeader = true;
            continue;
        }
        const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (m) {
            inHeader = false;
            oldN = Number(m[1]);
            newN = Number(m[2]);
            const hi = newN + (m[3] === undefined ? 1 : Number(m[3])) - 1;
            group = start && newN <= end + 1 && hi >= start - 1 ? [] : null;
            if (group) groups.push(group);
            const tr = document.createElement("tr");
            tr.className = "diff-hunk-row";
            tr.innerHTML = `<td class="ln"></td><td class="ln ln2"></td><td>${escapeHtml(line)}</td>`;
            table.append(tr);
            continue;
        }
        if (inHeader || !/^[ +-]/.test(line)) continue;
        const sign = line[0];
        const text = line.slice(1);
        const rev = sign === "-" ? "base" : "head";
        const n = sign === "-" ? oldN : newN;
        const tr = document.createElement("tr");
        tr.className = `code-line ${sign === "+" ? "added" : sign === "-" ? "removed" : ""}`;
        Object.assign(tr.dataset, { path: sign === "-" ? d.oldPath : d.path, rev, line: String(n), text });
        tr.innerHTML = `<td class="ln">${sign === "+" ? "" : oldN}</td><td class="ln ln2">${sign === "-" ? "" : newN}</td>` +
            `<td><span class="sign">${sign === " " ? " " : sign}</span>${highlight(text)}</td>`;
        tr.firstElementChild.prepend(codeCommentButton(tr));
        group?.push(tr);
        table.append(tr);
        if (sign !== "+") oldN++;
        if (sign !== "-") newN++;
    }
    for (const rows of groups) {
        rows.forEach(tr => tr.classList.add("hunk-focus"));
        rows[0]?.classList.add("hunk-top");
        rows.at(-1)?.classList.add("hunk-bottom");
    }
    return table;
}

function highlighterFor(path) {
    const lang = LANGS[(path ?? "").split(".").pop()];
    const ok = lang && hljs.getLanguage(lang);
    return line => (ok ? hljs.highlight(line, { language: lang, ignoreIllegals: true }).value : escapeHtml(line)) || " ";
}

function renderCodeComments() {
    const body = $("#code-body");
    for (const el of body.querySelectorAll(".code-thread")) el.remove();
    for (const el of body.querySelectorAll(".comment-range")) el.classList.remove("comment-range");
    clearRange();
    for (const c of state.comments) {
        if (c.target.kind !== "code") continue;
        const { path, rev, line, endLine = line } = c.target;
        const rows = [...body.querySelectorAll(`.code-line[data-path="${CSS.escape(path)}"][data-rev="${rev}"]`)]
            .filter(tr => Number(tr.dataset.line) >= line && Number(tr.dataset.line) <= endLine);
        if (!rows.length) continue;
        if (endLine > line) rows.forEach(tr => tr.classList.add("comment-range"));
        codeThreadFor(rows.at(-1)).append(commentEl(c));
    }
}

function codeThreadFor(tr) {
    let row = tr.nextElementSibling;
    if (!row?.classList.contains("code-thread")) {
        row = document.createElement("tr");
        row.className = "code-thread";
        row.innerHTML = `<td colspan="${tr.children.length}"><div class="thread"></div></td>`;
        tr.after(row);
    }
    return row.querySelector(".thread");
}

// Press + on a code line and drag to another line on the same side to comment on a range.
function codeCommentButton(tr) {
    const b = commentButton(() => {});
    b.onmousedown = e => {
        e.preventDefault();
        codeCommentButton.drag = { start: tr, end: tr };
        showRange();
    };
    return b;
}

function sameSide(a, b) {
    return a.dataset.path === b.dataset.path && a.dataset.rev === b.dataset.rev;
}

function rangeRows() {
    const { start, end } = codeCommentButton.drag ?? {};
    if (!start) return [];
    const [lo, hi] = [Number(start.dataset.line), Number(end.dataset.line)].sort((a, b) => a - b);
    return [...$("#code-body").querySelectorAll(".code-line")]
        .filter(tr => sameSide(tr, start) && Number(tr.dataset.line) >= lo && Number(tr.dataset.line) <= hi);
}

function showRange() {
    clearRange();
    for (const tr of rangeRows()) tr.classList.add("in-range");
}

function clearRange() {
    for (const tr of document.querySelectorAll(".code-line.in-range")) tr.classList.remove("in-range");
}

document.addEventListener("mouseover", e => {
    const drag = codeCommentButton.drag;
    const tr = e.target.closest?.("#code-body .code-line");
    if (!drag || !tr || !sameSide(tr, drag.start) || tr === drag.end) return;
    drag.end = tr;
    showRange();
});

document.addEventListener("mouseup", () => {
    const drag = codeCommentButton.drag;
    if (!drag) return;
    const rows = rangeRows();
    codeCommentButton.drag = null;
    rows.forEach(tr => tr.classList.add("in-range"));
    const first = rows[0].dataset;
    const last = rows.at(-1).dataset;
    const target = { kind: "code", path: first.path, rev: first.rev, line: Number(first.line) };
    if (rows.length > 1) target.endLine = Number(last.line);
    target.text = rows.map(tr => tr.dataset.text).join("\n").slice(0, 4000);
    openComposer(rows.at(-1), target);
});

function commentButton(onClick) {
    const b = document.createElement("button");
    b.className = "cbtn";
    b.textContent = "+";
    b.title = "Comment";
    b.onclick = e => {
        e.stopPropagation();
        onClick();
    };
    return b;
}

function toast(text, url) {
    const t = $("#toast");
    t.innerHTML = escapeHtml(text) + (url ? ` <a href="${escapeHtml(url)}" target="_blank">Open</a>` : "");
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), url ? 8000 : 3500);
}

async function getJson(url) {
    return (await fetch(url)).json();
}

async function postJson(url, body) {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

function norm(s) {
    return (s ?? "").replace(/\s+/g, " ").replace(/^\+\s*/, "").trim();
}

function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
