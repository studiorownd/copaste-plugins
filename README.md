# Copaste Plugins

This is the official Copaste plugin catalog maintained by Studio Rownd. Open **Plugins** in the Preferences sidebar to browse and enable plugins. Calculator ships with Copaste and is enabled by default. Optional plugins such as Port Manager download when you enable them.

Plugin packages stay on the current Mac. If you use iCloud backup, your enabled choices are saved with your Copaste configuration. Copaste downloads the selected packages again as needed when you restore that configuration on another Mac.

## Submit a plugin

1. Fork [studiorownd/copaste-plugins](https://github.com/studiorownd/copaste-plugins) on GitHub and clone your fork. Create a branch such as `add-docs-plugin`.
2. Add `plugins/<id>/<version>.json`. For a new plugin, use `kind: "links"` and start at `1.0.0`. Choose an ID and a command that are unique in the catalog.
3. Use Node.js 24 to regenerate and check the catalog from the repository root.

   ```sh
   node scripts/build-catalog.mjs
   node scripts/build-catalog.mjs --check
   ```

4. Commit the package and `catalog.json`. Push your branch to your fork and open a pull request against `studiorownd/copaste-plugins:main`. Include what the plugin does, its command, the destinations it opens and how you checked it.

Studio Rownd reviews the package and the destinations it links to before merging. GitHub Actions checks the package shape, the generated catalog and the integrity of previously published version files. Once a reviewed PR is merged to `main`, the new catalog can be refreshed in Copaste.

## Package format

For example, `plugins/docs/1.0.0.json` could contain the following package. Enter `docs` in app search to pick a link, then press Return to open it in your browser.

```json
{
  "apiVersion": 1,
  "id": "docs",
  "version": "1.0.0",
  "kind": "links",
  "command": "docs",
  "title": "Developer Docs",
  "description": "Open browser and Apple developer documentation",
  "logo": { "color": "blue", "symbol": "book" },
  "links": [
    { "title": "MDN Web Docs", "url": "https://developer.mozilla.org/en-US/docs/Web" },
    { "title": "Apple Developer Documentation", "url": "https://developer.apple.com/documentation/" }
  ]
}
```

- Start the ID and command with a lowercase letter. Use up to 40 characters drawn from `a–z`, `0–9` and `-`.
- Use a numeric `major.minor.patch` version. Match both the directory ID and the filename version to the JSON fields. To update a plugin, add a file with a higher version so the original remains reproducible.
- Supply a short title and description. Titles are limited to 80 characters and descriptions to 200.
- Choose a logo color (`violet`, `teal`, `blue`, `orange`, `pink` or `slate`) and symbol (`calculator`, `plugs`, `book`, `code`, `globe`, `link` or `terminal`). Copaste renders the mark in both themes.
- Include between one and 100 links with clear titles and HTTPS URLs. Use stable destinations without credentials, tracking or URL shorteners. A package can be at most 64 KiB.

Packages contain data that Copaste interprets. A `links` package lists destinations and lets users choose which URL to open. Calculator and Port Manager use the same API version and metadata fields with host-provided `calculator` and `tcp-listeners` capabilities. Propose new host capabilities separately so Studio Rownd can review the platform access they require. See the [Calculator package](plugins/calculator/1.0.0.json) and [Port Manager package](plugins/ports/1.0.0.json).

The generator validates every package, selects the newest version per ID and records the SHA-256 of its exact bytes in `catalog.json`. Copaste fetches the catalog from the official Studio Rownd repository and checks the hash before installing an optional package.
