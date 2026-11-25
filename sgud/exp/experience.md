# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 測試取得 ffmpeg.exe 與樣本(2026-11-25,tdlp632,排程第 632 項;規則 R6)

- **`w-ffmpeg` 之公開 UMD 入口與頂層 wsemi 無關**:`w-ffmpeg` 1.0.60 之 `dist/w-ffmpeg.umd.js` 把 wsemi 打包進去(發布時之版本,無鎖),頂層 `node_modules/wsemi` 升到 1.9.75 對 `WFfmpeg.ensureBins` 與 `WDwloadDlp` 內部之取得**皆無作用**(`npm ls` 顯示 deduped 1.9.75 會讓人誤以為已套);深層入口 `w-ffmpeg/src/ensureBins.mjs` 才經頂層 wsemi(有鎖).實測兩程序同時對空快取取得:公開入口每分片取 2 次(共 10 次、約 27 秒、無等候),深層入口每分片 1 次(共 5 次、另一程序 `lock-wait`、約 10 秒).故 tdlp632 輪暫以深層入口作測試之共用取得點;**已解(2026-11-25 t633b)**:`w-ffmpeg` 1.0.61 之 `dist` 內嵌 wsemi 1.9.76(`lock-wait` 在 dist 內),取得點已改回公開入口 `WFfmpeg.ensureBins`.檢查法:`grep -c "E_LOCK_TIMEOUT" node_modules/w-ffmpeg/dist/*.umd.js`(0＝無鎖).
- **取得處之時限以函式庫之預算函式求得,不自寫算式**(2026-11-25 t633b 改;原 tdlp632 自寫算式並把 `totalMs` 收緊為 300000 使預算約 33 分):`fsEnsureBinsBudget('bin/manifest.json', { pkgRoot: <w-ffmpeg 套件根>, names: 'ffmpeg.exe' })`(wsemi ≥ 1.9.76,與鎖之上限同一算式,依清單與環境之 `W_BIN_MIRROR`、`W_BIN_OFFLINE`):預設 `totalMs` 600000、5 分片、無鏡像＝3665000 ms(約 61 分);並行時等候者最壞先等他方、他方失敗才自行取得,`before` 時限取**兩倍**(約 122 分).傳給下載函式之每檔上限不得短於其預設,故不傳 `totalMs`(收緊之取捨撤回:26 MB 分片於約 87 KB/s 以下即 `E_TIMEOUT_TOTAL`).`FFMPEG_PARTS` 仍寫在 `test/tools/ffmpegBins.mjs`,但只供 `ffmpegTrace` 判定空快取驗收須見到之下載次數,由 `unit-ffmpegBins` 對 `w-ffmpeg` 清單守住,預算不依賴它.
- **測「取得點呼叫公開入口」之法**:替換 `WFfmpeg.ensureBins` 為替身(呼叫時才取屬性,故可換),再讓提供者 `get()`,斷言替身被呼叫 1 次、只帶 `names`／`onTrace`;同時暫設 `W_BIN_OFFLINE=1`,使工具若改回深層入口(修前紅或變異)也只讀快取、不連網下載.深層匯入之靜態掃描只比對以 `import`／`export` 起頭之行與動態 `import(`,否則他檔(如 `unit-testNetworkGuard`)內之 `/from 'w-ffmpeg/` 正規式字面會誤報.`FFMPEG_BUDGET_MS` 之斷言用「≥ 兩倍之鎖實際記錄上限」(env 設鏡像時預算只會更大),精確值只對 `calcFfmpegLockLimitMs({ mirror: '', offline: false })` 比,以免測試隨環境變數漂移.
- **驗收之確定性替身**:本機網路快(122 MB 約 10~80 秒)時,舊版不會真的撞上 180 秒;以 `--timeout 5000` 配清空 `node_modules/w-ffmpeg/bin-cache` 可確定性重現逾時型紅(舊:`it` 內隱式取得 → `Timeout of 5000ms exceeded`,且下載於逾時後才完成,與事故同形;新:取得點之 `before` 自給時限 → 綠).
- **模擬外網斷線之法**:`HTTP_PROXY`／`HTTPS_PROXY` 指向不通之埠、`NO_PROXY=127.0.0.1,localhost`:yt-dlp(Python)遵守,Node 之 `fetch` 預設不遵守(故不影響 ffmpeg 之下載);`test/tools/sampleServer.mjs` 之 `isolateExternal()` 即此法,消費樣本之案據此與網路是否暢通無關.
- **樣本檔與 git 換行**:播放清單(146 位元組文字)若存檔,autocrlf 環境下檢出會變 CRLF 而雜湊改變,故以常數內建於服務(LF);二進位分段 `segment_000.ts` 存於 `test/fixtures/hls/`(依 dspec 測試隨包,312 KB,遠小於 10 MB 門檻).

