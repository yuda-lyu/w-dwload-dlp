# w-dwload-dlp 狀態

## 外部執行檔(2026-10-29 起依制式規格,主幹模式)

規格:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`;本套件為 A 類、主幹模式(主控帳本 G10 登記).規則見 `sgud/rule/rulebook.md` R1~R3.

| 項目 | 現況 |
|---|---|
| `bin/yt-dlp.exe` | yt-dlp stable **2026.10.26**(brotli **1.2.1**),入 git、**不入 npm 包** |
| `bin/manifest.json` | 制式清單 schema 1:`mode: "floating"`、`repo: yuda-lyu/w-dwload-dlp`、不帶 `commit`、`version`(yt-dlp 版本,取自 `bin/yt-dlp.exe --version`)、`files: [{ name, path, sha256, size }]`;由 `toolg/genBinManifest.mjs` 產生;入 git 且入 npm 包(取不到主幹清單時之基準清單) |
| `src/ensureBins.mjs` | 轉呼叫 wsemi `fsEnsureBins('bin/manifest.json', { …opt, pkgRoot })`;`pkgRoot` 以本檔位置推得(`src/`、`dist/` 皆為套件根下一層);不轉傳 `floatingManifestUrl` |
| `src/WDwloadDlp.mjs` | `await ensureBins({ names: 'yt-dlp.exe' })` 取 yt-dlp.exe、`await WFfmpeg.ensureBins({ names: 'ffmpeg.exe' })` 取 ffmpeg.exe(`import WFfmpeg from 'w-ffmpeg'`,rollup external);失敗以字串 reject `[exeNotReady] …\n<錯誤碼> <說明>`;`WDwloadDlp.ensureBins = ensureBins`(靜態屬性,主檔只有 default 匯出);不再 `process.chdir` |
| 工作夾(2026-10-29,bin-dlp2;規則 R3) | **每次呼叫用自己之工作夾** `os.tmpdir()/w-dwload-dlp/<now2strp()>-<genID(6)>/`(下載、合併、轉檔之中介檔皆在其內,夾由 yt-dlp 自動建立),`finally` 以 `fsDeleteFolderSafe` 整夾刪除(成功與失敗皆然,被占用重試,失敗忽略);結果檔仍複製到呼叫端之 `fp`;**`opt.clean` 已移除**(不留別名);每次呼叫在 `ensureBins` 成功後先刪 `w-dwload-dlp/` 下命名符合 `reWork`、為資料夾、修改時間逾 `msStaleWork`(24 小時,單一常數)者(失敗忽略);主函數拆為 `WDwloadDlp`(前置檢查、取執行檔)、`runInWork`(工作夾生命週期,2026-11-04 起與 `dwloadSubtitle` 共用)與 `dwloadInWork`(於工作夾內下載並交付) |
| 取得順序 | 快取(`bin-cache/<sha256>/yt-dlp.exe` 或 `W_BIN_CACHE`)→ 鏡像(`W_BIN_MIRROR`)→ GitHub master(`https://raw.githubusercontent.com/yuda-lyu/w-dwload-dlp/master/bin/yt-dlp.exe`);連網呼叫先取 master 之 `bin/manifest.json`(取不到/無效 → 基準清單),離線不取主幹清單;任何來源皆以清單校驗 |
| 忽略規則 | `.npmignore`(2026-11-02 依 dspec〈自有套件之npm發布範圍〉原則 3 重排):首段完整抄錄 `.gitignore`(含 `test/_tmp`、`/bin-cache/`),其後只有第 1 條排除項 `/bin/*`、`!/bin/manifest.json`;`sgud/`、`docs/`、`test/`、`toolg/` 隨包(`npm pack --dry-run` 75 檔,其中 `sgud/` 3 檔);`.gitignore`:`/bin-cache/`;`.gitattributes`:`bin/** binary` |
| rollup UMD | `toolg/gDistRollup.mjs` external／globals 含 `os`、`url`、`crypto`、`stream`、`stream/promises`、`w-ffmpeg`(2026-10-29 暫存夾實建一次,`dist` 內無 `import.meta`,`require("w-ffmpeg")`,`ensureBins` 靜態屬性可用,套件根為 `dist/` 之上一層) |
| 相依 | `wsemi` ^1.9.27、`w-ffmpeg` ^1.0.29;無 `postinstall` |
| 已移除 | `src/autoDownloadFiles.mjs`、`downloadFiles.mjs`、`ensureDlpExe.mjs`、`parseDlpManifest.mjs`、`scripts/install.mjs`、`toolg/genManifest.mjs`、`yt-dlp/` 目錄、`test/tools/dlpServer.mjs` 及其三支測試(`unit-downloadFiles`、`unit-ensureDlpExe`、`unit-dlpManifest`;下載核心之測試已在 wsemi) |

