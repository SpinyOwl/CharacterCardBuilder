# Cloudflare Pages Deployment

This project is configured for Cloudflare Pages Git deployment.

## Target

- Pages project: `character-card-builder`
- Production domain: `character-card-builder.spinyowl.com`
- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist/character-card-builder/browser`

## First-Time Cloudflare Setup

1. Create or open the Cloudflare Pages project.
2. Connect this GitHub repository.
3. Set the production branch to `main`.
4. Set the build command to:

   ```bash
   npm run build
   ```

5. Set the build output directory to:

   ```bash
   dist/character-card-builder/browser
   ```

6. Attach the custom domain in Cloudflare:
   - Open Cloudflare dashboard.
   - Go to Workers & Pages.
   - Select `character-card-builder`.
   - Open Custom domains.
   - Add `character-card-builder.spinyowl.com`.

After setup, Cloudflare automatically builds and deploys the project when changes are pushed to `main`.

## Deploy

```bash
npm test -- --run
npm run build
git push origin main
```

Cloudflare Pages handles the deployment after the push.

## Configuration Files

- `wrangler.toml`
  - Defines the Pages project name and build output directory.
  - Uses compatibility date `2026-05-08`.
- `public/_redirects`
  - Adds a Cloudflare Pages SPA fallback: `/* /index.html 200`.

## Notes

- On this local Windows machine, `npm run build` can fail while inlining Google Material Symbols if Node does not trust the local certificate chain. Cloudflare can build the project with `npm run build`, so no Cloudflare-specific build script is required.
- Do not commit Cloudflare API tokens or account-specific secrets.
