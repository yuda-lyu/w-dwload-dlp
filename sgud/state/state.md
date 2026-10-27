# w-dwload-dlp 狀態

## 內附執行檔

| 項目 | 現況 |
|---|---|
| `yt-dlp/yt-dlp.exe` | yt-dlp stable **2026.10.26**(brotli **1.2.1**,2026-10-27 由管控端換入) |
| `yt-dlp/yt-dlp-ver.txt` | 第一列記內附 yt-dlp 版本(`yt-dlp <tag>`) |
| `yt-dlp/manifest.json` | 下載驗證清單(見下),與 exe 同樣入 git、不入 npm 包;初版 2026-10-27 由 `toolg/genManifest.mjs` 依本次 exe 產出 |
| `yt-dlp/ffmpeg.exe` | 不入版控、不入 npm 包,執行時自動下載 |

## 下載驗證(2026-10-27 起)

消費端取得 `yt-dlp.exe`:`scripts/install.mjs`(postinstall)與執行時 `src/autoDownloadFiles.mjs` → `src/ensureDlpExe.mjs` 皆呼叫 `src/downloadFiles.mjs`,自 `https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/` 取同一分支之清單與 exe,**下載後驗證才落檔**.

| 項目 | 現況 |
|---|---|
| 清單格式(`yt-dlp/manifest.json`,schema 1) | `{ "schema": 1, "file": "yt-dlp.exe", "version": "<tag>", "sha256": "<64碼小寫十六進位>", "size": <位元組> }`;多餘欄位忽略;解析檢核在 `src/parseDlpManifest.mjs`(格式錯 → `E_MANIFEST_FORMAT`) |
| 下載流程 | 先取清單(取不到/格式錯即失敗,不退回未驗證之下載)→ exe 串流至同資料夾 `yt-dlp.exe.<pid>.<隨機>.part` 並同時算 SHA-256 與大小(超過清單大小即中止)→ 相符才更名覆蓋 `yt-dlp.exe`;**任何失敗路徑都不以新下載之未驗證/不完整內容取代正式檔名**(原有舊檔原樣保留),暫存檔必刪,刪不掉於最終錯誤訊息如實說明(某次嘗試刪不掉而之後嘗試成功 → 下載成功,殘留 `.part` 以 log warning 輸出);更名失敗(Windows 防毒占用)最多嘗試 5 次(間隔 0.2/0.4/0.6/0.8 秒),仍失敗但正式檔已是清單所載內容(大小與雜湊皆相符)視為成功;暫存檔以 `wx` 排他建立,若同名檔已存在(EEXIST,不屬於本次下載)則**不刪除該檔**,以 `E_FS` 失敗 |
| 快取時間差 | GitHub raw 之 CDN 快取約 5 分鐘(實測 `Cache-Control: max-age=300`;`github.com/.../raw/...` 會 302 至 raw.githubusercontent.com 且**丟棄查詢字串**,故無法以 `?t=` 繞過快取).處置:雜湊/大小不符與暫時性錯誤(連線失敗、5xx、408/429、停滯)重試,**每次重試前重取清單**;最多 4 次,間隔 20/40/60 秒(等待合計 ≤ 120 秒),整體 ≤ 10 分鐘(單調時計 `performance.now()`,不受系統校時影響;約束網路階段,含寫入暫存檔與其關閉——`pipeline` 帶 signal,停滯/用盡時連寫入端一併中止;驗證通過後之本機更名與清理退避另加至多約 3 秒,不計入),停滯(30 秒無資料)中止該次.404、清單格式錯、磁碟錯誤、時間用盡不重試.408/429 視為暫時性錯誤,建議為「稍後重試」 |
| 取捨 | 不用 GitHub API 取同一提交:未認證 60 次/小時/IP(共用 NAT、CI 易用盡),且需另設失敗退路,複雜度高於收益;120 秒等待涵蓋常見之快取差,最壞(兩檔快取相差近 5 分鐘)會失敗——失敗是安全的(不留檔),postinstall 只記錄、不使 npm 安裝失敗,執行時 `autoDownloadFiles` 於首次用到時再補下載 |
| 執行時 | 既有 `yt-dlp.exe` 直接採用,不重算雜湊、不連網(只在下載時驗證) |
| 錯誤 | `Error`,帶 `code`(`E_MANIFEST_HTTP`、`E_MANIFEST_FORMAT`、`E_HTTP`、`E_NETWORK`、`E_TIMEOUT`、`E_TIMEOUT_TOTAL`、`E_SIZE_MISMATCH`、`E_HASH_MISMATCH`、`E_FS`、`E_RENAME`、`E_ARG`)、`step`、`attempts`;下載失敗(經重試迴圈)之錯誤訊息含預期與實際雜湊(截短)、哪一步、建議;參數錯誤(`E_ARG`,`step: 'argument'`、`attempts: 0`)與資料夾無法建立(`E_FS`,`step: 'prepare'`、`attempts: 0`)不經重試迴圈,前者無 hint |
| 併發共用 | `src/ensureDlpExe.mjs` 以**下載落點資料夾為鍵**共用下載中之 Promise(落點相同的併發呼叫只下載一次;落點不同者各自下載,不共用他處結果——修前為全模組單一 Promise,落點不同時第二個呼叫會 `can not find yt-dlp.exe`);下載結束(成敗皆然)歸零 |
| 測試(本機 HTTP 伺服器,不連外網) | `test/unit-downloadFiles.test.mjs`(68 案:成功/雜湊不符/先不符後相符/大小短少與超量/gzip/中斷/停滯與持續有資料不誤判/寫出階段卡住/總時間共同累計/系統時間跳動/408、429 建議/清單 404、5xx、格式錯 22 種/exe 404/5xx/暫存檔刪不掉/更名失敗/暫存檔名碰撞/寫入失敗/參數檢查)、`test/unit-ensureDlpExe.test.mjs`(11 案:併發只下載一次、落點不同各自下載、失敗傳給全部呼叫者且之後重試、既有 exe 不連網且不讀檔不算雜湊、相依套件落點、autoDownloadFiles 銜接)、`test/unit-dlpManifest.test.mjs`(16 案:清單解析、**清單與 exe/ver 一致**、npm 包不含清單與暫存檔,含哨兵檔);共用夾具 `test/tools/dlpServer.mjs` |

