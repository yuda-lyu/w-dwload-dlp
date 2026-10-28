# w-dwload-dlp 狀態

## 外部執行檔(2026-10-29 起依制式規格,主幹模式)

規格:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`;本套件為 A 類、主幹模式(主控帳本 G10 登記).規則見 `sgud/rule/rulebook.md` R1~R3.

| 項目 | 現況 |
|---|---|
| `bin/yt-dlp.exe` | yt-dlp stable **2026.10.26**(brotli **1.2.1**),入 git、**不入 npm 包** |
| `bin/manifest.json` | 制式清單 schema 1:`mode: "floating"`、`repo: yuda-lyu/w-dwload-dlp`、不帶 `commit`、`version`(yt-dlp 版本,取自 `bin/yt-dlp.exe --version`)、`files: [{ name, path, sha256, size }]`;由 `toolg/genBinManifest.mjs` 產生;入 git 且入 npm 包(取不到主幹清單時之基準清單) |
| `src/ensureBins.mjs` | 轉呼叫 wsemi `fsEnsureBins('bin/manifest.json', { …opt, pkgRoot })`;`pkgRoot` 以本檔位置推得(`src/`、`dist/` 皆為套件根下一層);不轉傳 `floatingManifestUrl` |
| `src/WDwloadDlp.mjs` | `await ensureBins({ names: 'yt-dlp.exe' })` 取 yt-dlp.exe、`await WFfmpeg.ensureBins({ names: 'ffmpeg.exe' })` 取 ffmpeg.exe(`import WFfmpeg from 'w-ffmpeg'`,rollup external);失敗以字串 reject `[exeNotReady] …\n<錯誤碼> <說明>`;`WDwloadDlp.ensureBins = ensureBins`(靜態屬性,主檔只有 default 匯出);不再 `process.chdir` |
| 工作夾(2026-10-29,bin-dlp2;規則 R3) | **每次呼叫用自己之工作夾** `os.tmpdir()/w-dwload-dlp/<now2strp()>-<genID(6)>/`(下載、合併、轉檔之中介檔皆在其內,夾由 yt-dlp 自動建立),`finally` 以 `fsDeleteFolderSafe` 整夾刪除(成功與失敗皆然,被占用重試,失敗忽略);結果檔仍複製到呼叫端之 `fp`;**`opt.clean` 已移除**(不留別名);每次呼叫在 `ensureBins` 成功後先刪 `w-dwload-dlp/` 下命名符合 `reWork`、為資料夾、修改時間逾 `msStaleWork`(24 小時,單一常數)者(失敗忽略);主函數拆為 `WDwloadDlp`(前置檢查、取執行檔、工作夾生命週期)與 `dwloadInWork`(於工作夾內下載並交付) |
| 取得順序 | 快取(`bin-cache/<sha256>/yt-dlp.exe` 或 `W_BIN_CACHE`)→ 鏡像(`W_BIN_MIRROR`)→ GitHub master(`https://raw.githubusercontent.com/yuda-lyu/w-dwload-dlp/master/bin/yt-dlp.exe`);連網呼叫先取 master 之 `bin/manifest.json`(取不到/無效 → 基準清單),離線不取主幹清單;任何來源皆以清單校驗 |
| 忽略規則 | `.npmignore`:`/bin/*`、`!/bin/manifest.json`、`/bin-cache/`、`/test/_tmp/`;`.gitignore`:`/bin-cache/`;`.gitattributes`:`bin/** binary` |
| rollup UMD | `toolg/gDistRollup.mjs` external／globals 含 `os`、`url`、`crypto`、`stream`、`stream/promises`、`w-ffmpeg`(2026-10-29 暫存夾實建一次,`dist` 內無 `import.meta`,`require("w-ffmpeg")`,`ensureBins` 靜態屬性可用,套件根為 `dist/` 之上一層) |
| 相依 | `wsemi` ^1.9.27、`w-ffmpeg` ^1.0.29;無 `postinstall` |
| 已移除 | `src/autoDownloadFiles.mjs`、`downloadFiles.mjs`、`ensureDlpExe.mjs`、`parseDlpManifest.mjs`、`scripts/install.mjs`、`toolg/genManifest.mjs`、`yt-dlp/` 目錄、`test/tools/dlpServer.mjs` 及其三支測試(`unit-downloadFiles`、`unit-ensureDlpExe`、`unit-dlpManifest`;下載核心之測試已在 wsemi) |

## 測試