## 下載字幕與 url 隔開(2026-11-04,wd72,Gitea #72;規則 R4、R5)

| 項目 | 現況 |
|---|---|
| `WDwloadDlp.dwloadSubtitle(url, opt)` | 已做:靜態屬性(主檔仍只有 default 匯出);只取 `yt-dlp.exe`、不取 `ffmpeg.exe`、套件不自行連網;第 1 次 `--write-info-json --flat-playlist --playlist-items 1 -- <url>` 取影片資訊,第 2 次 `--load-info-json`＋`--write-subs`／`--write-auto-subs`＋`--sub-langs <軌>`＋`--sub-format json3` 下載所挑之軌;工作夾與殘留清理與 `WDwloadDlp` 共用 `runInWork`;resolve 結構化資料(`segments`、`plainText`、`timestampedText` 等),reject 為字串首行 `[代碼] …`;`opt.langs` 預設 `['zh-TW','zh-Hant','zh','en']`(README 明載)、`opt.debug`／`opt.funLog` |
| `src/pickSubTrack.mjs`、`src/parseSubJson3.mjs` | 已做:挑軌(手動優先、依 langs、自動軌先取非機器翻譯者、語言代碼格式篩選)與 json3 解析(缺漏/損壞容錯、不去重) |
| url 隔開 `--`(選項注入修正,資安) | 已做:`WDwloadDlp`(`dwloadInWork`)與 `dwloadSubtitle` 之 url 皆在 `--` 之後;修前 `WDwloadDlp('--version', fp)` 回 `[outputNotFound]`,修後 `[dlpFailed] … is not a valid URL` |
| 429／逾時 | 429 不重試不另立分類(主控裁示);不設整體逾時(與主函數一致),yt-dlp 對持續少量送資料之連線不逾時,見規則帳本已知限制 |
| 待辦／缺口 | `parseLangs` 手寫,wsemi 有對應公開檢測函數時改用;純自動且無原文軌之影片、會員/年齡限制影片未實測;`live_chat` 僅以假資料與直播中影片之 `--list-subs` 驗證 |

## 測試

