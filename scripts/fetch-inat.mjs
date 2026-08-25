import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CONFIG = {
  user: process.env.INAT_USER || "saswat",
  authorName: process.env.AUTHOR_NAME || "Saswat Panda",
  siteTitle: process.env.SITE_TITLE || "Saswat Panda Nature Archive",
  siteDescription:
    process.env.SITE_DESCRIPTION ||
    "Wildlife, plants, fungi, and field observations photographed by Saswat Panda.",
  siteUrl: getSiteUrl(),
  siteDomain: process.env.SITE_DOMAIN || "",
  limit: getLimit(),
  concurrency: Number.parseInt(process.env.CONCURRENCY || "8", 10),
};

const root = process.cwd();
const siteDir = path.join(root, "site");
const photoDir = path.join(siteDir, "photos");
const observationDir = path.join(siteDir, "observations");
const usedPhotoFilenames = new Set();

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await rm(siteDir, { recursive: true, force: true });
  await mkdir(photoDir, { recursive: true });
  await mkdir(observationDir, { recursive: true });

  const observations = await fetchObservations(CONFIG.user, CONFIG.limit);
  const pages = (await mapWithConcurrency(observations, CONFIG.concurrency, buildObservationPage)).filter(Boolean);

  await writeFile(path.join(siteDir, "index.html"), renderIndex(pages), "utf8");
  await writeFile(path.join(siteDir, "species.html"), renderSpecies(pages), "utf8");
  await writeFile(path.join(siteDir, "sitemap.xml"), renderSitemap(pages), "utf8");
  await writeFile(path.join(siteDir, "robots.txt"), renderRobots(), "utf8");
  await writeFile(path.join(siteDir, "styles.css"), renderCss(), "utf8");

  if (CONFIG.siteDomain) {
    await writeFile(path.join(siteDir, "CNAME"), CONFIG.siteDomain, "utf8");
  }

  console.log(`Built ${pages.length} observation pages in ${siteDir}`);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency || 8, items.length));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function getLimit() {
  if (process.argv.includes("--all") || String(process.env.LIMIT || "").toLowerCase() === "all") {
    return "all";
  }

  const arg = process.argv.find((item) => item.startsWith("--limit="));
  const raw = arg ? arg.split("=")[1] : process.env.LIMIT || "24";
  const limit = Number.parseInt(raw, 10);
  return Number.isFinite(limit) && limit > 0 ? limit : 24;
}

function getSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");

  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repository.split("/");
  if (owner && repo) return `https://${owner}.github.io/${repo}`;

  return "";
}