| 檔 | 內容 |
|---|---|
| `test/unit-binManifest.test.mjs` | 清單形態、與 `bin/` 實檔一致、版本與 `yt-dlp.exe --version` 一致、清單即 `genBinManifest` 所產、README 節、`.gitignore`／`.gitattributes`、T1(含誘餌檔之 `npm pack`)、src 無自寫下載、無 postinstall、相依版本、rollup external、主檔匯出形態 |
| `test/api-ensureBins.test.mjs` | T3~T8(本機 HTTP 伺服器扮 `raw.githubusercontent.com`、本地資料夾扮鏡像與快取,不連外網)、環境變數、套件根與 cwd 無關(子行程 `test/tools/ensureBinsChild.mjs`)、不轉傳 `floatingManifestUrl`;主函數類入口(攔截全域 `fetch`、攔截 `child_process.spawn` 改跑假 yt-dlp `test/tools/fakeDlp.mjs`、以假檔取代 `WFfmpeg.ensureBins`) |
| `test/api-workFolder.test.mjs` | 規則 R3(假 yt-dlp 起真子行程、`TEMP`/`TMP` 導向 `test/_tmp/workFolder/tmp`,不連外網):兩併行呼叫之工作夾互不相同且先結束者不動後結束者下載中之檔、yt-dlp 失敗／無輸出檔／複製失敗皆刪夾、早退(`invalidUrl`／`exeNotReady`)不建夾、殘留夾 25h 刪／23h 留／命名不符與同名檔案不動、`clean` 無作用、刪除失敗忽略並由之後呼叫清、被占用(EBUSY)重試 |
| `test/unit-workFolder.test.mjs` | src 無 `clean`／`Downloads`／`fsCleanFolder`、24 小時常數單一、README 與功能測試不含 `clean` 選項 |
| `test/tools/fakeRun.mjs`、`test/tools/fakeDlp.mjs` | 主函數類測試共用夾具:攔截全域 `fetch` 與 `child_process.spawn`、假 `WFfmpeg.ensureBins`;假 yt-dlp 依 url 末段分 `fail`／`nofile`／正常,`FAKE_DLP_GATE` 為閘門令併行呼叫確定同時在跑 |
| `test/unit-parseDlpError.test.mjs` | yt-dlp 錯誤分類(未動) |
| `test/dw_mp4.test.mjs`、`test/dw_m3u8.test.mjs` | 功能測試,實際連 YouTube／jsdelivr 下載;`yt-dlp.exe` 以本機鏡像供檔(`test/tools/dwMirror.mjs`),`ffmpeg.exe` 由 w-ffmpeg 自行取得(連 GitHub) |

最近一次驗證(2026-10-29,bin-dlp2 輪):全套 `npm test`(`mocha --parallel`)**75 passing、0 failing**,同一次測試鎖內連跑 3 次皆綠(每次約 14 秒;`dw_mp4`、`dw_m3u8` 併行實際下載皆成功);舊碼(bin-dlp 輪之共用 `Downloads` 夾加 `clean`)配最終版測試 11 案紅;工作夾變異 20 項:19 被抓、1 存活(m06 為等價變異——`fsDeleteFolder` 自身拒刪非資料夾,以 m19 直接 `rmSync` 之變異證實「命名相符之檔案不刪」之斷言有效);L0 lint 0 error、UMD 於暫存夾實建可載入且 `ensureBins` 靜態屬性在.
bin-dlp 輪(2026-10-29)之結果:舊碼(HEAD)配新測試 14 案紅、變異 28 項全被抓;`node C:/opensrcOper/tools/scan-bins.mjs --only w-dwload-dlp` 為 OK;`npm pack --dry-run` 之 `bin/` 只有 `manifest.json`(該部分本輪未動).

## 更新 yt-dlp.exe

見 `yt-dlp.md`:替換 `bin/yt-dlp.exe` → `node toolg/genBinManifest.mjs` → `npm test` → exe 與清單同一提交推 GitHub master.管控端 `update-ytdlp.mjs`／`watch-ytdlp.mjs` 之路徑須改(見 2026-10-29 bin-dlp 報告).

## 已知缺口與待辦

- **含本次改造之 npm 版本發布前,`bin/yt-dlp.exe`、`bin/manifest.json`、`.gitattributes` 須已推上 GitHub master**,否則新版安裝取不到 `bin/yt-dlp.exe`(主幹清單 404 → 基準清單 → `bin/yt-dlp.exe` 404 → `E_HTTP`).
- 主幹模式依 wsemi 1.9.27 之限制:離線不取主幹清單,只用基準清單;鏡像 `manifest-last.json` 退路與雜湊不符重取主幹清單待 wsemi-run05.
- 舊版套件(≤1.0.51)在無 `yt-dlp.exe` 時依 `yt-dlp/manifest.json`(或 `yt-dlp/yt-dlp.exe`)自 master 取,master 移除 `yt-dlp/` 後得 404(明確錯誤);既有 `yt-dlp.exe` 之舊安裝不受影響.
- 行程被強制結束時 `bin-cache/<sha256>/` 內暫存檔之清理由 wsemi 處理;`os.tmpdir()/w-dwload-dlp/` 內之工作夾殘留則由之後任一次呼叫刪除逾 24 小時者(規則 R3).
- 單一呼叫持續逾 24 小時(如錄製直播)者,其工作夾於他呼叫開始時會被視為殘留而嘗試刪除(殘留判定只看工作夾本身之修改時間);本套件定位為下載檔案,不支援,README 已載明.- Node 24.22.1 之 undici 缺陷(與本套件程式無關):伺服端回應後關閉連線(`Connection: close`)且用戶端因背壓暫停讀取時,於 `Parser.finish` 拋未捕捉之 `AssertionError(assert(!this.paused))` 使行程結束;GitHub raw 為 keep-alive 故未見;測試夾具刻意不設 `Connection: close`.
