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

> `yt-dlp.exe` and `ffmpeg.exe` are not bundled in the npm package. They are obtained, verified against a manifest (SHA-256 and size), cached and used on first execution; nothing is downloaded when the package is installed. See [外部執行檔](#外部執行檔).

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

## 外部執行檔

本套件執行時需要下列外部執行檔,不含於 npm 包:

| 檔名 | 用途 | 來源 |
|---|---|---|
| yt-dlp.exe | 下載影音串流 | 本套件 GitHub repo 之 `bin/yt-dlp.exe`(自主幹 master 取得,見下) |
| ffmpeg.exe | 合併、轉檔 | 由 `w-ffmpeg` 取得(其 `bin/` 之切割 zip,釘選提交),清單與快取皆屬 `w-ffmpeg` |

- 首次使用 `WDwloadDlp` 時自動取得(或預先呼叫 `WDwloadDlp.ensureBins()` 取得 `yt-dlp.exe`、`WFfmpeg.ensureBins()` 取得 `ffmpeg.exe`),以清單所載之 SHA-256 與大小校驗後存於 `<套件根>/bin-cache/<sha256>/yt-dlp.exe`;之後自快取取得(亦校驗).安裝時不下載(無 `postinstall`).
- **主幹模式**:`yt-dlp` 須隨 YouTube 變動即時更新,故本套件的清單 `bin/manifest.json`(`mode: "floating"`)採主幹模式:連網呼叫時先取 GitHub master 之 `bin/manifest.json`,所載之 `yt-dlp.exe` 版本即為取用版本——**更新 yt-dlp 只須推上 GitHub,不須發布 npm 包**.npm 包內之同名檔為基準清單:取不到主幹清單(離線、被擋、格式不符、非本套件之清單)時改用它,此時只對已在快取或鏡像之檔有效.主幹清單之信任錨為 GitHub master(已接受之風險);快取內之 `manifest-last.json` 僅作紀錄,不作為退路.
- 連網呼叫每次都會取一次主幹清單(數百位元組);已快取之 `yt-dlp.exe` 不會重複下載.離線(`W_BIN_OFFLINE=1`)時不取主幹清單,直接用基準清單.
- 環境變數:
  - `W_BIN_CACHE=<資料夾>`:快取改放 `<資料夾>/w-dwload-dlp/`(套件所在之 `node_modules` 唯讀時使用,多套件可共用同一資料夾;`ffmpeg.exe` 則放在 `<資料夾>/w-ffmpeg/`).
  - `W_BIN_MIRROR=<資料夾或 http(s) 網址>`:內網鏡像,先找鏡像再連 GitHub;結構為 `<鏡像>/w-dwload-dlp/<sha256>/yt-dlp.exe`(`ffmpeg.exe` 為 `<鏡像>/w-ffmpeg/<sha256>/…`).鏡像之檔同樣以清單校驗,不符即不用.
  - `W_BIN_OFFLINE=1`:不連網,只用快取與鏡像;缺檔時錯誤(`E_OFFLINE_MISSING`)會列出缺哪些檔、sha256、大小與應放之完整路徑.
- 離線部署:
  1. 在可連網之電腦設 `W_BIN_CACHE=<空資料夾>`,呼叫 `WDwloadDlp.ensureBins()` 與 `WFfmpeg.ensureBins()` 各一次(或使用到 `WDwloadDlp` 一次).
  2. 把該資料夾整個帶到內網電腦,設 `W_BIN_MIRROR=<該資料夾>`(全離線時另設 `W_BIN_OFFLINE=1`).
  3. 注意主幹模式的限制:離線時不取主幹清單,用的是 npm 包內之基準清單所載版本,鏡像或快取須含**該版本**之檔(`bin/manifest.json` 之 `sha256`).步驟 1 若取得了較新的主幹版本(鏡像內是新版、基準清單是舊版),離線機會判為缺檔;此時錯誤訊息會列出應放之 sha256 與完整路徑,或升級本套件使基準清單追上新版.
- 取不到 `yt-dlp.exe` 或 `ffmpeg.exe` 時,`WDwloadDlp` 以字串 reject(維持既有型態),首行為 `[exeNotReady] …`,次行為 `錯誤碼 說明`(如 `E_OFFLINE_MISSING`、`E_HASH_MISMATCH`);`WDwloadDlp.ensureBins()` 則 reject 帶 `code` 之 Error.
- 每次呼叫 `WDwloadDlp` 都在自己的工作夾內作業:`os.tmpdir()` 下之 `w-dwload-dlp/<14 位時間>-<6 碼 id>/`,下載、合併、轉檔之中介檔皆在其內,結束時(成功或失敗)即整夾刪除,結果檔複製到呼叫端指定之 `fp`.故多個呼叫可同時進行,互不影響;不寫執行檔所在夾,也不切換行程工作路徑(`process.chdir`).
- 行程崩潰或被強制結束時工作夾會殘留:每次呼叫開始時,自動刪除 `w-dwload-dlp/` 下修改時間逾 24 小時之工作夾(只認上述命名之資料夾,其他東西不動;刪除失敗則忽略,不影響本次呼叫).已知限制:單一呼叫若持續超過 24 小時(例如錄製直播),其工作夾在他呼叫開始時會被視為殘留而嘗試刪除,本套件不支援此用法.
- 維護者更新 `yt-dlp.exe` 見 [yt-dlp.md](yt-dlp.md).

## Breaking changes
(依自有套件原則:不保留舊版相容層,下游連帶修正)

- 移除 `src/autoDownloadFiles.mjs`:改用 `WDwloadDlp.ensureBins()`(或深層匯入 `w-dwload-dlp/src/ensureBins.mjs`)取得 `yt-dlp.exe`,回傳 `{ 'yt-dlp.exe': 絕對路徑 }`;`ffmpeg.exe` 改用 `w-ffmpeg` 1.0.29 以上之 `WFfmpeg.ensureBins()`,回傳 `{ 'ffmpeg.exe': 絕對路徑 }`.舊回傳之 `{ fpExeDlp, fpExeFfmpeg }` 不再提供.
- 移除 `src/downloadFiles.mjs`、`src/ensureDlpExe.mjs`、`src/parseDlpManifest.mjs`、`scripts/install.mjs`(`postinstall`)與 `toolg/genManifest.mjs`:下載、快取、校驗改由 `wsemi` 之 `fsEnsureBins` 統一實作.
- `yt-dlp.exe` 不再位於套件內 `yt-dlp/yt-dlp.exe`(亦不在 `node_modules/w-dwload-dlp/yt-dlp/`),改在快取 `bin-cache/<sha256>/yt-dlp.exe`(或 `W_BIN_CACHE` 指定處).依舊路徑查找者請改用 `ensureBins`.
- `yt-dlp/manifest.json`(自訂單檔格式)與 `yt-dlp/yt-dlp-ver.txt` 改為制式清單 `bin/manifest.json`(版本記於其 `version` 欄,由 `bin/yt-dlp.exe --version` 產生);master 上已無 `yt-dlp/` 目錄,故**舊版套件(≤1.0.51)在無 `yt-dlp.exe` 時自 master 取清單或檔案將得 404**(明確的 `E_MANIFEST_HTTP`／`E_HTTP`／`[exeNotReady]` 錯誤);已存在 `yt-dlp.exe` 之舊安裝不受影響(舊版直接採用既有檔).請升級到本版.
- 下載暫存夾由 `<yt-dlp.exe 所在夾>/Downloads`(各呼叫共用)改為每次呼叫專用之 `os.tmpdir()` 下之 `w-dwload-dlp/<14 位時間>-<6 碼 id>/`,結束時(成功或失敗)整夾刪除;`WDwloadDlp` 不再 `process.chdir`.
- 移除選項 `opt.clean`:共用下載夾時預先清除會把併行呼叫下載中之檔清掉(`[outputNotFound]`),改為各呼叫自有工作夾後已無共用之暫存檔可清.傳入 `clean` 不再有作用(不保留別名);崩潰殘留之舊工作夾改由每次呼叫開始時自動清除逾 24 小時者.
- 新增相依 `wsemi` ≥ 1.9.27、`w-ffmpeg` ≥ 1.0.29;`ffmpeg.exe` 不再位於 `node_modules/w-ffmpeg/src/`.
