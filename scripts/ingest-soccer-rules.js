import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "data", "rules", "soccer");
const outPath = path.join(outDir, "ifab-laws-chunks.json");

const IFAB_LAWS = [
  { law_number: "1", law_title: "The Field of Play", slug: "the-field-of-play" },
  { law_number: "2", law_title: "The Ball", slug: "the-ball" },
  { law_number: "3", law_title: "The Players", slug: "the-players" },
  { law_number: "4", law_title: "The Players' Equipment", slug: "the-players-equipment" },
  { law_number: "5", law_title: "The Referee", slug: "the-referee" },
  { law_number: "6", law_title: "The Other Match Officials", slug: "the-other-match-officials" },
  { law_number: "7", law_title: "The Duration of the Match", slug: "the-duration-of-the-match" },
  { law_number: "8", law_title: "The Start and Restart of Play", slug: "the-start-and-restart-of-play" },
  { law_number: "9", law_title: "The Ball in and out of Play", slug: "the-ball-in-and-out-of-play" },
  {
    law_number: "10",
    law_title: "Determining the Outcome of a Match",
    slug: "determining-the-outcome-of-a-match"
  },
  { law_number: "11", law_title: "Offside", slug: "offside" },
  { law_number: "12", law_title: "Fouls and Misconduct", slug: "fouls-and-misconduct" },
  { law_number: "13", law_title: "Free Kicks", slug: "free-kicks" },
  { law_number: "14", law_title: "The Penalty Kick", slug: "the-penalty-kick" },
  { law_number: "15", law_title: "The Throw-in", slug: "the-throw-in" },
  { law_number: "16", law_title: "The Goal Kick", slug: "the-goal-kick" },
  { law_number: "17", law_title: "The Corner Kick", slug: "the-corner-kick" }
];

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&hellip;/g, "...");
}

function normalizeWhitespace(value) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function htmlToMarkdownishText(html) {
  return html
    .replace(/<!--\s*-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h2[^>]*>/gi, "\n## ")
    .replace(/<h3[^>]*>/gi, "\n### ")
    .replace(/<h4[^>]*>/gi, "\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join("\n");
}

function cleanSectionTitle(title) {
  return normalizeWhitespace(title)
    .replace(/^#+\s*/, "")
    .replace(/\s+\.\s+/g, ".")
    .replace(/\s+:/g, ":");
}

function sectionsFromHtml(html, law) {
  const cleanedHtml = html
    .replace(/<!--\s*-->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const articleMatches = cleanedHtml.match(
    /<article[^>]*class="[^"]*laws-accordion-section[^"]*"[\s\S]*?<\/article>/gi
  );

  if (!articleMatches?.length) {
    const pageText = htmlToMarkdownishText(html);
    const startNeedle = `## ${law.law_number}.`;
    const start = pageText.indexOf(startNeedle);
    if (start === -1) {
      throw new Error(`Could not find IFAB law sections for Law ${law.law_number}.`);
    }

    return [
      {
        section: `${law.law_number}. ${law.law_title}`,
        text: normalizeWhitespace(pageText.slice(start))
      }
    ];
  }

  return articleMatches
    .map((article) => {
      const h2 = article.match(/<h2[\s\S]*?<\/h2>/i)?.[0] || "";
      const section = cleanSectionTitle(htmlToMarkdownishText(h2));
      const contentHtml = article.replace(/<h2[\s\S]*?<\/h2>/i, "");
      const text = normalizeWhitespace(htmlToMarkdownishText(contentHtml));

      return {
        section,
        text
      };
    })
    .filter((section) => section.section && section.text);
}

function chunkSection(sectionText, maxWords = 150) {
  const words = normalizeWhitespace(sectionText).split(" ");
  if (words.length <= maxWords) return [words.join(" ")];

  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}

async function fetchLaw(law) {
  const source = `https://www.theifab.com/laws/latest/${law.slug}/`;
  const response = await fetch(source, {
    headers: {
      "User-Agent": "RefCheckAI/0.1 rule ingestion"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Law ${law.law_number}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const sections = sectionsFromHtml(html, law);

  return {
    ...law,
    source,
    sections
  };
}

const laws = [];
for (const law of IFAB_LAWS) {
  console.log(`Fetching IFAB Law ${law.law_number}: ${law.law_title}`);
  laws.push(await fetchLaw(law));
}

const chunks = laws.flatMap((law) =>
  law.sections.flatMap((section, sectionIndex) =>
    chunkSection(section.text).map((text, chunkIndex) => ({
      id: `soccer-law-${law.law_number}-${sectionIndex + 1}-${chunkIndex + 1}`,
      sport: "soccer",
      law_number: law.law_number,
      law_title: law.law_title,
      section: section.section,
      text,
      source: law.source
    }))
  )
);

await mkdir(outDir, { recursive: true });
await writeFile(
  outPath,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: "https://www.theifab.com/laws/latest/",
      season: "2025/26",
      laws: laws.map(({ law_number, law_title, source, sections }) => ({
        law_number,
        law_title,
        source,
        section_count: sections.length
      })),
      chunks
    },
    null,
    2
  )
);

console.log(`Wrote ${chunks.length} IFAB soccer law chunks to ${path.relative(rootDir, outPath)}`);
