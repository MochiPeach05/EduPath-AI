// Link checks for the Trợ lý AI self-study catalog (STU-CHAT-05 "Gợi ý tài nguyên tự học").
// Reads apps/api/src/assistant/learning-resources.json (or the JSON path given as the first argument),
// checks its shape, then GETs every URL like a browser. Exits 1 on a shape problem, a non-2xx link,
// a "page not found" title or a removed YouTube video. No dependencies: `node scripts/check-learning-resources.mjs`.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_FILE = fileURLToPath(new URL("../apps/api/src/assistant/learning-resources.json", import.meta.url));
const file = process.argv[2] ?? DEFAULT_FILE;
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;
const RETRY_DELAY_MS = 3_000;
const MAX_REDIRECTS = 20;
const TITLE_SCAN_CHARS = 262_144;
const NOT_FOUND_TITLE = /\b404\b|page not found|^not found\b|không tìm thấy/i;
const MIN_RESOURCES = 2;
const MAX_RESOURCES = 4;
const MAX_NOTE_CHARS = 160;
const TYPES = new Set(["docs", "course", "video", "practice", "book", "article"]);
const LANGUAGES = new Set(["vi", "en"]);
const LEVELS = new Set(["co-ban", "trung-cap", "nang-cao"]);
const TEXT_FIELDS = ["title", "url", "provider", "type", "language", "level", "note"];
const FIELDS = new Set([...TEXT_FIELDS, "free"]);
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
};

const catalog = JSON.parse(await readFile(file, "utf8"));
const problems = [];
const skillsByUrl = new Map();
let resourceCount = 0;

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(catalog.checkedAt ?? ""))) problems.push("checkedAt must be a YYYY-MM-DD date");
if (!Array.isArray(catalog.skills) || catalog.skills.length === 0) problems.push("skills must be a non-empty array");
const seenSkills = new Set();
for (const [index, entry] of (Array.isArray(catalog.skills) ? catalog.skills : []).entries()) {
  const skill = typeof entry?.skill === "string" ? entry.skill.trim() : "";
  const label = skill || `skills[${index}]`;
  if (!skill) problems.push(`${label}: skill name is missing`);
  else if (seenSkills.has(skill)) problems.push(`${label}: skill listed twice`);
  seenSkills.add(skill);
  const resources = Array.isArray(entry?.resources) ? entry.resources : [];
  if (resources.length < MIN_RESOURCES || resources.length > MAX_RESOURCES) {
    problems.push(`${label}: has ${resources.length} resources, expected ${MIN_RESOURCES}-${MAX_RESOURCES}`);
  }
  const urlsInSkill = new Set();
  for (const [position, resource] of resources.entries()) {
    resourceCount += 1;
    const where = `${label} #${position + 1}`;
    for (const field of TEXT_FIELDS) {
      if (typeof resource?.[field] !== "string" || !resource[field].trim()) problems.push(`${where}: ${field} is missing`);
    }
    for (const field of Object.keys(resource ?? {})) {
      if (!FIELDS.has(field)) problems.push(`${where}: unknown field ${field}`);
    }
    if (resource?.free !== true) problems.push(`${where}: free must be true`);
    if (resource?.type && !TYPES.has(resource.type)) problems.push(`${where}: unknown type ${resource.type}`);
    if (resource?.language && !LANGUAGES.has(resource.language)) problems.push(`${where}: unknown language ${resource.language}`);
    if (resource?.level && !LEVELS.has(resource.level)) problems.push(`${where}: unknown level ${resource.level}`);
    if (typeof resource?.note === "string" && [...resource.note].length > MAX_NOTE_CHARS) {
      problems.push(`${where}: note has ${[...resource.note].length} chars, max ${MAX_NOTE_CHARS}`);
    }
    if (typeof resource?.url !== "string") continue;
    let parsed;
    try {
      parsed = new URL(resource.url);
    } catch {
      problems.push(`${where}: url is not valid (${resource.url})`);
      continue;
    }
    if (parsed.protocol !== "https:") problems.push(`${where}: url must use https:// (${resource.url})`);
    if ([...parsed.searchParams.keys()].some((key) => key.toLowerCase().startsWith("utm_"))) {
      problems.push(`${where}: url carries utm_* tracking parameters`);
    }
    if (urlsInSkill.has(resource.url)) problems.push(`${where}: url repeated in the same skill`);
    urlsInSkill.add(resource.url);
    skillsByUrl.set(resource.url, [...(skillsByUrl.get(resource.url) ?? []), skill]);
  }
}