| 檔 | 內容 |
|---|---|
| `test/unit-subtitle.test.mjs` | R4:`pickSubTrack`(手動優先、langs 順序、大小寫、前綴邊界、機器翻譯、原文軌、json3 限定、代碼格式篩選、任意形狀 info 回 null)、`parseSubJson3`(時戳邊界、空白合併、缺漏/非預期項目、損壞/截斷、不去重、不重排)、匯出 |
| `test/api-dwloadSubtitle.test.mjs`、`test/tools/fakeDlpSub.mjs` | R4:假 yt-dlp 起真子行程、不連網:欄位、引數(兩次呼叫共用工作夾、`--`、`--playlist-items 1`)、dash 開頭 url、不取 ffmpeg 不連網、自動軌與 translated、langs(陣列/字串/大小寫/空白)、opt 檢測(K3/V9/V11/debug 警告一次不回顯)、noSubtitle(無字幕/僅 vtt/僅 live_chat)、playlist/multi_video、yt-dlp 失敗分類(含 429 不重試)、outputNotFound(含靜默改下載 vtt)、invalidOutput(含檔案讀不到)、工作夾於成功與各失敗路徑皆刪、併行、殘留 25h 刪/23h 留、重複行保留、奇異 event、url 檢測(非字串/空白/包裝字串/空字元)、exeNotReady、osNotSupported |
| `test/api-optionInjection.test.mjs` | R5:真 yt-dlp.exe(本機鏡像)、不連外網:`--version`、`--help` 於兩入口皆回 `[dlpFailed]`…`is not a valid URL` |
| `test/dw_subtitle.test.mjs` | R4:真 YouTube/jsdelivr 功能測試:預期值由 oracle 導出;限流(`[httpError]`＋`HTTP Error 429`)標 pending;手動軌、短網址與帶 list 參數、原文自動軌、機器翻譯軌、m3u8 noSubtitle、頻道頁 invalidUrl、不存在影片 unavailable、本次工作夾已刪 |
| `test/unit-binManifest.test.mjs` | 清單形態、與 `bin/` 實檔一致、版本與 `yt-dlp.exe --version` 一致、清單即 `genBinManifest` 所產、README 節、`.gitignore`／`.gitattributes`、T1(含誘餌檔之 `npm pack`:①不得入包只列外部執行檔與壓縮檔、`bin/` 除清單外、`CLAUDE*.md`、`tmp/`、`test/_tmp/`、`.env`;②`sgud/` 與 `test/tools/` 隨包;2026-11-02 依 dspec 原則 2〈套件測試之 npm 包檢查〉)、src 無自寫下載、無 postinstall、相依版本、rollup external、主檔匯出形態 |
| `test/api-ensureBins.test.mjs` | T3~T8(本機 HTTP 伺服器扮 `raw.githubusercontent.com`、本地資料夾扮鏡像與快取,不連外網)、環境變數、套件根與 cwd 無關(子行程 `test/tools/ensureBinsChild.mjs`)、不轉傳 `floatingManifestUrl`;主函數類入口(攔截全域 `fetch`、攔截 `child_process.spawn` 改跑假 yt-dlp `test/tools/fakeDlp.mjs`、以假檔取代 `WFfmpeg.ensureBins`) |
| `test/api-workFolder.test.mjs` | 規則 R3(假 yt-dlp 起真子行程、`TEMP`/`TMP` 導向 `test/_tmp/workFolder/tmp`,不連外網):兩併行呼叫之工作夾互不相同且先結束者不動後結束者下載中之檔、yt-dlp 失敗／無輸出檔／複製失敗皆刪夾、早退(`invalidUrl`／`exeNotReady`)不建夾、殘留夾 25h 刪／23h 留／命名不符與同名檔案不動、`clean` 無作用、刪除失敗忽略並由之後呼叫清、被占用(EBUSY)重試 |
| `test/unit-workFolder.test.mjs` | src 無 `clean`／`Downloads`／`fsCleanFolder`、24 小時常數單一、README 與功能測試不含 `clean` 選項 |
| `test/tools/fakeRun.mjs`、`test/tools/fakeDlp.mjs` | 主函數類測試共用夾具:攔截全域 `fetch` 與 `child_process.spawn`、假 `WFfmpeg.ensureBins`;假 yt-dlp 依 url(須為 `--` 之後唯一引數,否則離開碼 2)末段分 `fail`／`nofile`／正常,`FAKE_DLP_GATE` 為閘門令併行呼叫確定同時在跑;引數含 `--write-info-json`／`--load-info-json` 者交 `fakeDlpSub.mjs` |
| `test/unit-parseDlpError.test.mjs` | yt-dlp 錯誤分類(未動) |
| `test/dw_mp4.test.mjs`、`test/dw_m3u8.test.mjs` | 功能測試,實際連 YouTube／jsdelivr 下載;`yt-dlp.exe` 以本機鏡像供檔(`test/tools/dwMirror.mjs`),`ffmpeg.exe` 由 w-ffmpeg 自行取得(連 GitHub) |

