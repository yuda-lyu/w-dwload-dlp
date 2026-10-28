# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R1 外部執行檔一律依制式規格,經 `ensureBins`(wsemi `fsEnsureBins`)取得

- **規格**:`C:\opensrcOper\dspec\外部執行檔之存放下載校驗與離線.md`(制式規格;本套件為 A 類、**主幹模式**,登記於主控帳本 G10;wsemi `fsEnsureBins` 為共用實作).本節只摘要,細節以該檔為準.
- **規則**:
  1. 外部執行檔(`yt-dlp.exe`)放自家 repo 之 `bin/`,納入 git,**不入 npm 包**(`.npmignore`:`/bin/*`、`!/bin/manifest.json`、`/bin-cache/`、`/test/_tmp/`);快取 `bin-cache/` 不入版控與 npm 包;`.gitattributes` 設 `bin/** binary`.
  2. 清單 `bin/manifest.json`(制式 schema 1,`mode: "floating"`,不帶 `commit`,`version` 為 yt-dlp 版本)由 `toolg/genBinManifest.mjs` 依 `bin/` 實檔產生,**不手寫**.
  3. 套件端只做三件事:提供清單、經 `src/ensureBins.mjs` 轉呼叫 wsemi `fsEnsureBins` 取得路徑後啟動、匯出 `ensureBins`(主檔為 default 匯出,故掛為靜態屬性 `WDwloadDlp.ensureBins`,不加具名匯出);**不得自寫下載、快取、校驗、鏡像**,不得 `postinstall` 下載;不轉傳使用者之 `floatingManifestUrl`.
  4. `ffmpeg.exe` 屬 `w-ffmpeg`,一律經 `WFfmpeg.ensureBins({ names: 'ffmpeg.exe' })` 取得(**不可**把 `w-ffmpeg/src/ensureBins.mjs` 打包進本套件 UMD:其套件根會指到本套件;故 `w-ffmpeg` 列 rollup external).
  5. 環境變數 `W_BIN_CACHE`、`W_BIN_MIRROR`、`W_BIN_OFFLINE` 由 `fsEnsureBins` 統一讀取;README〈外部執行檔〉說明用法與離線部署.
