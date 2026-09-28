# web-serial-polyfill, vendored

Web Serial's API over WebUSB, for CDC-ACM devices, from
[google/web-serial-polyfill](https://github.com/google/web-serial-polyfill). The console uses it
where the browser's own Web Serial cannot reach the blaster: Chrome on Android. Apache-2.0;
`LICENSE` beside this file is upstream's, and every vendored file keeps its copyright header.
Nothing here is modified.

The files are the npm package **web-serial-polyfill@1.0.15**
(`sha512-usZN7kGRkEWr8DzRWxW+og55L1fHo4hNIwxCSCfWKpM+i0L+2AwzupMvkDFxnJNqUFOhLaD3PlgAOJxUOUrAoA==`),
laid out as the package lays them out, and built from upstream commit
**a209091a2776aee2e0d5370e07cea8e521d16565** ("Generate an ES module (#58)", 2023-11-20). `dist/`
is compiled at publish time and is not in git, so the package is the source of record for it.

| file | package path | git blob sha1 |
| --- | --- | --- |
| `dist/serial.js` | `dist/serial.js` | `1741b7ddd0927dd1dda0fa8c17df1352306cf085` |
| `dist/serial.js.map` | `dist/serial.js.map` | `e53b0a4d8f2d2c436d9bbadcdd94553880260f64` |
| `serial.ts` | `serial.ts` | `da647745098bc589506ececeac6142ea4415009f` |
| `LICENSE` | `LICENSE` | `d645695673349e3947e8e5ae42332d0ac3164cd7` |

`git hash-object <file>` reproduces the right-hand column; `serial.ts` and `LICENSE` match
upstream's git at that commit too.

Vendored rather than installed for the reason picoflash is: the console builds offline, into one
file that works from `file://`.

The console imports `dist/serial.js`. `serial.ts` is here only because the source map points at it,
and `tsconfig.json` excludes it: it needs `@types/w3c-web-usb`, which the console does not carry.
For the same reason `dist/serial.d.ts` is ours rather than the package's, and declares only what
`src/serial/` uses.
