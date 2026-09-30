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
    }
    for (const b of document.querySelectorAll(".tabs button[data-rev]")) {
        b.onclick = () => state.code && openCode({ ...state.code, rev: b.dataset.rev });
    }
    const deep = location.hash.match(/^#code=(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    if (deep && !STATIC) {
        const start = deep[2] ? Number(deep[2]) : undefined;
        await openCode({ path: decodeURIComponent(deep[1]), start, end: deep[3] ? Number(deep[3]) : start, rev: "diff" });
    }
    $("#code-close").onclick = () => {
        $("#code").hidden = true;
        state.code = null;
        markActiveAnchor();
    };
}

async function loadDigest() {
    state.digest = STATIC ? window.__DIGEST__ : await getJson("/api/digest");
    const scroll = digestEl.scrollTop;
    renderMeta();
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
    $("#apply").disabled = open === 0;
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
    $("#meta").innerHTML = [
        meta.branch && chip("branch", meta.branch),
        meta.base && chip("base", meta.base),
        meta.head && chip("head", meta.head),
        chip("files", `${meta.files} (${meta.generated} generated)`),
        chip("diff", `${meta.diffLines} lines`),
        chip("digest", `${meta.digestLines} lines · ${ratio}%`),
    ].filter(Boolean).join("");
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
                ? `<code>${escapeHtml(c.target.path)}:${c.target.line}</code> (${c.target.rev})`
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
    const who = c.author === "agent" ? "Agent · note" : c.status === "resolved" ? "You · resolved" : "You";
    d.innerHTML = `<div class="who">${who}</div><div>${escapeHtml(c.body)}</div>` +
        (c.reply ? `<div class="reply">↳ ${escapeHtml(c.reply)}</div>` : "");
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

async function openCode({ path, start, end, rev }) {
    state.code = { path, start, end, rev, anchor: path };
    $("#code").hidden = false;
    for (const b of document.querySelectorAll(".tabs button[data-rev]")) b.classList.toggle("on", b.dataset.rev === rev);
    markActiveAnchor();
    const body = $("#code-body");
    if (rev === "diff") {
        const d = await getJson(`/api/diff?path=${encodeURIComponent(path)}`);
        $("#code-path").textContent = d.path ?? path;
        body.innerHTML = "";
        if (!d.text) {
            body.innerHTML = `<div class="code-error">This file did not change.</div>`;
            return;
        }
        body.append(diffTable(d, start, end, highlighterFor(d.path)));
        renderCodeComments();
        (body.querySelector(".hunk-focus") ?? body.querySelector(".added, .removed"))?.scrollIntoView({ block: "center" });
        return;
    }
    const file = await getJson(`/api/file?path=${encodeURIComponent(path)}&rev=${rev}`);
    $("#code-path").textContent = file.path ?? path;
    state.code.resolved = file.path;
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
        tr.innerHTML = `<td class="ln">${n}</td><td>${highlight(line)}</td>`;
        tr.firstElementChild.prepend(commentButton(() =>
            openComposer(tr, { kind: "code", path: file.path, line: n, rev, text: line.trim().slice(0, 200) })));
        return tr;
    };
    const removedRow = l => {
        const tr = document.createElement("tr");
        tr.className = "code-line removed inline-old";
        Object.assign(tr.dataset, { path: file.oldPath ?? file.path, rev: "base", line: String(l.n) });
        tr.innerHTML = `<td class="ln">−${l.n}</td><td>${highlight(l.text)}</td>`;
        tr.firstElementChild.prepend(commentButton(() =>
            openComposer(tr, { kind: "code", path: tr.dataset.path, line: l.n, rev: "base", text: l.text.trim().slice(0, 200) })));
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
        Object.assign(tr.dataset, { path: sign === "-" ? d.oldPath : d.path, rev, line: String(n) });
        tr.innerHTML = `<td class="ln">${sign === "+" ? "" : oldN}</td><td class="ln ln2">${sign === "-" ? "" : newN}</td>` +
            `<td><span class="sign">${sign === " " ? " " : sign}</span>${highlight(text)}</td>`;
        tr.firstElementChild.prepend(commentButton(() =>
            openComposer(tr, { kind: "code", path: tr.dataset.path, line: n, rev, text: text.trim().slice(0, 200) })));
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
    for (const c of state.comments) {
        if (c.target.kind !== "code") continue;
        const sel = `.code-line[data-path="${CSS.escape(c.target.path)}"][data-rev="${c.target.rev}"][data-line="${c.target.line}"]`;
        const tr = body.querySelector(sel);
        if (tr) codeThreadFor(tr).append(commentEl(c));
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

function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

async function getJson(url) {
    return (await fetch(url)).json();
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
