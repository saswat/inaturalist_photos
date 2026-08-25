# Saswat iNaturalist Archive

Static archive generator for mirroring public iNaturalist observations to a GitHub Pages website.

## What it does

- Fetches public observations for `saswat`.
- Downloads local copies of observation photos.
- Creates one SEO-friendly HTML page per observation.
- Creates index, species, and sitemap pages.
- Saves photos with filenames like `imperial-moth_2024-07-14_saswat-panda-georgia.jpeg`.
- Adds bylines, alt text, canonical URLs, and JSON-LD structured data.
- Avoids publishing exact coordinates by default.

## Build

From this folder:

```powershell
node scripts/fetch-inat.mjs --limit=24
```

If `node` is not on PATH in Codex, use the bundled Node path:

```powershell
C:\Users\saswa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe scripts\fetch-inat.mjs --limit=24
```

The generated website appears in `site/`.

## Publish with GitHub Pages

Best clean setup:

1. Create a new GitHub repo named `saswat.github.io` or `inat-archive`.
2. Put the contents of this folder in that repo.
3. Enable GitHub Pages from GitHub Actions.
4. Add your domain in the repo Pages settings.
5. Set DNS at your domain registrar to point to GitHub Pages.

If you use a custom domain, build with:

```powershell
$env:SITE_URL = "https://yourdomain.com"
$env:SITE_DOMAIN = "yourdomain.com"
node scripts/fetch-inat.mjs --limit=100
```

## WordPress later

The same observation JSON can be used to publish posts to WordPress with:

- `POST /wp-json/wp/v2/media`
- `POST /wp-json/wp/v2/posts`

Keep GitHub Pages as the canonical version, then syndicate to WordPress.