- **盤點指令**:`node C:/opensrcOper/tools/scan-bins.mjs --only w-dwload-dlp`(應為 OK);`npm pack --dry-run`(清單只有 `bin/manifest.json`).
- **站點全集**:取得 `yt-dlp.exe` 之站點 1 處(`src/WDwloadDlp.mjs` 經 `ensureBins`)＋對外 `ensureBins` 2 條路徑(`WDwloadDlp.ensureBins`、深層匯入 `src/ensureBins.mjs`);取得 `ffmpeg.exe` 之站點 1 處(`WFfmpeg.ensureBins`);啟動外部程式之站點 1 處(`execProcess(fpExeDlp, …)`);全已套.
- **把關測試**:`test/unit-binManifest.test.mjs`(M1/M2/M4/T1/T2:清單形態、與 `bin/` 實檔一致、版本與 `yt-dlp.exe --version` 一致、清單即工具所產、`.npmignore` 含誘餌檔之 `npm pack`、`.gitignore`/`.gitattributes`、src 無自寫下載、無 postinstall、相依版本、rollup external、主檔匯出形態、README 節);`test/api-ensureBins.test.mjs`(T3~T8:本機 HTTP 伺服器扮 GitHub 原始檔、本地資料夾扮鏡像與快取;主函數類入口攔截全域 `fetch` 並攔截 `child_process.spawn` 斷言啟動者為 `ensureBins` 回傳之路徑、套件根與 cwd 無關、不轉傳 `floatingManifestUrl`).功能測試 `test/dw_mp4.test.mjs`、`dw_m3u8.test.mjs` 以本機鏡像(`test/tools/dwMirror.mjs`)供 `yt-dlp.exe`,實際連 YouTube.
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-binManifest.test.mjs test/api-ensureBins.test.mjs --timeout 180000`(約 10 秒).

## R2 換 `bin/yt-dlp.exe` 必同步重產 `bin/manifest.json`,兩者同一提交推 GitHub master

- **規則**(規格 U2,主幹模式):替換 `bin/yt-dlp.exe` 後執行 `node toolg/genBinManifest.mjs` 重產清單(sha256、size 取自實檔,`version` 取自 `bin/yt-dlp.exe --version`),跑 `npm test`,exe 與清單**同一提交**推 GitHub master 即對所有消費端生效(不須發布 npm);npm 包內之基準清單於下次發布時更新.
- **為何**:消費端連網呼叫時取 master 之 `bin/manifest.json` 為準,再自 master 取 `bin/yt-dlp.exe` 以該清單校驗;清單與檔案不一致即 `E_HASH_MISMATCH`(失敗安全,不留檔),套件實質無法取得新版.
- **把關測試**:`test/unit-binManifest.test.mjs` 之「match the real files in bin/」「record in the manifest the version that bin/yt-dlp.exe reports」「exactly what toolg/genBinManifest.mjs generates」;失敗即表示漏重產.
- **站點全集**:清單 1 份 × 一致性來源 3 項(`yt-dlp.exe` 大小、SHA-256、`--version`),皆已套.主控工具 `update-ytdlp.mjs` 須改為此流程(見報告).

## R3 執行期資料交換檔不寫執行檔所在夾,且每次呼叫用自己之工作夾(併行呼叫互不影響)

- **規則**:
  1. 執行檔位於內容定址之快取夾(由清單校驗、可能共用或唯讀),故資料交換檔寫 `os.tmpdir()` 下,不寫執行檔所在夾;不 `process.chdir`(全程序狀態,併發呼叫互相干擾).
  2. **每次呼叫 `WDwloadDlp` 用自己之工作夾** `os.tmpdir()/w-dwload-dlp/<now2strp()>-<genID(6)>/`(`mkIdWork`),下載、合併、轉檔之中介檔皆在其內;`finally` 以 `fsDeleteFolderSafe` 整夾刪除(成功與失敗皆然;暫時被占用時重試,仍刪不掉則忽略,不得蓋過本次結果);結果檔複製到呼叫端之 `fp`(語意不變).夾由 yt-dlp 寫檔時自動建立,不另建.
  3. **不得有跨呼叫共用之暫存夾,不得有「預先清除」之選項**:`opt.clean` 已移除(不留別名;共用夾加預先清除會讓併行呼叫清掉對方下載中之檔,主控全套曾因此 `[outputNotFound]`).
  4. **殘留清理**:崩潰或被強制結束時工作夾會殘留;每次呼叫開始時(`ensureBins` 成功後、建名之前)刪除 `w-dwload-dlp/` 下**名稱符合 `reWork`、為資料夾(不跟進連結)、修改時間逾 `msStaleWork`(24 小時,單一常數,理由寫在常數旁)** 者;fdRoot 不存在、他行程同時在刪、刪不掉皆忽略.其他名稱之資料夾與檔案一律不動.
- **盤點指令**:`Grep "chdir|Downloads|opt\.clean|'clean'|fsCleanFolder" src/`(應無);`Grep "msStaleWork|reWork|mkIdWork|fdWork" src/WDwloadDlp.mjs`(建立 1 處、刪除 1 處、殘留清理 1 處).
- **站點全集**:工作夾建名 1 處(`WDwloadDlp` 之 `fdWork`)、刪除 1 處(同函式 `finally`)、殘留清理 1 處(`cleanStaleWork`),已套;24 小時常數 1 處.
- **把關測試**:`test/api-workFolder.test.mjs`(假 yt-dlp 起真子行程、`TEMP`/`TMP` 導到 `test/_tmp/workFolder/tmp`,不連網:兩併行呼叫之工作夾互不相同且各自刪除、先結束者不動後結束者下載中之檔、yt-dlp 失敗/無輸出檔/複製失敗皆刪夾、`exeNotReady`/`invalidUrl` 不建夾、殘留夾 25h 刪/23h 留/不符命名不動/同名檔案不動、`clean` 無作用、刪除失敗忽略並由之後呼叫清);`test/unit-workFolder.test.mjs`(src 無 `clean`/`Downloads`/`fsCleanFolder`、24 小時常數單一、README 與功能測試不含 `clean`);`test/api-ensureBins.test.mjs` 之主函數案(`-o` 路徑在 `os.tmpdir()` 下、結束後工作夾已刪、cwd 不變);共用夾具 `test/tools/fakeRun.mjs`(攔截 `fetch`、`spawn`、假 `WFfmpeg.ensureBins`)與 `test/tools/fakeDlp.mjs`(模式由 url 末段決定:`fail`/`nofile`/其餘;`FAKE_DLP_GATE` 閘門令併行呼叫確定同時在跑).
- **執行指令**:`node node_modules/mocha/bin/mocha.js --no-parallel test/api-workFolder.test.mjs test/unit-workFolder.test.mjs test/api-ensureBins.test.mjs --timeout 180000`(約 15 秒).

## 破壞性變更紀錄(依自有套件原則:不留舊版相容層)

- 移除 `src/autoDownloadFiles.mjs`、`downloadFiles.mjs`、`ensureDlpExe.mjs`、`parseDlpManifest.mjs`、`scripts/install.mjs`(postinstall)、`toolg/genManifest.mjs`、`yt-dlp/` 目錄(`manifest.json` 舊單檔格式、`yt-dlp-ver.txt`、`yt-dlp.exe`);`yt-dlp.exe` 改在 `bin/`;下載暫存夾改 `os.tmpdir()`;見 README〈Breaking changes〉.
- 移除 `opt.clean`、下載暫存夾改為每次呼叫專用之 `os.tmpdir()/w-dwload-dlp/<id>/`(結束刪除,逾 24 小時殘留自動清除);見 R3、README〈Breaking changes〉.

## 已知限制

- 單一呼叫持續超過 24 小時(如錄製直播)者,其工作夾於他呼叫開始時會被視為殘留而嘗試刪除(殘留判定只看工作夾本身之修改時間);本套件定位為下載檔案,不支援此用法,README 已載明.

- 主幹模式依 wsemi 1.9.27:離線時不取主幹清單,只用 npm 包內之基準清單,故離線部署之鏡像/快取須含基準清單所載版本;鏡像內之 `manifest-last.json` 退路、雜湊不符重取主幹清單,待 wsemi-run05.
- 主幹清單與 `yt-dlp.exe` 之信任錨為 GitHub master(已接受之風險,使用者 2026-10-27 裁定採 B).
