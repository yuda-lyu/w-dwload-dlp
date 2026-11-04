# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R1 外部執行檔一律依制式規格,經 `ensureBins`(wsemi `fsEnsureBins`)取得

- **規格**:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`(制式規格;本套件為 A 類、**主幹模式**,登記於主控帳本 G10;wsemi `fsEnsureBins` 為共用實作).本節只摘要,細節以該檔為準.
- **規則**:
  1. 外部執行檔(`yt-dlp.exe`)放自家 repo 之 `bin/`,納入 git,**不入 npm 包**(`.npmignore`:首段完整抄錄 `.gitignore`〔含 `/bin-cache/`、`test/_tmp`〕,其後第 1 條排除項 `/bin/*`、`!/bin/manifest.json`,依 dspec〈自有套件之npm發布範圍〉原則 3);快取 `bin-cache/` 不入版控與 npm 包;`.gitattributes` 設 `bin/** binary`.
  2. 清單 `bin/manifest.json`(制式 schema 1,`mode: "floating"`,不帶 `commit`,`version` 為 yt-dlp 版本)由 `toolg/genBinManifest.mjs` 依 `bin/` 實檔產生,**不手寫**.
  3. 套件端只做三件事:提供清單、經 `src/ensureBins.mjs` 轉呼叫 wsemi `fsEnsureBins` 取得路徑後啟動、匯出 `ensureBins`(主檔為 default 匯出,故掛為靜態屬性 `WDwloadDlp.ensureBins`,不加具名匯出);**不得自寫下載、快取、校驗、鏡像**,不得 `postinstall` 下載;不轉傳使用者之 `floatingManifestUrl`.
  4. `ffmpeg.exe` 屬 `w-ffmpeg`,一律經 `WFfmpeg.ensureBins({ names: 'ffmpeg.exe' })` 取得(**不可**把 `w-ffmpeg/src/ensureBins.mjs` 打包進本套件 UMD:其套件根會指到本套件;故 `w-ffmpeg` 列 rollup external).
  5. 環境變數 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE` 由 `fsEnsureBins` 統一讀取;README〈外部執行檔〉說明用法與離線部署.
  6. npm 包檢查(dspec〈自有套件之npm發布範圍〉原則 1、4,原則 2〈套件測試之 npm 包檢查〉,2026-11-02 使用者裁示 A):①「不得入包」只列外部執行檔與壓縮檔(`.exe .dll .node .msi .zip .7z .gz .tgz` 與分片 `.NNN`)、`bin/` 除 `manifest.json` 外之檔、`CLAUDE*.md`、`tmp/`、`test/_tmp/`、`.env`;②`sgud/`、`docs/`、`test/`、`toolg/`、`script.txt` 等 git 版控內容隨包,**測試不得斷言其不在**,反須斷言 `sgud/`(至少 `sgud/state/state.md`)與 `test/tools/` 隨包.本套件原無大小上限斷言;若要加,只計 `src/`、`dist/`、`bin/`(現值總和 357159 位元組、最大單檔 193265).
- **盤點指令**:`node C:/opensrcOper/tools/scan-bins.mjs --only w-dwload-dlp`(應為 OK);`npm pack --dry-run`(`bin/` 只有 `bin/manifest.json`,`sgud/` 3 檔隨包).
- **站點全集**(2026-11-04 wd72 後):取得 `yt-dlp.exe` 之站點 2 處(`src/WDwloadDlp.mjs` 之 `WDwloadDlp` 與 `dwloadSubtitle`,皆經 `ensureBins`)＋對外 `ensureBins` 2 條路徑(`WDwloadDlp.ensureBins`、深層匯入 `src/ensureBins.mjs`);取得 `ffmpeg.exe` 之站點 1 處(`WFfmpeg.ensureBins`,只在 `WDwloadDlp`,`dwloadSubtitle` 不取);啟動外部程式之站點 2 處(`dwloadInWork` 與 `runDlp` 之 `execProcess(fpExeDlp, …)`,`runDlp` 於 `dwloadSubtitle` 內呼叫 2 次);全已套.
- **把關測試**:`test/unit-binManifest.test.mjs`(M1/M2/M4/T1/T2:清單形態、與 `bin/` 實檔一致、版本與 `yt-dlp.exe --version` 一致、清單即工具所產、含誘餌檔之 `npm pack`〔①不得入包、②`sgud/` 與 `test/tools/` 隨包,各一案〕、`.gitignore`/`.gitattributes`、src 無自寫下載、無 postinstall、相依版本、rollup external、主檔匯出形態、README 節);`test/api-ensureBins.test.mjs`(T3~T8:本機 HTTP 伺服器扮 GitHub 原始檔、本地資料夾扮鏡像與快取;主函數類入口攔截全域 `fetch` 並攔截 `child_process.spawn` 斷言啟動者為 `ensureBins` 回傳之路徑、套件根與 cwd 無關、不轉傳 `floatingManifestUrl`).功能測試 `test/dw_mp4.test.mjs`、`dw_m3u8.test.mjs` 以本機鏡像(`test/tools/dwMirror.mjs`)供 `yt-dlp.exe`,實際連 YouTube.
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-binManifest.test.mjs test/api-ensureBins.test.mjs --timeout 180000`(約 10 秒).

## R2 換 `bin/yt-dlp.exe` 必同步重產 `bin/manifest.json`,兩者同一提交推 GitHub master

- **規則**(規格 U2,主幹模式):替換 `bin/yt-dlp.exe` 後執行 `node toolg/genBinManifest.mjs` 重產清單(sha256、size 取自實檔,`version` 取自 `bin/yt-dlp.exe --version`),跑 `npm test`,exe 與清單**同一提交**推 GitHub master 即對所有消費端生效(不須發布 npm);npm 包內之基準清單於下次發布時更新.
- **為何**:消費端連網呼叫時取 master 之 `bin/manifest.json` 為準,再自 master 取 `bin/yt-dlp.exe` 以該清單校驗;清單與檔案不一致即 `E_HASH_MISMATCH`(失敗安全,不留檔),套件實質無法取得新版.
- **把關測試**:`test/unit-binManifest.test.mjs` 之「match the real files in bin/」「record in the manifest the version that bin/yt-dlp.exe reports」「exactly what toolg/genBinManifest.mjs generates」;失敗即表示漏重產.
- **站點全集**:清單 1 份 × 一致性來源 3 項(`yt-dlp.exe` 大小、SHA-256、`--version`),皆已套.主控工具 `update-ytdlp.mjs` 須改為此流程(見報告).

## R3 執行期資料交換檔不寫執行檔所在夾,且每次呼叫用自己之工作夾(併行呼叫互不影響)

- **規則**:
  1. 執行檔位於內容定址之快取夾(由清單校驗、可能共用或唯讀),故資料交換檔寫 `os.tmpdir()` 下,不寫執行檔所在夾;不 `process.chdir`(全程序狀態,併發呼叫互相干擾).
  2. **每次呼叫 `WDwloadDlp`(與 `dwloadSubtitle`,見 R4)用自己之工作夾**——兩入口共用 `runInWork(fun)`,建名、刪除、殘留清理只在其內——`os.tmpdir()/w-dwload-dlp/<now2strp()>-<genID(6)>/`(`mkIdWork`),下載、合併、轉檔之中介檔皆在其內;`finally` 以 `fsDeleteFolderSafe` 整夾刪除(成功與失敗皆然;暫時被占用時重試,仍刪不掉則忽略,不得蓋過本次結果);結果檔複製到呼叫端之 `fp`(語意不變).夾由 yt-dlp 寫檔時自動建立,不另建.
  3. **不得有跨呼叫共用之暫存夾,不得有「預先清除」之選項**:`opt.clean` 已移除(不留別名;共用夾加預先清除會讓併行呼叫清掉對方下載中之檔,主控全套曾因此 `[outputNotFound]`).
  4. **殘留清理**:崩潰或被強制結束時工作夾會殘留;每次呼叫開始時(`ensureBins` 成功後、建名之前)刪除 `w-dwload-dlp/` 下**名稱符合 `reWork`、為資料夾(不跟進連結)、修改時間逾 `msStaleWork`(24 小時,單一常數,理由寫在常數旁)** 者;fdRoot 不存在、他行程同時在刪、刪不掉皆忽略.其他名稱之資料夾與檔案一律不動.
- **盤點指令**:`Grep "chdir|Downloads|opt\.clean|'clean'|fsCleanFolder" src/`(應無);`Grep "mkIdWork\(\)|fsDeleteFolderSafe\(|cleanStaleWork\(" src/WDwloadDlp.mjs`(建立 1 處、刪除 1 處、殘留清理 1 處,皆在 `runInWork`;另有函式定義各 1 處).
- **站點全集**:工作夾建名 1 處(`runInWork` 之 `fdWork`)、刪除 1 處(同函式 `finally`)、殘留清理 1 處(`cleanStaleWork`),已套,`WDwloadDlp` 與 `dwloadSubtitle` 皆經 `runInWork`;24 小時常數 1 處.
- **把關測試**:`test/api-workFolder.test.mjs`(假 yt-dlp 起真子行程、`TEMP`/`TMP` 導到 `test/_tmp/workFolder/tmp`,不連網:兩併行呼叫之工作夾互不相同且各自刪除、先結束者不動後結束者下載中之檔、yt-dlp 失敗/無輸出檔/複製失敗皆刪夾、`exeNotReady`/`invalidUrl` 不建夾、殘留夾 25h 刪/23h 留/不符命名不動/同名檔案不動、`clean` 無作用、刪除失敗忽略並由之後呼叫清);`test/unit-workFolder.test.mjs`(src 無 `clean`/`Downloads`/`fsCleanFolder`、24 小時常數單一、README 與功能測試不含 `clean`);`test/api-ensureBins.test.mjs` 之主函數案(`-o` 路徑在 `os.tmpdir()` 下、結束後工作夾已刪、cwd 不變);共用夾具 `test/tools/fakeRun.mjs`(攔截 `fetch`、`spawn`、假 `WFfmpeg.ensureBins`)與 `test/tools/fakeDlp.mjs`(模式由 url 末段決定:`fail`/`nofile`/其餘;`FAKE_DLP_GATE` 閘門令併行呼叫確定同時在跑).
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/api-workFolder.test.mjs test/unit-workFolder.test.mjs test/api-ensureBins.test.mjs --timeout 180000`(約 15 秒).

## R4 字幕由 yt-dlp 下載,套件只挑軌與解析(`WDwloadDlp.dwloadSubtitle`,2026-11-04 wd72,Gitea #72)

- **規則**:
  1. 字幕一律由 yt-dlp 下載(第 2 次呼叫 `--load-info-json`),**套件不自行連網**(R1;`src/` 不得出現 `fetch(`,`unit-binManifest` 之掃描涵蓋 `src/*.mjs`).不取 `ffmpeg.exe`.
  2. 字幕軌限 json3:無 json3 者於 `pickSubTrack` 排除(含 `live_chat`,其 ext 為 json).yt-dlp 遇無 json3 者**不報錯**而改下載 vtt 並以離開碼 0 結束(2026.10.26 實測,`jfXg5ZslKg4` 之自動軌 `zh-Hant`),故輸出檔須以 `.json3` 檢查,缺則 `[outputNotFound]`,不得當成功.
  3. 挑軌(`src/pickSubTrack.mjs`):任何語言之手動字幕優先於自動字幕;依 `opt.langs`(預設 `['zh-TW','zh-Hant','zh','en']`,README 明載)大小寫不分,先完全相同再語言前綴;自動軌先取非機器翻譯者(原文軌 `-orig` 與原文語言本身),只有機器翻譯相符時才取並回傳 `translated: true`;皆不符取原文軌,無原文軌取第 1 筆.`name` 取自 json3 該筆(自動軌第 1 筆格式常為無 `name` 之 vtt).語言代碼須符 `^[A-Za-z0-9][A-Za-z0-9_-]*$` 才列入(作為 `--sub-langs` 之值時 yt-dlp 視為正規式、`-` 開頭者為排除,且為輸出檔名之一部分).
  4. 解析(`src/parseSubJson3.mjs`):略過無 `segs` 與僅空白之 event;`txt` 連續空白(含換行)合併為單一空格;`tStartMs` 缺漏、負數、非數字時沿用前一段落之 `tMs`(首段 0),數字字串視為數字;**不去除連續相同之行**(`plainText` 一段一行,與 `segments` 一一對應);內容損壞或無文字回空陣列,由入口轉 `[invalidOutput]`.
  5. 工作夾依 R3(`runInWork`,與 `WDwloadDlp` 共用);主檔只有 default 匯出,以靜態屬性 `WDwloadDlp.dwloadSubtitle` 提供(R1).
  6. 第 1 次呼叫 `--flat-playlist --playlist-items 1`:播放清單與頻道頁不逐一解析清單內之影片(實測不加 `--flat-playlist` 會逐一解析),且只列舉第 1 項(項目多之頻道仍須逐頁列舉全部才得知是清單);`_type` 非 `video`(`playlist`、`multi_video`)回 `[invalidUrl]`.
  7. reject 一律為字串,首行 `[代碼] …`(V16);讀不到或損壞之輸出檔轉 `[invalidOutput]`,不得拋出 Error 物件;非字串或空白之 url 回 `[invalidUrl]`(只收原始字串,dspec S1),檢測先於副作用(V17).
  8. 429:維持 `[httpError]` 且訊息含原文,不重試、不另立分類;不設整體逾時(與 `WDwloadDlp` 一致).
- **盤點指令**:`Grep "fetch\s*\(|WFfmpeg" src/WDwloadDlp.mjs`(`WFfmpeg` 只在 `WDwloadDlp` 內,`dwloadSubtitle` 不得出現);`Grep "'--', url" src/WDwloadDlp.mjs`(2 處:`dwloadInWork`、`dwloadSubtitleInWork` 第 1 次,見 R5).
- **站點全集**:啟動 yt-dlp 之字幕站點 `runDlp` 1 處(2 次呼叫:資訊、字幕);工作夾建名、刪除、殘留清理仍各 1 處(`runInWork`);opt 解析 `parseLangs` 1 處(手寫,見已知限制).
- **把關測試**:`test/unit-subtitle.test.mjs`(挑軌、解析、匯出)、`test/api-dwloadSubtitle.test.mjs`(假 yt-dlp `test/tools/fakeDlpSub.mjs` 起真子行程,不連網:引數、錯誤分類、檔案缺漏/損壞/讀不到、工作夾、殘留清理、併行、opt 檢測、url 檢測)、`test/api-optionInjection.test.mjs`(真 yt-dlp.exe,不連外網)、`test/dw_subtitle.test.mjs`(真 YouTube/jsdelivr;預期值由 oracle——直接以 yt-dlp 取同一影片之資訊——導出,不寫死特定軌;限流〔`[httpError]` 且含 `HTTP Error 429`〕標 pending,其餘錯誤照常失敗;影片已變動時以 `[fixture changed upstream]` 失敗,別於函數缺陷).
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-subtitle.test.mjs test/api-dwloadSubtitle.test.mjs test/api-optionInjection.test.mjs --timeout 180000`(約 15 秒);真實網路 `node node_modules/mocha/bin/mocha.js --no-parallel test/dw_subtitle.test.mjs --timeout 180000`(約 1.5 分).

## R5 url 一律置於 yt-dlp 引數 `--` 之後(防選項注入;資安)

- **規則**:交給 yt-dlp 的 `url` 必在 `--` 之後且為最後一個引數(`WDwloadDlp` 之 `dwloadInWork` 與 `dwloadSubtitle` 之第 1 次呼叫).`url` 以 `-` 開頭(如 `--version`、`--exec=…`)時不得被 yt-dlp 當成選項;yt-dlp 視之為網址而回 `[dlpFailed] … is not a valid URL`.修前 `WDwloadDlp('--version', fp)` 令 yt-dlp 印版本並以離開碼 0 結束,回 `[outputNotFound]`(2026-11-04 重現;證據見 wd72 報告).呼叫端若把未經驗證之字串當 `url`,可帶入任意 yt-dlp 選項.
- **盤點指令**:`Grep "execProcess\(" src/WDwloadDlp.mjs`(應 2 處:`dwloadInWork`、`runDlp`;`runDlp` 之引數由 `dwloadSubtitleInWork` 組成,url 只出現在第 1 次呼叫且前有 `'--'`;第 2 次呼叫用 `--load-info-json`,不帶 url).
- **站點全集**:帶 url 之 yt-dlp 呼叫 2 處(`dwloadInWork`、`dwloadSubtitleInWork` 第 1 次),已套;其餘 `execProcess` 呼叫不含使用者字串(`runDlp` 第 2 次之 `--sub-langs` 值取自 yt-dlp 所回之語言代碼,且經格式篩選,見 R4-3).
- **把關測試**:`test/api-optionInjection.test.mjs`(真 yt-dlp.exe:`--version`、`--help` 於兩入口皆回 `[dlpFailed]`…`is not a valid URL`,不連外網);`test/api-dwloadSubtitle.test.mjs`(引數末二項為 `['--', url]`)、`test/api-workFolder.test.mjs` 與 `test/api-ensureBins.test.mjs`(經 `test/tools/fakeDlp.mjs`,該假 yt-dlp 要求 url 為 `--` 之後唯一引數,否則離開碼 2).
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/api-optionInjection.test.mjs test/api-workFolder.test.mjs test/api-ensureBins.test.mjs --timeout 180000`(約 20 秒).

## 破壞性變更紀錄(依自有套件原則:不留舊版相容層)

- 移除 `src/autoDownloadFiles.mjs`、`downloadFiles.mjs`、`ensureDlpExe.mjs`、`parseDlpManifest.mjs`、`scripts/install.mjs`(postinstall)、`toolg/genManifest.mjs`、`yt-dlp/` 目錄(`manifest.json` 舊單檔格式、`yt-dlp-ver.txt`、`yt-dlp.exe`);`yt-dlp.exe` 改在 `bin/`;下載暫存夾改 `os.tmpdir()`;見 README〈Breaking changes〉.
- 移除 `opt.clean`、下載暫存夾改為每次呼叫專用之 `os.tmpdir()/w-dwload-dlp/<id>/`(結束刪除,逾 24 小時殘留自動清除);見 R3、README〈Breaking changes〉.
- `WDwloadDlp` 之 `url` 改置於 yt-dlp 引數 `--` 之後(2026-11-04,wd72):以 `-` 開頭之 `url` 不再被當成選項;見 R5、README〈Breaking changes〉.

## 已知限制

- 單一呼叫持續超過 24 小時(如錄製直播)者,其工作夾於他呼叫開始時會被視為殘留而嘗試刪除(殘留判定只看工作夾本身之修改時間);本套件定位為下載檔案,不支援此用法,README 已載明.

- 兩入口皆不設整體逾時(`dwloadSubtitle` 依主控裁示與 `WDwloadDlp` 一致,不加 `opt.timeout`).2026-11-04 實測(本機伺服器 127.0.0.1,見 wd72 報告):對方接受連線但不回應時,yt-dlp 於約 23 秒以 `Read timed out (read timeout=20.0)` 失敗;對方持續少量送出資料(每 3 秒 1 位元組、標頭永不結束)時,80 秒後仍不結束(per-read 逾時不觸發),**可能無限等待**.wsemi `execProcess` 已有 `opt.timeout`(逾時殺行程樹),日後要加時只需轉傳;呼叫端現可自行以逾時包裝(行程會繼續,工作夾於結束或下次呼叫逾 24 小時時清除).
- `parseLangs`(`opt.langs` 之檢測)為手寫:dspec〈輸入參數之檢測機制〉K1 要求由 wsemi 共用檢測函數宣告種類,但 wsemi 現無公開之「字串或字串陣列」種類函數;日後有對應函數時改用.
- 429 不重試(主控裁示):`dwloadSubtitle` 遇 YouTube 限流回 `[httpError]` 含原文,連續呼叫(尤其機器翻譯軌)易觸發;功能測試遇之標 pending.
- 主幹模式依 wsemi 1.9.27:離線時不取主幹清單,只用 npm 包內之基準清單,故離線部署之鏡像/快取須含基準清單所載版本;鏡像內之 `manifest-last.json` 退路、雜湊不符重取主幹清單,待 wsemi-run05.
- 主幹清單與 `yt-dlp.exe` 之信任錨為 GitHub master(已接受之風險,使用者 2026-10-27 裁定採 B).
