# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R1 外部執行檔一律依制式規格,經 `ensureBins`(wsemi `fsEnsureBins`)取得

- **規格**:主控規格〈外部執行檔之存放下載校驗與離線〉(制式規格;本套件為 A 類、**主幹模式**,登記於主控帳本 G10;wsemi `fsEnsureBins` 為共用實作).本節只摘要,細節以該檔為準.
- **規則**:
  1. 外部執行檔(`yt-dlp.exe`)放自家 repo 之 `bin/`,納入 git,**不入 npm 包**(`.npmignore`:首段完整抄錄 `.gitignore`〔含 `/bin-cache/`、`test/_tmp`〕,其後第 1 條排除項 `/bin/*`、`!/bin/manifest.json`,依 dspec〈自有套件之npm發布範圍〉原則 3);快取 `bin-cache/` 不入版控與 npm 包;`.gitattributes` 設 `bin/** binary`.
  2. 清單 `bin/manifest.json`(制式 schema 1,`mode: "floating"`,不帶 `commit`,`version` 為 yt-dlp 版本)由 `toolg/genBinManifest.mjs` 依 `bin/` 實檔產生,**不手寫**.
  3. 套件端只做三件事:提供清單、經 `src/ensureBins.mjs` 轉呼叫 wsemi `fsEnsureBins` 取得路徑後啟動、匯出 `ensureBins`(主檔為 default 匯出,故掛為靜態屬性 `WDwloadDlp.ensureBins`,不加具名匯出);**不得自寫下載、快取、校驗、鏡像**,不得 `postinstall` 下載;不轉傳使用者之 `floatingManifestUrl`.
  4. `ffmpeg.exe` 屬 `w-ffmpeg`,一律經 `WFfmpeg.ensureBins({ names: 'ffmpeg.exe' })` 取得(**不可**把 `w-ffmpeg/src/ensureBins.mjs` 打包進本套件 UMD:其套件根會指到本套件;故 `w-ffmpeg` 列 rollup external).
  5. 環境變數 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE` 由 `fsEnsureBins` 統一讀取;README〈外部執行檔〉說明用法與離線部署.
  6. npm 包檢查(dspec〈自有套件之npm發布範圍〉原則 1、4,原則 2〈套件測試之 npm 包檢查〉,2026-11-02 使用者裁示 A):①「不得入包」只列外部執行檔與壓縮檔(`.exe .dll .node .msi .zip .7z .gz .tgz` 與分片 `.NNN`)、`bin/` 除 `manifest.json` 外之檔、`CLAUDE*.md`、`tmp/`、`test/_tmp/`、`.env`;②`sgud/`、`docs/`、`test/`、`toolg/`、`script.txt` 等 git 版控內容隨包,**測試不得斷言其不在**,反須斷言 `sgud/`(至少 `sgud/state/state.md`)與 `test/tools/` 隨包.本套件原無大小上限斷言;若要加,只計 `src/`、`dist/`、`bin/`(現值總和 357159 位元組、最大單檔 193265).
- **盤點指令**:主控之外部執行檔盤點工具 `scan-bins`(`--only w-dwload-dlp`,應為 OK);`npm pack --dry-run`(`bin/` 只有 `bin/manifest.json`,`sgud/` 3 檔隨包).
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

## R6 測試取得外部資源:ffmpeg.exe 集中取得、時限對齊下載預算、跨程序只下載一次;樣本由本機供應;YouTube 整合測試保留(2026-11-25 tdlp632,排程第 632 項;t633b 排程第 633 項:改取 `w-ffmpeg` 公開入口、預算改呼叫 `fsEnsureBinsBudget`、每檔上限取預設;全域技能 role-coder-for-test §5.3、dspec〈外部執行檔之存放下載校驗與離線〉§6 E5、E5-3、T9)

- **為何**:`mocha --parallel` 之 worker 為各自獨立之程序;`ffmpeg.exe`(約 122 MB)之快取在 `node_modules/w-ffmpeg/bin-cache`,`w-ffmpeg` 升版即清空,首次取得恰發生在連動後之跟跑測試裡;`dw_mp4`、`dw_m3u8` 原於 `it` 內經 `WDwloadDlp` 隱式取得,各 worker 各自下載、互搶頻寬,而每案時限為全域 180 秒,短於下載預算而逾時(與同日另一套件之平行測試逾時事故同形).另有測試於執行時自 jsDelivr 下載 m3u8 樣本.
- **規則**:
  1. **`ffmpeg.exe` 只經一個取得點**:`test/tools/ffmpegBins.mjs` 之 `ensureFfmpeg()`(程序內共用、失敗不記住);需要真 `ffmpeg.exe` 之測試檔(真跑 `WDwloadDlp` 主函數者)於 `before` 依序「`this.timeout(FFMPEG_BUDGET_MS)` → `await ensureFfmpeg()` → `setupMirror(…)`」,其後之案只用已備妥之快取,不在 `it` 內隱式取得,不直接引 `w-ffmpeg`.
  2. **時限以函式庫之預算函式求得,不自寫算式**(2026-11-25 t633b,規格 E5-3、全域技能 role-coder-for-test §5.3):`test/tools/ffmpegBins.mjs` 之 `calcFfmpegLockLimitMs()` 呼叫 wsemi(1.9.76 起)`fsEnsureBinsBudget('bin/manifest.json', { …opt, pkgRoot: <w-ffmpeg 套件根>, names: 'ffmpeg.exe' })`(`pkgRoot` 與 `names` 為固定值,不被 `opt` 覆蓋)(與鎖之上限同一算式,依 `w-ffmpeg` 清單與環境之 `W_BIN_MIRROR`、`W_BIN_OFFLINE`);`FFMPEG_LOCK_LIMIT_MS`＝其值(預設 `totalMs` 600000、5 分片、無鏡像時 3665000 ms＝約 61 分);**`FFMPEG_BUDGET_MS`＝`FFMPEG_LOCK_LIMIT_MS` × `FFMPEG_BUDGET_FACTOR`(2)＝約 122 分**:並行時等候者最壞要先等他方(上限即鎖等候上限)、他方失敗才自行取得,故 `before` 時限取兩倍;大於鎖等候上限(逾上限由 `fsEnsureBins` 以 `E_LOCK_TIMEOUT` 失敗,不被 mocha 逾時掩蓋).**傳給取得函數之每檔上限(`totalMs`)不短於其預設**:不傳(取預設 600000),不再收緊(原收緊為 300000 使預算約 33 分,但分片於約 87 KB/s 以下即 `E_TIMEOUT_TOTAL`;收緊之取捨已撤回,慢速網路改由兩倍預算容納).把關:`unit-ffmpegBins` 以停住之 `fetch` 替身經**公開入口**讀鎖之 `owner.json` 之 `limitMs` 黑箱對照(預算函式之值＝鎖實際記錄之上限,且 `FFMPEG_BUDGET_MS` ≥ 其兩倍)、預算隨鏡像與 `totalMs` 變動(非常數)、取得時 `totalMs` 為未傳.清單之分片數(`FFMPEG_PARTS`)只供事件彙總(`ffmpegTrace`)判定空快取驗收須見到之下載次數,由 `unit-ffmpegBins` 對清單守住,預算不依賴它.已知限制:①等候上限於每換一個持有者時重新起算,連續換手之最壞情形仍可逾 `FFMPEG_BUDGET_MS`;②預算依本程序載入時之環境變數求得,其後才改環境變數者不反映.
  3. **跨程序只下載一次**:由 wsemi 1.9.75 起之 `fsEnsureBins` 鎖保證(不另寫鎖).**所取為 `w-ffmpeg` 之公開入口 `WFfmpeg.ensureBins`**(2026-11-25 t633b 起;`w-ffmpeg` 1.0.61 起之 `dist/w-ffmpeg.umd.js` 內嵌 wsemi 1.9.76,具鎖;原 1.0.60 之 dist 內嵌舊版 wsemi 無鎖,故 tdlp632 輪暫取深層入口 `w-ffmpeg/src/ensureBins.mjs`,現已改回).呼叫於取得時才取屬性(`(o) => WFfmpeg.ensureBins(o)`),測試才能替換為替身;`unit-ffmpegBins` 以替換 `WFfmpeg.ensureBins` 證明工具所呼叫者即公開入口,並掃描全部測試檔與工具不得有 `w-ffmpeg/` 深層匯入(本套件自己之 `../src/ensureBins.mjs` 不在此列),另斷言安裝之 `w-ffmpeg` dist 含 `E_LOCK_TIMEOUT` 與 `lock-wait`、`w-ffmpeg` ≥ 1.0.61、wsemi ≥ 1.9.76.與 `WDwloadDlp` 內部(UMD)之取得共用同一快取夾(`node_modules/w-ffmpeg/bin-cache`),快取已備妥時只命中快取.
  4. **不靠 `--require` 全域前置**:`scripts.test` 維持固定寫法;以 1~3 使任何起法(批次工具、單檔執行)皆成立.
  5. **樣本由本機供應**:m3u8 樣本(`w-demores` 之 `res/video/aigen_hls`)由 `test/tools/sampleServer.mjs`(只綁 `127.0.0.1`、埠由作業系統配發、未知路徑 404 並記錄)供應,分段 `segment_000.ts`(311892 位元組,sha256 以 `SAMPLE_SHA256` 釘住,與原檔逐位元相同)存於 `test/fixtures/hls/`,播放清單以常數內建(LF,免 git 換行轉換改變雜湊);消費樣本之案以 `isolateExternal()` 令 `yt-dlp.exe` 之對外請求一律經不通之代理(只有 `127.0.0.1`、`localhost` 直連),與網路是否暢通無關(**限制**:只截斷會讀 `HTTP_PROXY`／`NO_PROXY` 之程式;Node 自身之 `fetch` 不受影響,`WDwloadDlp` 仍取 GitHub 主幹清單〔取不到退回基準清單〕,冷快取時 `ffmpeg.exe` 亦自 GitHub 下載,不得據此宣稱測試零對外請求);測試與工具不得出現 CDN 網域(`unit-testNetworkGuard` 掃描).`w-demores` 未列為本套件之相依(只需一個 312 KB 之分段,不為此加 devDependency).
  6. **YouTube 之真實下載保留**(主控 2026-11-25 裁示):`dw_mp4`、`dw_subtitle` 為本套件核心功能之整合測試,**需外網**,網路不穩、YouTube 限流(`HTTP Error 429`,字幕標 pending)或影片變動時會紅;不改為預設略過、不以環境變數閘控.README〈測試之網路需求〉註明.
- **盤點指令**:`Grep "ensureFfmpeg|FFMPEG_BUDGET_MS" test`(取得點與使用處);`Grep "^(import|export).*w-ffmpeg/|import\(.w-ffmpeg/" test`(`w-ffmpeg` 深層匯入,應 0 筆,以 `unit-ffmpegBins` 之掃描案守住;本套件自己之 `../src/ensureBins.mjs` 不在此列);`Grep "jsdelivr|unpkg" test`(應 0 筆,以 `unit-testNetworkGuard` 守住);`Grep "WDwloadDlp\(" test`(真跑主函數之檔:`dw_m3u8`、`dw_mp4` 2 檔,`api-ensureBins`、`api-workFolder`、`api-optionInjection` 以假 `ffmpeg.exe` 與假 yt-dlp 不取真檔).
- **站點全集**:真取 `ffmpeg.exe` 之測試站點 2 處(`dw_m3u8`、`dw_mp4` 之 `before`,皆經 `ensureFfmpeg`,已套);改用本機樣本之站點 2 處(`dw_m3u8`、`dw_subtitle` 之 `[noSubtitle]` 案,已套);保留之外網站點:YouTube 於 `dw_mp4`(1 案)、`dw_subtitle`(6 案:手動軌、短網址與 list 參數、原文自動軌、機器翻譯、頻道頁、不存在之影片,刻意不改).
- **把關測試**:`test/unit-ffmpegBins.test.mjs`(預算函式與清單、鏡像與 `totalMs` 之變動、經公開入口之鎖黑箱對照、公開入口與相依版本、取得點呼叫公開入口且不傳 `totalMs`、無深層匯入之掃描、取得點行為、事件紀錄與彙總;t633b 以 9 項變異驗鑑別力,全被抓)、`test/api-sampleServer.test.mjs`(本機樣本服務與 `isolateExternal`)、`test/unit-testNetworkGuard.test.mjs`(逐呼叫點接線、無 CDN 網域、YouTube 案保留與文件);真實之跨程序只下載一次以驗收證明(見下).
- **驗收(清空快取之平行全套)**:清空 `node_modules/w-ffmpeg/bin-cache` 後,以 `W_DLP_TEST_TRACE=<檔案>` 跑 `npm test`(平行,經 `quiet-run --lock`),再 `node test/tools/ffmpegTrace.mjs <檔案>`:每個分片之下載次數恰 1、他程序有 `lock-wait`(離開碼 0);另單檔執行 `dw_m3u8`(不依賴他檔先跑).
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-ffmpegBins.test.mjs test/api-sampleServer.test.mjs test/unit-testNetworkGuard.test.mjs --timeout 180000`(數秒,不連網);`node node_modules/mocha/bin/mocha.js --no-parallel test/dw_m3u8.test.mjs --timeout 180000`(需 `ffmpeg.exe` 快取或首次下載).

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
