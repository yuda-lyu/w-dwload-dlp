# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 併行呼叫與工作夾(2026-10-29,bin-dlp2)

- **根因**:`dw_mp4`、`dw_m3u8` 兩功能測試在 `mocha --parallel` 下各在一個 worker 行程,共用同一下載夾,且皆 `clean: true`(`fsCleanFolder` 整夾)→ 後開始者清掉先開始者下載中之檔 → `[outputNotFound] … it may be removed during downloading`.改造前下載夾在執行檔旁(同樣共用),屬既有缺陷;`clean` 之 JSDoc 自承「單一程序執行時」才可用,即**並行即互相破壞之設計**,不是時序偶發.修法是消除共用(每次呼叫自有工作夾)而非調 `clean` 或加鎖.
- **工作夾由 yt-dlp 寫檔時自動建立**(沿用 bin-dlp 輪之 `Downloads` 作法,功能測試實證可行),故不另 `mkdir`,也不新增錯誤碼;結束時 `finally` 整夾刪(`fsDeleteFolderSafe`:被占用時重試,失敗忽略).刪除失敗**不可**蓋過本次結果(`finally` 內拋錯會取代 `return`／rejection),所以 `.catch(() => {})`.
- **殘留清理只看工作夾本身之修改時間**(`statSync(fd).mtimeMs`),不掃夾內檔案;名稱以 `reWork` 認(`^\d{14}-[0-9A-Za-z]{6}$`),與 `mkIdWork`(`now2strp()-genID(6)`)成對,有測試保證「呼叫所產生之名稱確為清除所認得」(逾時後的自己之殘留夾被清掉).`Dirent.isDirectory()` 對連結為 false,故不會跟進連結.
- **併行案不用 sleep**:假 yt-dlp(`test/tools/fakeDlp.mjs`)以環境變數 `FAKE_DLP_GATE` 為閘門——寫好 `.part` 後建立 `<gate>-<url 末段>.started`,等 `<gate>-<末段>` 檔出現才繼續;測試輪詢 `.started` 後才斷言,再逐個放行,故「A 先結束時 B 下載中之檔仍在」是確定性的.案例中途失敗時 `afterEach` 放行全部閘門並 `allSettled`,否則假行程與未處理 rejection 殘留到下一案.
- **`os.tmpdir()` 在 Windows 每次呼叫都讀 `process.env.TEMP`／`TMP`**(Node 24 實測),測試把兩者導到 `test/_tmp/workFolder/tmp` 即可隔離殘留清理案,不碰使用者暫存夾;並以 `assert(os.tmpdir() === 導向處)` 防導向失效.
- **刪除失敗之模擬**:攔截 `fs.rmSync`(只對工作夾路徑底下拋 `EPERM`,其餘透傳).wsemi 之 `fsDeleteFolder`／`fsDeleteFolderSafe` 皆經 default import 之 `fs` 於呼叫時查 `rmSync`,攔截有效;`EPERM` 不是 `EBUSY`,`fsDeleteFolderSafe` 不重試而立即 reject,測試不拖慢.攔截前先暖機一次(快取就緒),使攔截只影響工作夾.
- **變異腳本**(`tmp/` 內,結束即清):以字串取代逐項改壞 `src/WDwloadDlp.mjs`,每項先 `node --check` 確認語法有效再跑相關三檔,以 mocha json reporter 取失敗標題判定 killed;`src` 為 CRLF,多行取代前須把 `\n` 轉 `\r\n`;結束(含中途失敗)必寫回基準檔並比對 sha256.
- **測試鎖會久等**:其他套件(如 wsemi 負載試驗)可獨占兩槽數十分鐘,`quiet-run --lock` 會排隊;排隊中之指令於取得鎖時才讀檔,等待期間不要改動它會跑的 `src/`、測試檔.先寫完測試與文件,鎖到手再一次跑完.

## 外部執行檔改制式規格(2026-10-29,bin-dlp)