// Interleave hosts so the parallel requests do not all hit one site at the same time.
const byHost = new Map();
for (const url of skillsByUrl.keys()) {
  const host = new URL(url).host;
  byHost.set(host, [...(byHost.get(host) ?? []), url]);
}
const queue = [];
for (let round = 0; queue.length < skillsByUrl.size; round += 1) {
  for (const urls of byHost.values()) if (urls[round]) queue.push(urls[round]);
}

// Redirects are followed by hand so cookies set on the way are sent back, as a browser does
// (developer.android.com, for example, loops forever when its sign-in cookie is dropped).
function storeCookies(jar, response, requestUrl) {
  const host = new URL(requestUrl).hostname;
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const domainAttribute = attributes.map((part) => part.trim()).find((part) => /^domain=/i.test(part));
    const domain = domainAttribute ? domainAttribute.slice(7).replace(/^\./, "").toLowerCase() : host;
    const name = pair.slice(0, eq).trim();
    jar.set(`${domain}\t${name}`, { domain, name, value: pair.slice(eq + 1).trim() });
  }
}

function cookieHeader(jar, url) {
  const host = new URL(url).hostname;
  return [...jar.values()]
    .filter((cookie) => host === cookie.domain || host.endsWith(`.${cookie.domain}`))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

// Reads only as far as </title>; a "Page not found" title on a 200 answer is a soft 404.
async function readTitle(response) {
  if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").includes("html")) {
    await response.body?.cancel().catch(() => {});
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < TITLE_SCAN_CHARS && !/<\/title>/i.test(html)) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

async function fetchOnce(url) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const jar = new Map();
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const cookie = cookieHeader(jar, current);
      const response = await fetch(current, { headers: cookie ? { ...HEADERS, cookie } : HEADERS, redirect: "manual", signal });
      storeCookies(jar, response, current);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status > 399 || !location) {
        return { status: response.status, finalUrl: current, title: await readTitle(response) };
      }
      await response.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
    }
    return { status: 0, reason: "too many redirects" };
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "timeout" : error?.cause?.code ?? error?.message ?? String(error);
    return { status: 0, reason };
  }
}

async function checkUrl(url) {
  const first = await fetchOnce(url);
  // One retry for flaky networks and rate limits; a link that still fails is reported.
  if (first.status === 0 || first.status === 429 || first.status >= 500) {
    await new Promise((done) => setTimeout(done, RETRY_DELAY_MS));
    return fetchOnce(url);
  }
  return first;
}

// YouTube answers 200 even for removed videos, so its oEmbed endpoint is asked as well.
function isYouTubeLink(url) {
  const { hostname, pathname } = new URL(url);
  return /(^|\.)youtube\.com$/.test(hostname) && (pathname === "/watch" || pathname === "/playlist");
}

const isOk = (status) => status >= 200 && status <= 299;
const trimPath = (pathname) => pathname.replace(/\/+$/, "");
const failures = [];
const warnings = [];
let next = 0;
async function worker() {
  while (next < queue.length) {
    const url = queue[next++];
    const result = await checkUrl(url);
    const skills = skillsByUrl.get(url).join("; ");
    if (!isOk(result.status)) {
      failures.push(`FAIL ${result.status || result.reason} ${url} (${skills})`);
      continue;
    }
    if (NOT_FOUND_TITLE.test(result.title)) {
      failures.push(`FAIL soft-404 "${result.title}" ${url} (${skills})`);
      continue;
    }
    if (isYouTubeLink(url)) {
      const oembed = await checkUrl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
      if (!isOk(oembed.status)) {
        failures.push(`FAIL ${oembed.status || oembed.reason} YouTube video or playlist unavailable ${url} (${skills})`);
        continue;
      }
    }
    const start = trimPath(new URL(url).pathname);
    const end = trimPath(new URL(result.finalUrl || url).pathname);
    if (start && end !== start && (!end || start.startsWith(`${end}/`))) {
      warnings.push(`WARN redirected to a parent or home page, the page may be gone: ${url} -> ${result.finalUrl} (${skills})`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

for (const problem of problems) console.log(`SHAPE ${problem}`);
for (const line of failures.sort()) console.log(line);
for (const line of warnings.sort()) console.log(line);
const skillTotal = Array.isArray(catalog.skills) ? catalog.skills.length : 0;
console.log(
  `learning-resources: ${skillTotal} skills, ${resourceCount} resources, ${skillsByUrl.size} URLs checked, ` +
  `${problems.length} shape problems, ${failures.length} link failures, ${warnings.length} warnings`,
);
process.exitCode = problems.length || failures.length ? 1 : 0;
