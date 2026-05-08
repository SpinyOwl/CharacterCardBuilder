# Cloudflare Pages Deployment

This project is configured for Cloudflare Pages direct upload with Wrangler.

## Target

- Pages project: `character-card-builder`
- Production domain: `character-card-builder.spinyowl.com`
- Build output: `dist/character-card-builder/browser`

## First-Time Cloudflare Setup

1. Authenticate Wrangler:

   ```bash
   npm run cf:login
   npm run cf:whoami
   ```

2. Create the Cloudflare Pages project if it does not already exist. The first direct upload deploy can create it:

   ```bash
   npm run deploy:cloudflare
   ```

3. Attach the custom domain in Cloudflare:
   - Open Cloudflare dashboard.
   - Go to Workers & Pages.
   - Select `character-card-builder`.
   - Open Custom domains.
   - Add `character-card-builder.spinyowl.com`.

Wrangler deploys the Pages project, but custom domain attachment for Pages is managed in the Cloudflare dashboard or API.

## Deploy

```bash
npm run deploy:cloudflare
```

The script runs an Angular production build with Node system CA support, then uploads `dist/character-card-builder/browser` through Wrangler:

```bash
node scripts/run-wrangler.mjs pages deploy dist/character-card-builder/browser --project-name character-card-builder --branch main
```

## Local Pages Preview

```bash
npm run preview:cloudflare
```

## Configuration Files

- `wrangler.toml`
  - Defines the Pages project name and build output directory.
  - Uses compatibility date `2026-05-08`.
- `public/_redirects`
  - Adds a Cloudflare Pages SPA fallback: `/* /index.html 200`.
- `scripts/run-wrangler.mjs`
  - Runs the globally installed Wrangler CLI with `NODE_OPTIONS=--use-system-ca`.

## Notes

- The Angular production build may fail on some Windows setups while inlining Google Material Symbols if Node does not trust the local certificate chain. The Cloudflare build script uses `node --use-system-ca` to avoid that local certificate issue.
- This repository expects Wrangler to be available on `PATH`. This machine currently has Wrangler `4.87.0`.
- Do not commit Cloudflare API tokens. Use `wrangler login` locally or CI secrets such as `CLOUDFLARE_API_TOKEN` when automating deployment.