## 字幕入口與選項注入(2026-11-04,wd72,Gitea #72)

- **yt-dlp 2026.10.26 字幕行為(皆實測)**:①字幕軌無 json3 時 `--sub-format json3` **不報錯**,印 `WARNING: No subtitle format found matching "json3" for language zh-Hant, using vtt` 後改下載 `dl.zh-Hant.vtt`,離開碼 0(`jfXg5ZslKg4` 之自動軌 `zh-Hant`〔僅 vtt〕;同片另有手動 `zh-Hant`〔有 json3〕);②自動軌第 1 筆格式常為無 `name` 之 vtt(`TXcnAHNA0RU` 之 `zh-Hans`:`[{ext:vtt},{ext:json3,name:…},…]`),`name` 要取 json3 該筆;③純自動字幕影片(`9bZkp7q19f0`)157 軌皆有 json3,第 1 筆為 `ab`(Abkhazian,機器翻譯),原文軌為 `ko-orig`;④`live_chat`(ext `json`)出現在**直播中**之影片(`mhJRzQsLZGg` 之 `--list-subs` 為 `live_chat json`),曾直播之回放(`was_live`,試 5 部)之 info.json 無此鍵——有則因無 json3 被排除;⑤有 CC 字幕之直播回放,自動軌名稱為 `<語言>-<手動軌代碼>`(如 `ab-en-uYU-mmqFLq8`),手動軌代碼本身為 `en-uYU-mmqFLq8`(非標準 BCP47),沒有 `-orig`.
- **`--sub-langs` 之值是正規式**(yt-dlp 以 `值$` 錨定比對,`-` 開頭者為排除):語言代碼取自 yt-dlp 回傳之字典,仍篩 `^[A-Za-z0-9][A-Za-z0-9_-]*$` 才列入,同時避免特殊字元進入輸出檔名.
- **頻道頁**(`@YouTube/videos`):不加 `--flat-playlist` 時 `--playlist-items 1:2` 要約 5.6 秒且逐一解析影片;加後約 2.6 秒;`--flat-playlist` 不限項目時列舉 199 項約 4.1 秒(列舉全部才得知是清單,項目多的頻道會更久),故再加 `--playlist-items 1`(仍 2.6 秒,`_type` 仍 `playlist`).`--write-info-json` 對播放清單寫出之 info.json 不含 `entries`(約 3 KB);`_type` 為 `playlist`;單一影片之 `_type` 為 `video`.
- **429**:連續呼叫後機器翻譯軌(`zh-Hant`、`ko`)下載字幕回 `ERROR: Unable to download video subtitles for 'zh-Hant': HTTP Error 429: Too Many Requests`(info 呼叫與原文軌通常不受影響);分類為 `[httpError]`.功能測試只把此型(`[httpError]` 且含 `HTTP Error 429`)標 pending,其餘錯誤照常失敗;預期值由 oracle(直接以 yt-dlp 取同一影片資訊)導出,不寫死特定軌,前提不成立以 `[fixture changed upstream]` 失敗,別於函數缺陷.
- **yt-dlp 逾時**(本機 127.0.0.1 伺服器實測,`tmp/` 腳本結束即清):伺服器接受連線不回應 → 約 23 秒 `ERROR: [generic] x: Unable to download webpage: … Read timed out. (read timeout=20.0)`;伺服器每 3 秒送 1 位元組(標頭永不結束)→ 80 秒仍不結束(per-read 逾時不觸發),可能無限等待.wsemi `execProcess` 有 `opt.timeout`(殺行程樹),本套件主控裁示不加.
- **真實 json3 之特性**(4 份樣本):`tStartMs` 皆有;手動軌無 `aAppend`;自動軌有 `aAppend:1` 之換行 event(`segs` 僅 `\n`)與 `acAsrConf`、`tOffsetMs`、`isSpeakerChange`;連續相同行 0 筆(故不去重,保持與 segments 一對一);滾動前綴(下一行以上一行為前綴)偶有.
- **測試夾具**:`test/tools/fakeDlp.mjs` 要求 url 為 `--` 之後唯一引數(否則離開碼 2),使「漏加 `--`」令全部主函數類測試轉紅(修前紅 9 案);選項注入另以真 yt-dlp.exe 驗(`test/api-optionInjection.test.mjs`,`--version`/`--help` 不連外網,修前回 `[outputNotFound]`).`createFakeRun` 一律攔截 `cp.spawn`,要用真 yt-dlp 之測試自建環境(本機鏡像＋`W_BIN_OFFLINE=1`＋只替換 `WFfmpeg.ensureBins`).
- **變異/修前紅腳本**(`tmp/wd72/`,結束即清):`mutate.mjs`(逐項取代 src 後跑相關測試,`--reporter json` 取失敗數,結束還原並比對 sha256)＋`redrun.mjs`(以 `git show HEAD:` 還原主檔並隱藏新模組,跑新測試).`src` 為 CRLF,Edit 工具會保留 CRLF,Write 新檔為 LF,收尾以腳本統一轉 CRLF(`.gitattributes` 雖未設 `text`,`core.autocrlf=true`).mocha `--no-parallel` 載入失敗之測試檔(`ERR_MODULE_NOT_FOUND`)會使整次執行中止而無 json 結果,修前紅要分檔跑.

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
- **npm 包檢查之斷言口徑(2026-11-02,dspec〈自有套件之npm發布範圍〉)**:`sgud/`、`docs/`、`test/`、`toolg/`、`script.txt` 隨包,測試只可斷言「外部執行檔與壓縮檔、`bin/` 除清單外、`CLAUDE*.md`、`tmp/`、`test/_tmp/`、`.env` 不在」,並斷言 `sgud/`、`test/tools/` 在;誘餌檔要放在會入包之位置(如 `src/__x__.exe`)才證明得了斷言有效,放在 `bin/` 只證明 `.npmignore` 規則有效.`.npmignore` 首段依原則 3 須逐行等於 `.gitignore`(含註解);原先把 `test/_tmp`、`/bin-cache/` 放在第 1 條段而首段缺這兩行,生效結果相同但不合原則 3.
- **wsemi 1.9.64 起 `E_OFFLINE_MISSING` 訊息不帶值(V20)與本套件之字串包裝**(2026-11-18):`WDwloadDlp`／`dwloadSubtitle` 之 `[exeNotReady]` 次行原轉抄 `ensureBins` 之訊息(含 sha256、路徑);訊息改版後轉抄之內容已不含值,但其「見此錯誤之 missing 欄位」對字串使用者無意義,故改由 `strExeNotReady` 重組:離線缺檔時只列 `err.missing[].name` 與固定說明(離線準備請呼叫 `ensureBins()` 並讀 `err.missing[]`),其餘錯誤碼沿用原說明.測試以假 `WFfmpeg.ensureBins`(`fakeRun` 之 `ffMode: 'offline'`,訊息與 `missing` 帶逐筆相異之值)確認包裝只取檔名不轉抄訊息;變異(包裝還原為轉抄)使 5 案轉紅.
- **測試中 mocha 逾時**:`autoDownloadFiles()` 走預設重試(間隔 20/40/60 秒),測試要觸發失敗路徑時用確定性錯誤(如回 404)而非網路例外,否則測試要等 2 分鐘.
