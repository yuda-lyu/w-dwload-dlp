# w-dwload-dlp
A download tool for video.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-dwload-dlp.svg?style=flat)](https://npmjs.org/package/w-dwload-dlp) 
[![license](https://img.shields.io/npm/l/w-dwload-dlp.svg?style=flat)](https://npmjs.org/package/w-dwload-dlp) 
[![npm download](https://img.shields.io/npm/dt/w-dwload-dlp.svg)](https://npmjs.org/package/w-dwload-dlp) 
[![npm download](https://img.shields.io/npm/dm/w-dwload-dlp.svg)](https://npmjs.org/package/w-dwload-dlp) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-dwload-dlp.svg)](https://www.jsdelivr.com/package/npm/w-dwload-dlp)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-dwload-dlp/global.html).

## Core
> `w-dwload-dlp` is basing on `yt-dlp`, and should run in `Windows`.

> The ffmpeg.exe file is too large and will be split into small zip files for upload. If ffmpeg is missing during the first execution, it will be automatically decompressed from the zip file.

> The `yt-dlp.exe` file is not bundled in the npm package. It is downloaded from the `master` branch of this repository on GitHub (`yt-dlp/yt-dlp.exe`) when the package is installed (postinstall) or, if that was skipped, on first execution, and it is verified before it is put in place (see below).

## Download integrity
The download is verified against `yt-dlp/manifest.json`, which sits next to `yt-dlp.exe` on the same branch (it is not included in the npm package either). Because the manifest lives on the branch, pushing a new `yt-dlp.exe` together with its manifest takes effect for new installs without publishing to npm.

`yt-dlp/manifest.json` (schema 1):
```alias
{
  "schema": 1,
  "file": "yt-dlp.exe",
  "version": "2026.10.26",
  "sha256": "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d",
  "size": 23575744
}
```
- `schema`: always `1`. `file`: must be `yt-dlp.exe`. `version`: the yt-dlp tag, equal to the tag on the first line of `yt-dlp/yt-dlp-ver.txt`. `sha256`: 64 lowercase hex characters. `size`: bytes.
- The manifest is fetched first. If it can not be fetched or is malformed, the download fails; there is no fallback to an unverified download.
- `yt-dlp.exe` is streamed to a temporary file `yt-dlp.exe.<pid>.<random>.part` in the same folder while its SHA-256 and size are computed, and it is renamed to `yt-dlp.exe` (replacing the old file) only if both match the manifest. On any failure (HTTP error, interruption, stall, size or hash mismatch, rename failure) the name `yt-dlp.exe` is never replaced by unverified or incomplete content (an already existing `yt-dlp.exe` is left untouched), and the temporary file is removed; if it can not be removed the error message says so and names the file. If a temporary file could not be removed in one attempt but a later attempt succeeds, the download succeeds and a warning is logged for the leftover `.part` file.
- GitHub raw is cached by a CDN for about 5 minutes, so right after an update the manifest and the exe may briefly disagree. Hash/size mismatches and transient errors (connection failure, 5xx, 408, 429, stall) are retried, re-fetching the manifest each time: at most 4 attempts, waiting 20 s, 40 s and 60 s between them, and never more than 10 minutes in total for the network phase (requests, writing and closing the temporary file; a 30 s silence aborts a request). The local rename/cleanup back-off after a successful verification adds at most about 3 s. A missing manifest (404), a malformed manifest and a full disk are not retried.
- A failure in `postinstall` is only logged and does not fail `npm i`; `autoDownloadFiles()` downloads again the first time it finds `yt-dlp.exe` missing. An existing `yt-dlp.exe` is used as it is: it is neither hashed nor re-downloaded at run time.
- The error carries `code` (`E_MANIFEST_HTTP`, `E_MANIFEST_FORMAT`, `E_HTTP`, `E_NETWORK`, `E_TIMEOUT`, `E_TIMEOUT_TOTAL`, `E_SIZE_MISMATCH`, `E_HASH_MISMATCH`, `E_FS`, `E_RENAME`), `step` and `attempts`; the message gives the expected and actual hash (shortened), the failed step and a hint.

Maintainers: after replacing `yt-dlp/yt-dlp.exe` run `node toolg/genManifest.mjs` to regenerate the manifest; `npm test` (`test/unit-dlpManifest.test.mjs`) fails when the manifest does not match the exe or `yt-dlp-ver.txt`.

## Installation

### Using npm(ES6 module):
```alias
npm i w-dwload-dlp
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-dwload-dlp/blob/master/g.mjs)]
```alias
// import WDwloadDlp from 'w-dwload-dlp'
import WDwloadDlp from 'w-dwload-dlp/src/WDwloadDlp.mjs'

async function test() {

    //url
    let url = `https://www.youtube.com/watch?v=jfXg5ZslKg4&list=RDjfXg5ZslKg4&start_radio=1` //youtube mp4
    // let url = `https://www.youtube.com/watch?v=fTk0mc946dk` //youtube webm
    // let url = `https://www.youtube.com/watch?v=lKoCiBVKQaQ` //youtube webm
    // let url = `https://www.bilibili.com/video/BV1JZ421x7q8/?spm_id_from=333.1073.channel.secondary_floor_video.click` //bilibili
    // let url = `https://ooo.mp4` //直接提供mp4檔
    // let url = `https://cdn.jsdelivr.net/npm/w-demores/res/video/aigen_hls/playlist.m3u8`

    //fp
    let fp = './test.mp4'

    //funProg
    let funProg = (prog, nn, na) => {
        console.log('prog', `${prog.toFixed(2)}%`, nn, na)
    }

    //WDwloadDlp
    await WDwloadDlp(url, fp, {
        clean: true, //單一程序執行時, 事先清除之前暫存檔, 減少浪費硬碟空間
        funProg,
    })

    //len
    let len = fs.statSync(fp).size
    console.log('len', len)

    console.log('done:', fp)
}
test()
    .catch((err) => {
        console.log('catch', err)
    })
// prog 0.49% 1 99
// prog 5.05% 4 99
// ...
// prog 99.00% 98 99
// prog 100.00% 99 99
// len 22394508
// done: ./test.mp4
```
