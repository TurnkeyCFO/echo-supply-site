# echo-supply-site

Storefront **hub** for the Echo Supply print-on-demand factory.

- **One repo, one Cloudflare Pages project, one domain.** Each storefront is a
  subdirectory (`/<store-slug>/`) of this repo, served as a path extension:
  `echo-supply-site.pages.dev/<store-slug>/`.
- The factory (`echo-supply-factory` skill — code in `labs/echo-supply/` of the
  workspace monorepo) is the **sole writer**. It commits each rendered storefront
  under `<store-slug>/` via the GitHub Git Data API. The push **is** the deploy —
  Cloudflare Pages auto-builds.
- Killing a store removes its `<store-slug>/` subdirectory; every other store
  keeps serving.

Do not hand-edit storefront subdirectories — the factory will overwrite them.

There is no custom domain yet — stores serve at `echo-supply-site.pages.dev`
until one is purchased.
