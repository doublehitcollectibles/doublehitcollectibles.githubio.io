#!/usr/bin/env node
// Import the local owned-cards.json inventory into the live collection worker DB,
// backing each item with a PriceCharting product id so the worker tracks live
// raw / PSA 10 pricing and builds price history (the price chart).
//
// The public collection page reads from the Cloudflare worker / D1 database when
// `pokemon_api_base_url` is configured. Plain custom entries (a static price) show
// no live pricing or chart; entries whose cardId is a `pricecharting:/game/...` id
// are tracked and refreshed. This script resolves that id for each item via the
// worker's public PriceCharting search, then replaces the stored collection.
//
// Usage (from workers/pricing-service):
//   node ./scripts/import-collectr-showcase.mjs --dry-run   # resolve + print matches, no writes
//   ADMIN_USERNAME=you ADMIN_PASSWORD=secret node ./scripts/import-collectr-showcase.mjs
//   node ./scripts/import-collectr-showcase.mjs             # prompts for credentials (hidden)
//
// Flags:
//   --dry-run         Resolve PriceCharting ids and print the match table; make no writes.
//   --keep-existing   Do not delete current DB entries before importing.
//   --no-resolve      Skip PriceCharting matching; import entries exactly as in the JSON.
//   --api <url>       Override the worker base URL.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNED_CARDS_PATH = resolve(__dirname, "../../../assets/data/owned-cards.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const API_BASE = option(
  "--api",
  process.env.WORKER_API_BASE || "https://doublehit-pricing-service.0x00c0de.workers.dev",
).replace(/\/$/, "");
const KEEP_EXISTING = flag("--keep-existing");
const DRY_RUN = flag("--dry-run");
const NO_RESOLVE = flag("--no-resolve");

// --- matching helpers (validated against the live PriceCharting search) ---
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const stripZero = (s) => String(s || "").replace(/\b0+(\d)/g, "$1");
const numCore = (n) => String(n || "").trim().replace(/^#/, "").split("/")[0].trim();
const isPcId = (v) => /^pricecharting:(\/game\/|https:\/\/www\.pricecharting\.com\/game\/)/i.test(String(v || "").trim());

const SEALED_STOPWORDS = new Set([
  "the", "and", "pokemon", "box", "pack", "collection", "elite", "trainer", "booster",
  "bundle", "center", "exclusive", "sleeved", "blister", "tech", "sticker", "premium",
  "special", "tin", "set", "mini", "build", "battle", "deck", "pokmemon", "ex", "card",
  "cards", "products", "miscellaneous", "2", "pack2", "2pack",
]);

function distinctiveTokens(label) {
  return norm(label).split(" ").filter((w) => w.length >= 4 && !SEALED_STOPWORDS.has(w));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function searchPriceCharting(q) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${API_BASE}/api/pricecharting/search?q=${encodeURIComponent(q)}`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`search ${r.status}`);
      const j = await r.json();
      return Array.isArray(j.cards) ? j.cards : [];
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  return [];
}

async function resolveCardId(card) {
  const sealed = card.category === "Sealed Product" || !card.itemNumber;
  const baseName = String(card.label || "").replace(/\s*\(Graded\)\s*$/i, "").trim();
  const series = String(card.series || "").trim();

  if (sealed) {
    const nameForQuery = baseName.replace(/[()]/g, " ").replace(/&/g, " ").replace(/\s+/g, " ").trim();
    const tokens = distinctiveTokens(baseName);
    const tries = [`${series} ${nameForQuery}`.trim(), nameForQuery, `${nameForQuery} ${series}`.trim()];
    for (const q of tries) {
      const cards = await searchPriceCharting(q);
      const hit = cards.find((x) => {
        const hay = norm(`${x.title} ${x.setName}`);
        return tokens.length ? tokens.some((t) => hay.includes(t)) : Boolean(x.id);
      });
      if (hit) return { id: hit.id, title: hit.title, setName: hit.setName, query: q };
      await sleep(120);
    }
    return null;
  }

  const n = numCore(card.itemNumber);
  const nameWord = norm(baseName).split(" ")[0];
  const tries = [`${baseName} ${n}`, `${baseName} ${stripZero(n)}`, `${series} ${baseName} ${n}`, baseName];
  for (const q of tries) {
    const cards = await searchPriceCharting(q);
    const hit = cards.find((x) => {
      const t = stripZero(norm(x.title));
      return t.includes(stripZero(norm(n))) && t.includes(nameWord);
    });
    if (hit) return { id: hit.id, title: hit.title, setName: hit.setName, query: q };
    await sleep(120);
  }
  return null;
}

// --- prompt / credentials ---
function prompt(question, { hidden = false } = {}) {
  return new Promise((resolvePrompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, (a) => { rl.close(); resolvePrompt(a.trim()); });
      return;
    }
    const onData = (char) => {
      const s = char.toString();
      if (s === "\n" || s === "\r" || s === "") {
        process.stdin.removeListener("data", onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdout.write(question);
    process.stdin.on("data", onData);
    rl.question("", (a) => { rl.close(); process.stdout.write("\n"); resolvePrompt(a.trim()); });
  });
}

async function getCredentials() {
  let username = process.env.ADMIN_USERNAME;
  let password = process.env.ADMIN_PASSWORD;
  if (!username) username = await prompt("Admin username: ");
  if (!password) password = await prompt("Admin password: ", { hidden: true });
  if (!username || !password) throw new Error("Username and password are required.");
  return { username, password };
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.error || text}`);
  return data;
}