## 更新方式

- npm 包不含 `yt-dlp.exe` 與 `manifest.json`;消費端 postinstall(或執行時 `autoDownloadFiles`)自 GitHub raw master 下載,故 **exe 與 manifest.json 同一提交推上 GitHub** 即對新安裝生效,npm 發布另帶版本號.
- 換 exe 流程:替換 exe → 更新 `yt-dlp-ver.txt` 首列 → `node toolg/genManifest.mjs` 重產清單 → `npm test`(`unit-dlpManifest` 把關,忘了更新清單即紅).
- 管控端(opensrcOper)每日 09:10(UTC+8)後檢查 yt-dlp 新正式版,有新版即以 `update-ytdlp.mjs` 下載、驗證(SHA2-256SUMS、`--version`、`-v` 之 brotli 版本)、替換,**須同步重產 manifest.json**(`node toolg/genManifest.mjs`,或自行寫入同格式),再跑全套(`test/dw_mp4`、`dw_m3u8` 會實際下載,即新 exe 之冒煙測試)後發布.

## 已知缺口與待辦

- 內附 brotli 缺口已結案(2026.10.26 起為 brotli 1.2.1).
- **含本次下載驗證之 npm 版本發布前,`yt-dlp/manifest.json` 須已推上 GitHub master**,否則新版安裝取清單得 404、`yt-dlp.exe` 無法下載(實測 2026-10-27:master 尚無清單時 → `E_MANIFEST_HTTP` 404,不連 exe、不留檔).舊版 npm(未驗證版)不讀清單,不受影響.
- 清單與 exe 同在分支上,僅防傳輸損壞與 CDN 不同步,**不防分支本身被竄改**(使用者 2026-10-27 裁定採 B,不採寫死於 npm 包).
- 行程被強制結束時 `yt-dlp/yt-dlp.exe.*.part` 可能殘留(已列入 `.gitignore`、`.npmignore`),未做啟動時清掃(已知不修).
- Node 24.22.1 之 undici 缺陷(與本套件程式無關,修前之 wsemi 下載同樣會中):伺服端回應後關閉連線(`Connection: close`)且用戶端因背壓暫停讀取時,於 `Parser.finish` 拋未捕捉之 `AssertionError(assert(!this.paused))` 使行程結束.GitHub raw 為 keep-alive 故未見;測試夾具刻意不設 `Connection: close`.
