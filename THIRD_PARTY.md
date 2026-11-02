# Third-party notices and data sources

Neverquest’s original code uses the [MIT licence](LICENSE). Dependencies, game content and downloaded data keep their own licences. The public source includes no game artwork or downloaded community map images.

## Electron runtime

The app’s only direct npm dependency is [Electron](https://www.electronjs.org/). Its version is pinned in `package.json` and `package-lock.json`. Electron uses the MIT licence, included below. Its dependencies keep their own licences. The lockfile records their exact versions and available licence details; installed packages include the licence texts.

If you distribute a packaged app, include Electron’s `LICENSE`, `LICENSES.chromium.html` and any required dependency notices. Source releases leave out the installed runtime and `node_modules`.

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## External data and browser links

| Source | How Neverquest uses it |
| --- | --- |
| [MnMdb](https://mnm-db.com/) | Player listings, map lists, markers and optional map-image downloads. Map credits stay visible in the app. This content is downloaded separately. |
| [Monsters & Memories Wiki](https://monstersandmemories.wiki/) | Sources for the starter quest and crafting notes, with source links saved alongside them. Item buttons open the wiki in your browser. No walkthroughs or wiki artwork are included. |
| [MnM Atlas](https://www.mnmatlas.com/) | Optional links to zone maps in your browser. The site stays separate from the app. |

Before sharing downloaded images or data, check the original source’s terms and keep any required credits. Neverquest’s MIT licence doesn’t grant permission to redistribute that content. Private pins and player records stay on your PC; they aren’t uploaded to these services.

## CI tooling

The CI workflow uses GitHub’s official [checkout](https://github.com/actions/checkout/blob/v6/LICENSE) and [setup-node](https://github.com/actions/setup-node/blob/v6/LICENSE) actions, pinned to full commit hashes. Their own licence notices apply. They run the repository checks in CI and aren’t app dependencies.

Neverquest is an independent fan project and isn’t affiliated with or endorsed by Monsters & Memories or its developers. Game names and content belong to their respective owners.