async function fetchObservations(user, limit) {
  const perPage = 100;
  const pages = limit === "all" ? Number.POSITIVE_INFINITY : Math.ceil(limit / perPage);
  const results = [];

  for (let page = 1; page <= pages; page += 1) {
    const url = new URL("https://api.inaturalist.org/v1/observations");
    url.searchParams.set("user_id", user);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("order_by", "observed_on");
    url.searchParams.set("order", "desc");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`iNaturalist request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    results.push(...data.results);

    if (limit === "all" && results.length >= data.total_results) break;
  }

  return limit === "all" ? results : results.slice(0, limit);
}

async function buildObservationPage(observation) {
  const photos = observation.photos || [];
  if (!photos.length) return null;

  const commonName =
    observation.taxon?.preferred_common_name ||
    observation.species_guess ||
    observation.taxon?.name ||
    "Wildlife observation";
  const scientificName = observation.taxon?.name || "";
  const observedDate = observation.observed_on || observation.observed_on_details?.date || "";
  const safePlace = safePlaceName(observation);
  const state = stateFromPlaceName(safePlace);
  const slug = uniqueSlug(`${commonName}-${observedDate}-${observation.id}`);
  const pagePhotos = [];

  for (const [index, photo] of photos.entries()) {
    const photoUrl = bestPhotoUrl(photo);
    const photoExt = extensionFromUrl(photoUrl);
    const suffix = photos.length > 1 ? `photo ${index + 1}` : "";
    const photoFilename = uniquePhotoFilename(
      `${seoFileSlug([commonName, observedDate, suffix, `${CONFIG.authorName} ${state}`])}.${photoExt}`,
    );

    await downloadFile(photoUrl, path.join(photoDir, photoFilename));

    pagePhotos.push({
      filename: photoFilename,
      publicPath: `../../photos/${photoFilename}`,
    });
  }

  const title = `${titleCase(commonName)} photographed by ${CONFIG.authorName}`;
  const description = [
    `${titleCase(commonName)} (${scientificName}) observed by ${CONFIG.authorName}`,
    observedDate ? `on ${formatDate(observedDate)}` : "",
    safePlace ? `near ${safePlace}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const page = {
    id: observation.id,
    slug,
    title,
    commonName,
    scientificName,
    observedDate,
    safePlace,
    qualityGrade: observation.quality_grade,
    iconicTaxon: observation.taxon?.iconic_taxon_name || "Life",
    inatUrl: observation.uri || `https://www.inaturalist.org/observations/${observation.id}`,
    photos: pagePhotos,
    photoPublicPath: pagePhotos[0].publicPath,
    photoFilename: pagePhotos[0].filename,
    alt: `${titleCase(commonName)} photographed by ${CONFIG.authorName}`,
    description,
    urlPath: `/observations/${slug}/`,
    localPath: `observations/${slug}/index.html`,
  };

  const pageDir = path.join(observationDir, slug);
  await mkdir(pageDir, { recursive: true });
  await writeFile(path.join(pageDir, "index.html"), renderObservation(page), "utf8");

  return page;
}

function bestPhotoUrl(photo) {
  const url = photo.url || photo.medium_url || photo.square_url;
  if (!url) throw new Error("Photo is missing a URL");
  return url
    .replace("/square.", "/large.")
    .replace("/medium.", "/large.")
    .replace("square.jpg", "large.jpg")
    .replace("medium.jpg", "large.jpg");
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Photo download failed: ${response.status} ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, buffer);
}

function renderObservation(page) {
  const canonical = absoluteUrl(page.urlPath);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: page.title,
    description: page.description,
    contentUrl: absoluteUrl(`/photos/${page.photoFilename}`),
    creator: {
      "@type": "Person",
      name: CONFIG.authorName,
    },
    creditText: `Photo and observation by ${CONFIG.authorName}`,
    dateCreated: page.observedDate || undefined,
    about: page.scientificName
      ? {
          "@type": "Thing",
          name: page.scientificName,
          alternateName: page.commonName,
        }
      : undefined,
    isBasedOn: page.inatUrl,
  };

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:type" content="article">
  <meta property="og:image" content="${escapeHtml(absoluteUrl(`/photos/${page.photoFilename}`))}">
  <link rel="stylesheet" href="../../styles.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="../../">${escapeHtml(CONFIG.siteTitle)}</a>
    <nav><a href="../../species.html">Species</a></nav>
  </header>
  <main class="observation">
    <figure class="photo-frame">
      <img src="${escapeHtml(page.photoPublicPath)}" alt="${escapeHtml(page.alt)}">
      <figcaption>Photo and observation by ${escapeHtml(CONFIG.authorName)}</figcaption>
    </figure>
    <section class="details">
      <p class="eyebrow">${escapeHtml(page.iconicTaxon)} / ${escapeHtml(page.qualityGrade || "observation")}</p>
      <h1>${escapeHtml(titleCase(page.commonName))}</h1>
      ${page.scientificName ? `<p class="scientific"><em>${escapeHtml(page.scientificName)}</em></p>` : ""}
      <dl>
        ${page.observedDate ? `<div><dt>Observed</dt><dd>${escapeHtml(formatDate(page.observedDate))}</dd></div>` : ""}
        ${page.safePlace ? `<div><dt>Place</dt><dd>${escapeHtml(page.safePlace)}</dd></div>` : ""}
        <div><dt>Source</dt><dd><a href="${escapeHtml(page.inatUrl)}">iNaturalist observation ${page.id}</a></dd></div>
      </dl>
    </section>
    ${renderPhotoGallery(page)}
  </main>