- **主幹模式之行為(wsemi 1.9.27)**:連網呼叫每次先取一次主幹清單(`raw.githubusercontent.com/<repo>/master/<manifestPath>`),取不到/無效/非本套件之清單 → 基準清單(npm 包內 `bin/manifest.json`);離線不取主幹清單;清單雜湊不符時**不**重取清單、不退基準清單,直接 `E_HASH_MISMATCH`;快取夾之 `manifest-last.json` 只作紀錄.測試的做法:主幹清單載「小假檔」(300 KB 線性同餘位元組)的新版,基準清單用真 `bin/yt-dlp.exe`,可同時驗兩種來源而不重複搬 23 MB.
- **`w-ffmpeg` 不能以 `src/ensureBins.mjs` 打包進本套件 UMD**:其 `pkgRoot` 取自 `import.meta.url`(rollup 換成 dist 檔位置),打包後會指到本套件根而讀到本套件的清單.作法:`import WFfmpeg from 'w-ffmpeg'`(主檔為 UMD,`require` 即函數＋靜態屬性 `ensureBins`)、rollup external 列 `'w-ffmpeg'`;呼叫處用 `WFfmpeg.ensureBins(...)`(呼叫時才取屬性,測試才能替換).
- **主函數類入口之測試**:`child_process.spawn` 可直接替換 `cp.spawn = …`(wsemi `execProcess` 以 default import 的 `cp.spawn(...)` 呼叫,呼叫時才查屬性),假 spawn 記錄參數後改跑 `node test/tools/fakeDlp.mjs …` 以保留真實子行程語意;`w-ffmpeg` 之清單雜湊固定,無法以假檔經鏡像供檔,故替換靜態屬性 `WFfmpeg.ensureBins`(它在 w-ffmpeg 自己的測試涵蓋)。全域 `fetch` 攔截前先放一個「應被攔到」的對照案,否則攔截失效時其他案之「未連網」斷言恆真.
- **版本標示**:`yt-dlp.exe --version` 輸出即 tag(`2026.10.26`,約 1.5 秒),`genBinManifest.mjs` 以它寫入清單 `version`,不手填、不另留 `yt-dlp-ver.txt`.
- **`genBinManifest` 於主幹模式用 `fs.readdirSync('bin')` 列舉**:新換之 exe 尚未 `git add`,`git ls-files` 會列不到.
- **舊版失敗模式**(2026-10-29 以本機 404 伺服器實測):1.0.51 在無 exe 時先取 `yt-dlp/manifest.json` → `E_MANIFEST_HTTP`(HTTP 404,不留檔);1.0.41 等未校驗版以 `fsDownloadFile` 取 `yt-dlp/yt-dlp.exe` → 以字串 reject `failed to download url[…]: status[404]`.皆為明確錯誤、非靜默;`WDwloadDlp` 包成 `[exeNotReady]`.既有 `yt-dlp.exe` 之舊安裝直接採用,不受影響.
- 為測試而替換 `process.env.W_BIN_*`、`globalThis.fetch`、`cp.spawn`、`WFfmpeg.ensureBins` 者,一律於 `after` 還原;`--parallel` 下各檔在不同行程,互不影響.

## 下載驗證(2026-10-27;下載、校驗、快取已於 2026-10-29 改由 wsemi `fsEnsureBins` 實作,以下為當時累積之經驗,留作參考)

- **GitHub raw 快取**:`github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>` 回 302 至 `raw.githubusercontent.com/...`,**丟棄查詢字串**(加 `?t=` 無效);目標回 `Cache-Control: max-age=300`、`X-Cache`/`Source-Age`,即推送後最久約 5 分鐘內清單與 exe 可能不同步.
- **測試夾具不可設 `Connection: close`**:Node 24.22.1 之 undici 在伺服端回應後即關連線、用戶端因背壓暫停讀取時,會於 `Parser.finish` 拋未捕捉之 `AssertionError(assert(!this.paused))` 使整個行程結束(修前之 wsemi 下載同樣中).夾具保持 keep-alive,且 `reset()` 不要銷毀閒置連線(用戶端重用已被關掉的連線會偶發 ECONNRESET).
- **wsemi 1.9.21 之 `fsDownloadFile`** 已先寫 `<fp>.download` 再更名並核對 content-length(分塊傳輸不核對),故「連線被切斷」已不會在正式檔名留殘檔;未被擋住的是內容完整但雜湊不符、分塊乾淨結束但短少、清單與 exe 不同步.
- **`npm pack --dry-run --json`**:新版 npm 回傳以套件名為鍵之物件(非陣列),解析要兩種都接.
- **undici 錯誤形狀**:網路錯誤為 `TypeError('fetch failed' / 'terminated')`,原因在 `cause`(`ECONNREFUSED`、`UND_ERR_SOCKET`);系統層檔案錯誤才在頂層帶 `syscall`.`pipeline` 因他處錯誤銷毀寫入串流時,寫入串流也會對同一錯誤物件發 `error`,判斷是否為檔案錯誤要看 `syscall`,不能只看「寫入串流發過 error」.
- **時間界限要涵蓋寫入端**:`AbortSignal` 只傳給 `fetch` 時,本文讀完後等待寫出(`_final`)/關閉的階段不受約束;`pipeline(..., { signal })` 才會連寫入串流一併中止.整體時間用 `performance.now()`(單調),`Date.now()` 受系統校時影響.
- **暫存檔所有權**:以 `wx` 排他建立失敗(EEXIST)的同名檔不屬於本次下載,清理時不可刪(外審以固定亂數名實測會刪掉另一下載的檔);判斷「是否為檔案錯誤」看頂層錯誤的 `syscall`,是否為 EEXIST 看 `code`.
- **外審 sol 的收穫形狀**:找得到的多是「改壞實作而測試仍綠」的缺口(拿掉 `touch()`、每請求各給一份總時間、略過更名時的雜湊比對、忽略 content-encoding、刪掉 `.npmignore` 規則)——寫完測試後自己做變異(拿掉檢查再跑)最有效.
- **測試中 mocha 逾時**:`autoDownloadFiles()` 走預設重試(間隔 20/40/60 秒),測試要觸發失敗路徑時用確定性錯誤(如回 404)而非網路例外,否則測試要等 2 分鐘.
