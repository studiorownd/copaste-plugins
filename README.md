# Copaste Plugins

This is the official Copaste plugin catalog maintained by Studio Rownd. Open **Plugins** in the Preferences sidebar. Calculator ships with Copaste and is enabled by default. Optional plugins download when you enable them, and Copaste keeps enabled packages up to date automatically.

Plugin packages stay on the current Mac. If you use iCloud backup, your enabled choices are saved with your Copaste configuration. Copaste downloads the selected packages again as needed when you restore that configuration on another Mac.

## Submit a plugin

1. Fork [studiorownd/copaste-plugins](https://github.com/studiorownd/copaste-plugins) on GitHub and clone your fork. Create a branch such as `add-docs-plugin`.
2. Add `plugins/<id>/latest.json` with a unique ID and command. New community packages can use `kind: "links"`. To update a plugin, edit its existing `latest.json`.
3. Use Node.js 24 to regenerate and check the catalog from the repository root.

   ```sh
   node scripts/build-catalog.mjs
   node scripts/build-catalog.mjs --check
   ```

4. Commit the package and regenerated catalog files. Push your branch to your fork and open a pull request against `studiorownd/copaste-plugins:main`. Include what the plugin does, its command, the destinations it opens and how you checked it.

Studio Rownd reviews the package and the destinations it links to before merging. GitHub Actions checks the package shape, generated catalog and archived files. After the PR merges to `main`, Copaste picks up the change on its next plugin update check.

## Package format

For example, `plugins/docs/latest.json` could contain the following package. Enter `docs` in app search to pick a link, then press Return to open it in your browser.

```json
{
  "apiVersion": 1,
  "id": "docs",
  "kind": "links",
  "command": "docs",
  "activation": { "mode": "command" },
  "defaultEnabled": false,
  "title": "Developer Docs",
  "description": "Open browser and Apple developer documentation",
  "logo": { "background": { "start": "#549aff", "end": "#284ccb" }, "symbol": "book" },
  "links": [
    { "title": "MDN Web Docs", "url": "https://developer.mozilla.org/en-US/docs/Web" },
    { "title": "Apple Developer Documentation", "url": "https://developer.apple.com/documentation/" }
  ]
}
```

- Start the ID and command with a lowercase letter. Use up to 40 characters drawn from `a–z`, `0–9` and `-`.
- Match the directory name to the plugin ID. Put changes in `latest.json`. Copaste detects new content by its catalog digest.
- Declare `activation.mode`. Commands use the declared `command` followed by Return. Inline packages declare an `activation.example` that Copaste shows in Preferences. A command can also declare a search input `placeholder`.
- Supply a short title and description. Titles are limited to 80 characters and descriptions to 200.
- Choose a logo symbol (`calculator`, `plugs`, `book`, `code`, `globe`, `link` or `terminal`) and two six-digit hex colors in `logo.background.start` and `logo.background.end`. Use the same color twice for a solid background. Copaste renders the mark in both themes.
- Set `defaultEnabled: false` for optional packages. Copaste builds take the data for packages marked `bundled` from the generated `bundled.json`. Bundled packages can declare an enabled default.
- Include between one and 100 links with clear titles and HTTPS URLs. Use stable destinations without credentials, tracking or URL shorteners. A package can be at most 64 KiB.

Packages describe their activation, appearance and selected host capability. Copaste provides the code for those capabilities. A `links` package lists destinations and lets users choose which URL to open. Calculator and Port Manager select the arithmetic and macOS TCP listener capabilities. Propose new host capabilities separately so Studio Rownd can review the platform access they require. See the [Calculator package](plugins/calculator/latest.json) and [Port Manager package](plugins/ports/latest.json).

The generator validates every package and records the SHA-256 of its exact bytes in `catalog-latest.json`. Copaste fetches the catalog from the official Studio Rownd repository and checks the hash before replacing an optional package. The original `catalog.json` and numbered package files serve older builds.