function toEntryBody(card) {
  return {
    source: card.source || "custom",
    cardId: card.cardId,
    label: card.label,
    quantity: card.quantity ?? 1,
    purchasePrice: card.purchasePrice,
    purchaseDate: card.purchaseDate,
    ownershipPriceVariant: card.ownershipPriceVariant,
    condition: card.condition,
    notes: card.notes,
    priceType: card.priceType,
    game: card.game,
    category: card.category,
    series: card.series,
    variant: card.variant,
    itemNumber: card.itemNumber,
    image: card.image,
    artist: card.artist,
    description: card.description,
    currency: card.currency || "USD",
    currentPrice: card.currentPrice,
    priceSource: card.priceSource,
  };
}

async function main() {
  console.log(`Worker API: ${API_BASE}`);
  const file = JSON.parse(await readFile(OWNED_CARDS_PATH, "utf8"));
  const cards = Array.isArray(file.cards) ? file.cards : [];
  console.log(`Loaded ${cards.length} entries from ${OWNED_CARDS_PATH}`);
  if (!cards.length) throw new Error("owned-cards.json has no cards to import.");

  // Resolve PriceCharting ids so the worker tracks live pricing + history.
  const unmatched = [];
  if (!NO_RESOLVE) {
    console.log("Resolving PriceCharting product ids (for live pricing + chart)...");
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (isPcId(card.cardId)) continue; // already linked
      let match = null;
      try { match = await resolveCardId(card); } catch (err) { /* fall through */ }
      if (match) {
        card.cardId = match.id;
        console.log(`  [${i + 1}/${cards.length}] ${card.label}  ->  ${match.title} | ${match.setName}`);
      } else {
        unmatched.push(card.label);
        console.log(`  [${i + 1}/${cards.length}] ${card.label}  ->  (no match; will stay static)`);
      }
      await sleep(100);
    }
    const linked = cards.filter((c) => isPcId(c.cardId)).length;
    console.log(`Linked ${linked}/${cards.length} to PriceCharting.${unmatched.length ? ` Unmatched: ${unmatched.join(", ")}` : ""}`);
  }

  if (DRY_RUN) {
    console.log(`[dry-run] No changes made. Re-run without --dry-run to import.`);
    return;
  }

  const { username, password } = await getCredentials();
  console.log("Logging in...");
  const login = await api("/api/auth/login", { method: "POST", body: { username, password } });
  const token = login.token;
  if (!token) throw new Error("Login succeeded but no token was returned.");
  console.log(`Authenticated as ${login.user?.username || username}.`);

  const existing = await api("/api/admin/collection/cards", { token });
  const existingCards = existing.cards || [];
  console.log(`Worker currently has ${existingCards.length} stored card(s).`);

  if (!KEEP_EXISTING && existingCards.length) {
    console.log(`Deleting ${existingCards.length} existing card(s)...`);
    for (const c of existingCards) {
      if (c.id == null) continue;
      await api(`/api/admin/collection/cards/${c.id}`, { method: "DELETE", token });
    }
    console.log("Existing cards removed.");
  }

  console.log(`Importing ${cards.length} entries...`);
  let ok = 0;
  const failures = [];
  for (const card of cards) {
    try {
      await api("/api/admin/collection/cards", { method: "POST", token, body: toEntryBody(card) });
      ok++;
      process.stdout.write(`\r  ${ok}/${cards.length} imported`);
    } catch (err) {
      failures.push({ label: card.label, error: String(err.message || err) });
    }
  }
  process.stdout.write("\n");

  const verify = await api("/api/admin/collection/cards", { token });
  console.log(`Done. Imported ${ok}/${cards.length}. Worker now stores ${(verify.cards || []).length} card(s).`);
  console.log("Live pricing and history will populate as the worker refreshes each tracked item.");
  if (failures.length) {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f.label}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message || err}`);
  process.exitCode = 1;
});
