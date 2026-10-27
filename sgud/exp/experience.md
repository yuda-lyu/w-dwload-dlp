# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.過長時抽出舊者為`experience_<年月日>.md`,並於本檔註明何時抽出.

## 下載驗證(2026-10-27)

- **GitHub raw 快取**:`github.com/<owner>/<repo>/raw/refs/heads/<branch>/<path>` 回 302 至 `raw.githubusercontent.com/...`,**丟棄查詢字串**(加 `?t=` 無效);目標回 `Cache-Control: max-age=300`、`X-Cache`/`Source-Age`,即推送後最久約 5 分鐘內清單與 exe 可能不同步.
- **測試夾具不可設 `Connection: close`**:Node 24.22.1 之 undici 在伺服端回應後即關連線、用戶端因背壓暫停讀取時,會於 `Parser.finish` 拋未捕捉之 `AssertionError(assert(!this.paused))` 使整個行程結束(修前之 wsemi 下載同樣中).夾具保持 keep-alive,且 `reset()` 不要銷毀閒置連線(用戶端重用已被關掉的連線會偶發 ECONNRESET).
- **wsemi 1.9.21 之 `fsDownloadFile`** 已先寫 `<fp>.download` 再更名並核對 content-length(分塊傳輸不核對),故「連線被切斷」已不會在正式檔名留殘檔;未被擋住的是內容完整但雜湊不符、分塊乾淨結束但短少、清單與 exe 不同步.
- **`npm pack --dry-run --json`**:新版 npm 回傳以套件名為鍵之物件(非陣列),解析要兩種都接.
- **undici 錯誤形狀**:網路錯誤為 `TypeError('fetch failed' / 'terminated')`,原因在 `cause`(`ECONNREFUSED`、`UND_ERR_SOCKET`);系統層檔案錯誤才在頂層帶 `syscall`.`pipeline` 因他處錯誤銷毀寫入串流時,寫入串流也會對同一錯誤物件發 `error`,判斷是否為檔案錯誤要看 `syscall`,不能只看「寫入串流發過 error」.
- **時間界限要涵蓋寫入端**:`AbortSignal` 只傳給 `fetch` 時,本文讀完後等待寫出(`_final`)/關閉的階段不受約束;`pipeline(..., { signal })` 才會連寫入串流一併中止.整體時間用 `performance.now()`(單調),`Date.now()` 受系統校時影響.
- **暫存檔所有權**:以 `wx` 排他建立失敗(EEXIST)的同名檔不屬於本次下載,清理時不可刪(外審以固定亂數名實測會刪掉另一下載的檔);判斷「是否為檔案錯誤」看頂層錯誤的 `syscall`,是否為 EEXIST 看 `code`.
- **外審 sol 的收穫形狀**:找得到的多是「改壞實作而測試仍綠」的缺口(拿掉 `touch()`、每請求各給一份總時間、略過更名時的雜湊比對、忽略 content-encoding、刪掉 `.npmignore` 規則)——寫完測試後自己做變異(拿掉檢查再跑)最有效.
- **測試中 mocha 逾時**:`autoDownloadFiles()` 走預設重試(間隔 20/40/60 秒),測試要觸發失敗路徑時用確定性錯誤(如回 404)而非網路例外,否則測試要等 2 分鐘.
