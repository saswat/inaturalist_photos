# Deploying to GitHub Pages

This project is intended to be its own GitHub repository.

## Recommended repo

Use one of these:

- `saswat.github.io` if this will be your main GitHub Pages website.
- `nature` or `inaturalist-archive` if you will connect a custom domain directly to this repo.

If you do not use a custom domain, `saswat.github.io` is the simplest because the site is served from the domain root.

## 1. Create the GitHub repo

Go to:

```text
https://github.com/new
```

Create a public repository named:

```text
saswat.github.io
```

Do not initialize it with a README, license, or `.gitignore`; this folder already has those files.

## 2. Commit and push

From this folder:

```powershell
git config user.name "Saswat Panda"
git config user.email "YOUR_EMAIL"
git add .
git commit -m "Create iNaturalist archive site"
git remote add origin https://github.com/saswat/saswat.github.io.git
git push -u origin main
```

If you choose a different repository name, change the remote URL accordingly.

## 3. Enable GitHub Pages

In the GitHub repo:

1. Open Settings.
2. Open Pages.
3. Under Build and deployment, set Source to GitHub Actions.
4. Open the Actions tab.
5. Run or wait for the `Build iNaturalist Archive` workflow.

The first public URL should be:

```text
https://saswat.github.io/
```

## 4. Add a custom domain

In the repo:

1. Open Settings.
2. Open Pages.
3. Under Custom domain, enter your domain.
4. Save.
5. After DNS is correct and GitHub finishes provisioning, enable Enforce HTTPS.

For an apex domain like `example.com`, add these DNS records at your registrar:

```text
Type  Name  Value
A     @     185.199.108.153
A     @     185.199.109.153
A     @     185.199.110.153
A     @     185.199.111.153
```

For `www.example.com`, add:

```text
Type   Name  Value
CNAME  www   saswat.github.io
```

For a subdomain like `nature.example.com`, add:

```text
Type   Name    Value
CNAME  nature  saswat.github.io
```

Avoid wildcard DNS records like `*.example.com`.

## 5. Set the canonical site URL

In GitHub:

1. Open Settings.
2. Open Secrets and variables.
3. Open Actions.
4. Open Variables.
5. Add:

```text
SITE_URL=https://yourdomain.com
SITE_DOMAIN=yourdomain.com
```

Then rerun the Pages workflow. 
