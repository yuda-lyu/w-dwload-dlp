# 規則帳本

本檔為套件設計與開發階段之規則帳本(藍圖),為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.當前已做到哪些記於`sgud/state/state.md`.過長時依類型拆為`rulebook_<類型>.md`,本檔只留索引.

## R1 換 yt-dlp.exe 必同步更新 manifest.json

- **規則**:`yt-dlp/yt-dlp.exe` 一有替換,`yt-dlp/manifest.json` 之 `sha256`、`size` 與 `version`(= `yt-dlp-ver.txt` 首列之 tag)須在同一提交同步更新;exe 與清單須同一提交推上 GitHub master(消費端下載時以清單驗證 exe).
- **為何**:下載端(`src/downloadFiles.mjs`)只信清單;清單過期則所有新安裝必因雜湊/大小不符而下載失敗(失敗安全,但套件實質無法取得 exe).
- **作法**:替換 exe 與 `yt-dlp-ver.txt` 後執行 `node toolg/genManifest.mjs` 重產清單.
- **把關測試**:`test/unit-dlpManifest.test.mjs` 之 describe「yt-dlp/manifest.json 與 yt-dlp.exe、yt-dlp-ver.txt 一致」(清單存在且格式合法、size、sha256、version 各一案),失敗訊息會指出重產指令.全套 `npm test` 含之,忘了更新即紅.
- **盤點指令**:`npx mocha --no-parallel test/unit-dlpManifest.test.mjs`.
- **站點全集**:清單 1 份(`yt-dlp/manifest.json`)× 一致性來源 3 項(exe 大小、exe SHA-256、`yt-dlp-ver.txt` 首列 tag),皆已套.
- **不入 npm 包**:`.npmignore` 列 `yt-dlp/manifest.json`、`yt-dlp/yt-dlp.exe`、`yt-dlp/*.part`;由同檔 describe「npm pack 內容」把關.

## R2 下載須驗證後才落檔

- **規則**:`downloadFiles` 任何失敗路徑都不得在正式檔名 `yt-dlp.exe` 留下未驗證或不完整之檔;exe 只寫入同資料夾暫存檔,SHA-256 與大小與清單相符才更名;取不到清單/格式錯即失敗,不退回未驗證之下載;重試與整體時間皆有上限;暫存檔刪不掉如實回報.執行時不對既有 exe 重算雜湊、不連網.
- **把關測試**:`test/unit-downloadFiles.test.mjs`(各失敗路徑 × 結局,見 `sgud/state/state.md`〈下載驗證〉)、`test/unit-ensureDlpExe.test.mjs`(併發、錯誤傳遞、既有 exe 不連網).
- **站點全集(失敗點 × 結局)**:見 `sgud/state/state.md`〈下載驗證〉之測試欄;新增任何失敗路徑或重試分類,須同時補測試與 `isRetryable`/`hintOf` 之對應.外審(2026-10-27)另建議之交叉格(舊檔狀態 × 失敗點、並行範圍、時間用盡階段)已補:舊檔同大小錯雜湊時更名失敗、落點不同之併發、寫出階段卡住、系統時間跳動、暫存檔名碰撞、gzip、408/429.
- **修前紅證據**(2026-10-27):對修前之 `downloadFiles`(僅讓網址可注入)跑同一組案例,挑選之 9 案全紅;雜湊不符與乾淨結束之內容短少,修前於正式檔名留下未驗證/不完整檔,修後皆不留檔.連線被強制切斷(已宣告長度)一案修前即不留檔(wsemi 1.9.21 之 `fsDownloadFile` 已寫 `.download` 暫存再更名並核對 content-length),故該案修前之紅只在錯誤形狀,不在殘檔.
