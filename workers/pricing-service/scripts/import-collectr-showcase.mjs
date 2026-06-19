#!/usr/bin/env node
// Import the local owned-cards.json inventory into the live collection worker DB.
//
// The public collection page reads from the Cloudflare worker / D1 database when
// `pokemon_api_base_url` is configured. This script logs in as the admin user and
// replaces the stored collection with the entries in assets/data/owned-cards.json
// (which mirrors the Collectr showcase).
//
// Usage (from workers/pricing-service):
//   ADMIN_USERNAME=you ADMIN_PASSWORD=secret node ./scripts/import-collectr-showcase.mjs
// or run without env vars and you'll be prompted (password input is hidden):
//   node ./scripts/import-collectr-showcase.mjs
//
// Flags:
//   --keep-existing   Do not delete current DB entries before importing.
//   --dry-run         Log in and report what would change, but make no writes.
//   --api <url>       Override the worker base URL.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNED_CARDS_PATH = resolve(__dirname, "../../../assets/data/owned-cards.json");

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function option(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const API_BASE = (
  option("--api", process.env.WORKER_API_BASE || "https://doublehit-pricing-service.0x00c0de.workers.dev")
).replace(/\/$/, "");
const KEEP_EXISTING = flag("--keep-existing");
const DRY_RUN = flag("--dry-run");

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolvePrompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close();
        resolvePrompt(answer.trim());
      });
      return;
    }
    // Hidden input: mute echoed characters.
    const onData = (char) => {
      const s = char.toString();
      if (s === "\n" || s === "\r" || s === "") {
        process.stdin.removeListener("data", onData);
      } else {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdout.write(question);
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolvePrompt(answer.trim());
    });
  });
}

async function getCredentials() {
  let username = process.env.ADMIN_USERNAME;
  let password = process.env.ADMIN_PASSWORD;
  if (!username) username = await prompt("Admin username: ");
  if (!password) password = await prompt("Admin password: ", { hidden: true });
  if (!username || !password) {
    throw new Error("Username and password are required.");
  }
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
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${data.error || text}`);
  }
  return data;
}

function toEntryBody(card) {
  // Map an owned-cards.json card to the worker's create payload.
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

  const { username, password } = await getCredentials();
  console.log("Logging in...");
  const login = await api("/api/auth/login", { method: "POST", body: { username, password } });
  const token = login.token;
  if (!token) throw new Error("Login succeeded but no token was returned.");
  console.log(`Authenticated as ${login.user?.username || username}.`);

  const existing = await api("/api/admin/collection/cards", { token });
  const existingCards = existing.cards || [];
  console.log(`Worker currently has ${existingCards.length} stored card(s).`);

  if (DRY_RUN) {
    console.log(`[dry-run] Would ${KEEP_EXISTING ? "keep" : "delete"} ${existingCards.length} existing card(s).`);
    console.log(`[dry-run] Would import ${cards.length} entries.`);
    return;
  }

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
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
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
