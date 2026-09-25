# picoflash, vendored

PICOBOOT over WebUSB, from [piersfinlayson/picoflash](https://github.com/piersfinlayson/picoflash).
MIT; `LICENSE` beside this file is upstream's, and every vendored file keeps its own copyright
header. Nothing here is modified — the files are byte-identical to upstream.

Upstream commit: **678355430aff0ee9efa6d552fb81832a91d89ef4** ("Update copyright year to 2026",
2026-08-25).

| file | upstream path | git blob sha1 |
| --- | --- | --- |
| `pkg/picoboot.js` | `pkg/picoboot.js` | `38a9b65af69a715e13bb8f8795f72588f42e80b4` |
| `pkg/connection.js` | `pkg/connection.js` | `8a899f16eb802d4e98fd9f604cbf1e138c9e5b15` |
| `pkg/target.js` | `pkg/target.js` | `4ad1db3a9bc4a697555808d8a194b791b1472612` |
| `pkg/commands.js` | `pkg/commands.js` | `300f45af3e7f249715040c56151b98f41121f25a` |
| `pkg/constants.js` | `pkg/constants.js` | `9a493c2b84d22335fe1a51c905619e9c04f40b8d` |
| `pkg/errors.js` | `pkg/errors.js` | `4420d18f223f59390f78f29f6731dced18798724` |
| `js/uf2/uf2.js` | `js/uf2/uf2.js` | `f3839d85e81fe1e4f513d86e251ff92f545d2e8b` |
| `LICENSE` | `LICENSE` | `21cc927e6b2f4d8b07a61a9fa9498bc142ec2575` |

`git hash-object <file>` reproduces the right-hand column, so drift from upstream is detectable
without a network. The project pins every PlatformIO dependency to a commit SHA
this is the same rule applied to vendored JS.

## Why vendored rather than an npm dependency

The console builds to one self-contained classic-script HTML file that has to work from `file://`,
and it has to build offline. A dependency resolved at install time is neither.

## Why `pkg/index.js` is deliberately absent

The upstream barrel re-exports `FLASH_END_RP2040` and `FLASH_END_RP2350`, which `pkg/constants.js`
does not define. A browser resolving that module throws a link-time `SyntaxError`. picoflash's own
site imports the submodules directly, which is why the broken barrel has gone unnoticed upstream —
and is what the console does too. Import `pkg/picoboot.js`, `pkg/constants.js` and `js/uf2/uf2.js`
by path; do not add `index.js` back.

## `.d.ts` files

The `.d.ts` files beside the `.js` ones are ours, not upstream's: picoflash ships JSDoc rather than
types, and `allowJs` is off. They declare only the surface `src/flash/` uses, so an unused upstream
method is absent from them by design rather than by oversight.

## Not vendored

`pkg/index.js` (above), `js/flash/picoflash.js` (upstream's own page UI) and everything else in the
repo. Vendor a file when something imports it.