最近一次驗證(2026-11-04,wd72 輪):全套 `npm test`(`quiet-run --lock`)**139 passing、1 pending、0 failing**(修前基準 76 passing;pending 為 `dw_subtitle` 機器翻譯軌遇 YouTube 429,屬外部限流);新測試修前紅(新入口 25＋選項注入 2＋經嚴格假 yt-dlp 之主函數類 9 案紅、`unit-subtitle` 載入失敗);變異 71 項(挑軌 18、解析 13、子行程引數與流程 33、工作夾 4、主函數 `--` 3)首輪 70 被抓、1 存活(`opt` 被改寫之斷言不足)→補斷言後 71/71;eslint `src`／`test` 0 error;UMD 於暫存夾實建(`dwloadSubtitle` 為函數、`dist` 無 `import.meta`、與 src 實跑結果逐欄相同);報告 `C:\opensrcOper\dnow\20261104203926\agent-out\wd72-修正報告.md`.
先前驗證(2026-11-02,pk-dwload-dlp 輪):全套 `npm test` **76 passing、0 failing**(修前 74 passing、1 failing——`sgud/` 不得入包之舊斷言紅;`unit-binManifest` 內 npm 包檢查一案拆為兩案);npm 包檢查變異 6 項(`src/`／`dist/` 放假 `.exe`／`.dll`／`.tgz`、`.npmignore` 排除 `sgud`、排除 `test/tools`、拿掉 `/bin/*`、拿掉 `CLAUDE*.md`、拿掉 `test/_tmp`)全被抓.
先前驗證(2026-10-29,bin-dlp2 輪):全套 `npm test`(`mocha --parallel`)**75 passing、0 failing**,同一次測試鎖內連跑 3 次皆綠(每次約 14 秒;`dw_mp4`、`dw_m3u8` 併行實際下載皆成功);舊碼(bin-dlp 輪之共用 `Downloads` 夾加 `clean`)配最終版測試 11 案紅;工作夾變異 20 項:19 被抓、1 存活(m06 為等價變異——`fsDeleteFolder` 自身拒刪非資料夾,以 m19 直接 `rmSync` 之變異證實「命名相符之檔案不刪」之斷言有效);L0 lint 0 error、UMD 於暫存夾實建可載入且 `ensureBins` 靜態屬性在.
bin-dlp 輪(2026-10-29)之結果:舊碼(HEAD)配新測試 14 案紅、變異 28 項全被抓;`node C:/opensrcOper/tools/scan-bins.mjs --only w-dwload-dlp` 為 OK;`npm pack --dry-run` 之 `bin/` 只有 `manifest.json`(該部分本輪未動).

## 更新 yt-dlp.exe

見 `yt-dlp.md`:替換 `bin/yt-dlp.exe` → `node toolg/genBinManifest.mjs` → `npm test` → exe 與清單同一提交推 GitHub master.管控端 `update-ytdlp.mjs`／`watch-ytdlp.mjs` 之路徑須改(見 2026-10-29 bin-dlp 報告).

## 已知缺口與待辦

- **含本次改造之 npm 版本發布前,`bin/yt-dlp.exe`、`bin/manifest.json`、`.gitattributes` 須已推上 GitHub master**,否則新版安裝取不到 `bin/yt-dlp.exe`(主幹清單 404 → 基準清單 → `bin/yt-dlp.exe` 404 → `E_HTTP`).
- 主幹模式依 wsemi 1.9.27 之限制:離線不取主幹清單,只用基準清單;鏡像 `manifest-last.json` 退路與雜湊不符重取主幹清單待 wsemi-run05.
- 舊版套件(≤1.0.51)在無 `yt-dlp.exe` 時依 `yt-dlp/manifest.json`(或 `yt-dlp/yt-dlp.exe`)自 master 取,master 移除 `yt-dlp/` 後得 404(明確錯誤);既有 `yt-dlp.exe` 之舊安裝不受影響.
- 行程被強制結束時 `bin-cache/<sha256>/` 內暫存檔之清理由 wsemi 處理;`os.tmpdir()/w-dwload-dlp/` 內之工作夾殘留則由之後任一次呼叫刪除逾 24 小時者(規則 R3).
- 單一呼叫持續逾 24 小時(如錄製直播)者,其工作夾於他呼叫開始時會被視為殘留而嘗試刪除(殘留判定只看工作夾本身之修改時間);本套件定位為下載檔案,不支援,README 已載明.- Node 24.22.1 之 undici 缺陷(與本套件程式無關):伺服端回應後關閉連線(`Connection: close`)且用戶端因背壓暫停讀取時,於 `Parser.finish` 拋未捕捉之 `AssertionError(assert(!this.paused))` 使行程結束;GitHub raw 為 keep-alive 故未見;測試夾具刻意不設 `Connection: close`.
