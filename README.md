# Copaste Plugins

This is the official Copaste plugin catalog maintained by Studio Rownd. Open **Plugins** in the Preferences sidebar. Copaste downloads Calculator automatically on the first online launch. Other plugins download when you enable them. Copaste keeps enabled packages up to date automatically.

Plugin packages stay on the current Mac. If you use iCloud backup, your enabled choices are saved with your Copaste configuration. Copaste downloads the selected packages again as needed when you restore that configuration on another Mac.

## Submit a plugin

1. Fork [studiorownd/copaste-plugins](https://github.com/studiorownd/copaste-plugins) on GitHub and clone your fork. Create a branch such as `add-docs-plugin`.
2. Add `plugins/<id>/manifest.json` and `plugins/<id>/plugin.js`. Choose a unique ID and command. For an update, edit those same files in the existing plugin folder.
3. Use Node.js 24 to regenerate and check the catalog from the repository root.

   ```sh
   node scripts/build-catalog.mjs
   node scripts/build-catalog.mjs --check
   ```

4. Commit both source files, the generated `latest.json` package and the regenerated catalog. Push your branch to your fork and open a pull request against `studiorownd/copaste-plugins:main`. Include what the plugin does, its command, the destinations it opens and how you checked it.

Studio Rownd reviews the package and the destinations it links to before merging. GitHub Actions checks the package shape, generated catalog and archived files. After the PR merges to `main`, Copaste picks up the change on its next plugin update check.

## Package format

For example, `plugins/docs/manifest.json` could contain the following metadata. Enter `docs` in app search to pick a link, then press Return to open it in your browser.

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
- Match the directory name to the plugin ID. Edit `manifest.json` and `plugin.js`, then regenerate `latest.json`. Copaste detects new content by its catalog digest.
- Declare `activation.mode`. Commands use the declared `command` followed by Return. Inline packages declare an `activation.example` that Copaste shows in Preferences. A command can also declare a search input `placeholder`.
- Supply a short title and description. Titles are limited to 80 characters and descriptions to 200.
- Browse the [Phosphor Icons gallery](https://phosphoricons.com/) and preview the **Duotone** weight. Set `logo.symbol` to one of the supported keys: Calculator (`calculator`), Plugs Connected (`plugs`), Book Open (`book`), Code (`code`), Globe Simple (`globe`), Link Simple (`link`) or Terminal Window (`terminal`). Set `logo.background.start` and `logo.background.end` to six-digit hex colors, using the same color twice for a solid background. If your logo needs a different Phosphor icon, include its gallery name in your PR.
- Set `defaultEnabled: false` for optional packages. Studio Rownd controls the enabled defaults through the public catalog.
- For `kind: "links"`, include between one and 100 links with clear titles and HTTPS URLs. Use stable destinations without credentials, tracking or URL shorteners. A package can be at most 64 KiB.

## Write the plugin script

In `plugin.js`, assign your synchronous entry point to `globalThis.copastePlugin`. The script runs with JSON input and output in an isolated worker with no filesystem, network, Node.js or Electron APIs. The host renders results and performs actions for its existing capabilities.

For the developer docs plugin, add `plugins/docs/plugin.js` with this entry point. Copaste supplies the links from the manifest with an ID on each row. Return the IDs to display in order.

```js
globalThis.copastePlugin = {
  query(query, links) {
    const filter = query.toLowerCase();
    return links
      .filter(({ title, url }) => `${title} ${url}`.toLowerCase().includes(filter))
      .map(({ id }) => id);
  },
};
```

- [Calculator](plugins/calculator/plugin.js) uses `kind: "calculator"` and implements `evaluate(query)`. It returns `{ answer, value }` for an expression or `null`. Use a finite number for `value` and a numeric string for `answer`. Copaste shows the calculation and handles copying the answer.
- [Port Manager](plugins/ports/plugin.js) uses `kind: "tcp-listeners"` and implements `query(query, listeners)`. The host supplies a bounded local snapshot with `id`, `pid`, `name` and `endpoints`. Return up to 100 rows using `{ id, title, description }`. Copaste verifies row IDs, owns the confirmation dialog and rechecks the process before termination.
- Propose a new host capability separately so Studio Rownd can review the platform access it needs.

The generator checks the manifest and JavaScript syntax, builds `latest.json`, and records the SHA-256 of the package's exact bytes in `catalog-latest.json`. Copaste verifies the downloaded package against that digest before replacing the installed copy. The original `catalog.json` and numbered package files serve older builds.
