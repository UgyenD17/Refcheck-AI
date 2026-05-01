import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "or",
  "the",
  "to",
  "while",
  "with"
]);

const SPORT_RULE_FILES = {
  soccer: path.join(rootDir, "data", "rules", "soccer", "ifab-laws-chunks.json")
};

let ruleCache = new Map();

export function tokenize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term && !STOP_WORDS.has(term))
    .flatMap((term) => {
      const variants = [term];

      if (term.endsWith("ing") && term.length > 5) variants.push(term.slice(0, -3));
      if (term.endsWith("ed") && term.length > 4) variants.push(term.slice(0, -2));
      if (term.endsWith("s") && term.length > 3) variants.push(term.slice(0, -1));

      return variants;
    });
}

export async function loadRules(sport) {
  const normalizedSport = String(sport || "").toLowerCase();
  const rulePath = SPORT_RULE_FILES[normalizedSport];

  if (!rulePath) {
    const error = new Error(`No rule store configured for sport: ${sport}`);
    error.statusCode = 400;
    throw error;
  }

  if (ruleCache.has(normalizedSport)) return ruleCache.get(normalizedSport);

  try {
    const payload = JSON.parse(await readFile(rulePath, "utf8"));
    const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];

    ruleCache.set(normalizedSport, chunks);
    return chunks;
  } catch (error) {
    const wrapped = new Error(
      `Rules for ${normalizedSport} are missing. Run "npm run ingest:soccer" before calling the RAG endpoint.`
    );
    wrapped.statusCode = 503;
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function retrieveRules({ sport, original_call, play_description }, limit = 4) {
  const chunks = await loadRules(sport);
  const query = `${original_call || ""} ${play_description || ""}`;
  const queryTerms = tokenize(query);
  const queryLower = query.toLowerCase();

  if (!chunks.length) {
    const error = new Error(`No rule chunks found for ${sport}.`);
    error.statusCode = 503;
    throw error;
  }

  const scored = chunks.map((chunk) => {
    const haystackTerms = tokenize(`${chunk.law_title} ${chunk.section} ${chunk.text}`);
    const haystack = new Set(haystackTerms);
    const matches = queryTerms.filter((term) => haystack.has(term));

    const phraseBonus = queryTerms.some((term) =>
      chunk.text.toLowerCase().includes(term)
    )
      ? 0.25
      : 0;

    const textLower = `${chunk.section} ${chunk.text}`.toLowerCase();

    const offenseBonus =
      /\btrip|trips|tripped|tripping\b/.test(queryLower) &&
      /\btrip|trips|tripped|tripping\b/.test(textLower)
        ? 3
        : 0;

    const foulBonus =
      /\bfoul|free kick|penalty\b/.test(queryLower) &&
      textLower.includes("direct free kick")
        ? 1
        : 0;

    const offsideBonus =
      (/\boffside\b/.test(queryLower) ||
        /\bahead of (the )?(second-last|second last|last) defender\b/.test(queryLower) ||
        /\bbehind (the )?(second-last|second last|last) defender\b/.test(queryLower)) &&
      /\boffside\b/.test(textLower)
        ? 5
        : 0;

    const restartBonus =
      /\bthrow|corner|goal kick|penalty|free kick|kick-off|dropped ball\b/.test(
        queryLower
      ) &&
      /\bthrow|corner|goal kick|penalty|free kick|kick-off|dropped ball\b/.test(
        textLower
      )
        ? 2
        : 0;

    const handballBonus =
      /\bhandball|hand|arm\b/.test(queryLower) &&
      /\bhandball|hand|arm\b/.test(textLower)
        ? 3
        : 0;

    const dogsoBonus =
      /\bgoal|net|going in|go in|deny|denies|prevent|prevents|stop|stops|scoring\b/.test(
        queryLower
      ) &&
      /\bdeliberate handball|denies the opposing team a goal|obvious goal-scoring|sending-off\b/.test(
        textLower
      )
        ? 4
        : 0;

    const cardBonus =
      /\byellow card|red card|caution|cautioned|send off|sent off|sending-off|reckless|serious foul play|violent conduct|dogso|denying obvious goal\b/.test(
        queryLower
      ) &&
      /\byellow card|red card|caution|cautioned|sending-off|reckless|serious foul play|violent conduct|obvious goal-scoring|denies\b/.test(
        textLower
      )
        ? 4
        : 0;

    return {
      ...chunk,
      score:
        matches.length +
        phraseBonus +
        offenseBonus +
        foulBonus +
        offsideBonus +
        restartBonus +
        handballBonus +
        dogsoBonus +
        cardBonus,
      matched_terms: [...new Set(matches)]
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, matched_terms, ...chunk }) => ({
      ...chunk,
      score,
      matched_terms
    }));
}