</body>
</html>`);
}

function renderPhotoGallery(page) {
  if (page.photos.length < 2) return "";

  const items = page.photos
    .map(
      (photo, index) => `<a href="${escapeHtml(photo.publicPath)}">
        <img src="${escapeHtml(photo.publicPath)}" alt="${escapeHtml(`${page.alt}, photo ${index + 1}`)}">
      </a>`,
    )
    .join("");

  return `<section class="gallery" aria-label="Additional photos">${items}</section>`;
}

function renderIndex(pages) {
  const cards = pages
    .map(
      (page) => `<article class="card">
        <a href="${escapeHtml(page.localPath)}">
          <img src="photos/${escapeHtml(page.photoFilename)}" alt="${escapeHtml(page.alt)}">
          <span>${escapeHtml(titleCase(page.commonName))}</span>
        </a>
        <small>${escapeHtml(page.scientificName)}${page.observedDate ? ` / ${escapeHtml(formatDate(page.observedDate))}` : ""}</small>
      </article>`,
    )
    .join("");

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(CONFIG.siteTitle)}</title>
  <meta name="description" content="${escapeHtml(CONFIG.siteDescription)}">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="hero">
    <nav><a href="species.html">Species</a><a href="https://www.inaturalist.org/people/${escapeHtml(CONFIG.user)}">iNaturalist</a></nav>
    <h1>${escapeHtml(CONFIG.siteTitle)}</h1>
    <p>${escapeHtml(CONFIG.siteDescription)}</p>
  </header>
  <main class="grid">${cards}</main>
</body>
</html>`);
}

function renderSpecies(pages) {
  const groups = new Map();
  for (const page of pages) {
    const key = page.scientificName || page.commonName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([species, entries]) => {
      const first = entries[0];
      return `<tr>
        <td><a href="${escapeHtml(first.localPath)}">${escapeHtml(titleCase(first.commonName))}</a></td>
        <td><em>${escapeHtml(species)}</em></td>
        <td>${entries.length}</td>
      </tr>`;
    })
    .join("");

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Species / ${escapeHtml(CONFIG.siteTitle)}</title>
  <meta name="description" content="Species observed and photographed by ${escapeHtml(CONFIG.authorName)}.">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="./">${escapeHtml(CONFIG.siteTitle)}</a>
  </header>
  <main class="table-wrap">
    <h1>Species</h1>
    <table>
      <thead><tr><th>Common name</th><th>Scientific name</th><th>Posts</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`);
}

function renderSitemap(pages) {
  if (!CONFIG.siteUrl) return "";
  const urls = ["/", "/species.html", ...pages.map((page) => page.urlPath)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${escapeHtml(absoluteUrl(url))}</loc></url>`).join("\n")}
</urlset>`;
}

function renderRobots() {
  const sitemap = CONFIG.siteUrl ? `\nSitemap: ${CONFIG.siteUrl}/sitemap.xml` : "";
  return `User-agent: *
Allow: /${sitemap}
`;
}

function renderCss() {
  return `:root {
  color-scheme: light;
  --ink: #18201b;
  --muted: #637066;
  --line: #d9e1d8;
  --paper: #f8faf6;
  --leaf: #2f6f4e;
  --water: #235d72;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--paper);
  color: var(--ink);
}

a { color: var(--water); }

.hero {
  min-height: 42vh;
  padding: 24px clamp(18px, 5vw, 72px) 48px;
  display: grid;
  align-content: end;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, #eef5ef 0%, #f8faf6 100%);
}

.hero nav, .site-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px clamp(18px, 5vw, 72px);
}

.hero nav a, .site-header a {
  font-weight: 700;
  text-decoration: none;
}

.hero nav {
  justify-content: flex-end;
}

.hero nav a + a {
  margin-left: 18px;
}

.hero h1 {
  max-width: 900px;
  margin: 96px 0 12px;
  font-size: clamp(2.4rem, 6vw, 5.6rem);
  line-height: .95;
}

.hero p {
  max-width: 760px;
  margin: 0;
  color: var(--muted);
  font-size: 1.2rem;
}

.grid {
  width: min(1180px, calc(100% - 36px));
  margin: 34px auto 72px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 18px;
}

