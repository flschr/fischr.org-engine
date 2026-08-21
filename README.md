# Eleventy Git Blog Engine

A portable personal publishing engine built with Eleventy, Markdown and Git. It includes a responsive public site, feeds and search, a browser-based editor, media handling, publishing automation, Cloudflare Functions and a comprehensive test suite.

This repository is an automatically generated software snapshot. It intentionally contains neutral example content instead of the posts, pages, media, publishing ledgers and history from the production site that it comes from.

## Features

- Markdown posts and pages rendered with Eleventy
- Responsive images, local video and GPX track support
- RSS, sitemap, redirects, microformats and Pagefind search
- Browser-based Git editor under `/admin/`
- Optional social publishing, Webmentions, IndexNow and AT Protocol helpers
- Cloudflare Pages Functions and security headers
- Automated linting, tests and production builds

## Requirements

- Node.js 22
- npm

## Quick start

```sh
npm ci
npm start
```

Open the local address printed by Eleventy. Before deploying, run the same validation used by CI:

```sh
npm run validate:public
```

## Make it yours

Start with these generated example files:

- `blog/_data/site.json` for the site name, author, URL and social metadata
- `blog/about.njk` and `blog/projects.njk` for static pages
- `blog/posts/welcome.md` for the first post
- `blog/_includes/partials/` for navigation, footer and profile presentation

The example domain `mysite.example`, repository coordinates and author details are placeholders. Search for `example` before deploying. The admin editor also needs a GitHub OAuth integration and repository configuration appropriate for your deployment.

## Deployment

The project is designed for Cloudflare Pages. Use `npm run build` as the build command and `_site` as the output directory. Review `wrangler.jsonc`, the functions, security headers and all automation configuration before connecting a real domain or credentials.

Do not commit access tokens or production publishing ledgers. Keep secrets in the deployment platform and replace the placeholder privacy page with one appropriate for your site and jurisdiction.

## Development model

This public repository is generated from a private production source. Direct changes here may be overwritten by the next export and cannot be merged back automatically. Use it as readable source, a starting point for your own fork, or a reference implementation.

## License

The software is available under the [MIT License](LICENSE). Content, media and branding from the production site are not included in this repository.