.card {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: white;
}

.card a {
  display: grid;
  color: inherit;
  text-decoration: none;
}

.card img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #e7ece7;
}

.card span {
  padding: 12px 12px 2px;
  font-weight: 800;
}

.card small {
  display: block;
  padding: 0 12px 12px;
  color: var(--muted);
}

.site-header {
  position: static;
  border-bottom: 1px solid var(--line);
  background: rgba(248, 250, 246, .95);
}

.brand {
  color: var(--leaf);
}

.observation {
  width: min(1180px, calc(100% - 36px));
  margin: 34px auto 72px;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, .75fr);
  gap: 34px;
  align-items: start;
}

.gallery {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.gallery a {
  display: block;
}

.gallery img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 8px;
  background: #e7ece7;
}

.photo-frame {
  margin: 0;
}

.photo-frame img {
  display: block;
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
  background: #e7ece7;
  border-radius: 8px;
}

.photo-frame figcaption {
  color: var(--muted);
  margin-top: 10px;
}

.details {
  padding-top: 6px;
}

.eyebrow {
  color: var(--leaf);
  font-weight: 800;
  text-transform: uppercase;
  font-size: .78rem;
}

.details h1, .table-wrap h1 {
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 1;
  margin: 0 0 10px;
}

.scientific {
  color: var(--muted);
  font-size: 1.2rem;
}

dl {
  display: grid;
  gap: 14px;
  margin-top: 28px;
}

dt {
  color: var(--muted);
  font-size: .8rem;
  font-weight: 800;
  text-transform: uppercase;
}

dd {
  margin: 3px 0 0;
  font-size: 1.05rem;
}

.table-wrap {
  width: min(980px, calc(100% - 36px));
  margin: 34px auto 72px;
}

table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid var(--line);
}

th, td {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

th {
  color: var(--muted);
  font-size: .8rem;
  text-transform: uppercase;
}

@media (max-width: 800px) {
  .observation {
    grid-template-columns: 1fr;
  }

  .hero h1 {
    font-size: 3rem;
  }
}
`;
}

function safePlaceName(observation) {
  if (!observation.place_guess) return "";

  return cityStateFromPlaceGuess(observation.place_guess);
}

function cityStateFromPlaceGuess(placeGuess) {
  const cleaned = placeGuess
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "")
    .replace(/\bUSA\b|\bUnited States\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/g, "")
    .trim();

  const parts = cleaned
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return cleaned;

  const city = parts[0];
  const stateToken = parts.find((part, index) => index > 0 && stateName(part));
  const state = stateToken ? stateName(stateToken) : parts[1];

  return [city, state].filter(Boolean).join(", ");
}

function stateName(value) {
  const states = {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    DC: "District of Columbia",
  };

  const normalized = value.trim();
  const upper = normalized.toUpperCase();
  return states[upper] || Object.values(states).find((name) => name.toLowerCase() === normalized.toLowerCase()) || "";
}

function stateFromPlaceName(placeName) {
  const parts = String(placeName || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const state = parts.length > 1 ? parts[parts.length - 1] : "";
  return state || "unknown";
}

function seoFileSlug(parts) {
  return parts
    .filter(Boolean)
    .map((part) =>
      String(part)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("_");
}

function uniquePhotoFilename(filename) {
  if (!usedPhotoFilenames.has(filename)) {
    usedPhotoFilenames.add(filename);
    return filename;
  }

  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  let counter = 2;

  while (usedPhotoFilenames.has(`${base}_${counter}${ext}`)) {
    counter += 1;
  }

  const unique = `${base}_${counter}${ext}`;
  usedPhotoFilenames.add(unique);
  return unique;
}

function uniqueSlug(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function extensionFromUrl(url) {
  const clean = new URL(url).pathname;
  const ext = path.extname(clean).replace(".", "").toLowerCase();
  return ext || "jpg";
}

function absoluteUrl(urlPath) {
  if (!CONFIG.siteUrl) return urlPath;
  return `${CONFIG.siteUrl}${urlPath}`;
}

function html(value) {
  return `${value.trim()}\n`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
