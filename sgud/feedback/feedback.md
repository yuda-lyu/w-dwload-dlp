# 回饋

本檔為任務中發現之自有套件、全域技能、全域設定之調整與抽提提案(只增不改,處置結果另記一列),欄位:日期、類別、對象、內容、依據.回饋只是紀錄與提案,不因此自行修改他套件、全域技能或全域設定.

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-25 | 自有套件 | w-ffmpeg | 1.0.60 之 `dist/w-ffmpeg.umd.js` 內嵌發布當時之舊版 wsemi(無跨程序鎖):下游頂層升到 wsemi 1.9.75 後,`WFfmpeg.ensureBins` 與依賴它之呼叫(如本套件 `WDwloadDlp` 內部)仍無鎖,兩程序同時對空快取各下載一次.待 wsemi 1.9.75 之連動發布重建 `w-ffmpeg` 之 dist 後即解;屆時本套件 `test/tools/ffmpegBins.mjs` 可改回公開入口 | `grep -c "E_LOCK_TIMEOUT" node_modules/w-ffmpeg/dist/w-ffmpeg.umd.js` 為 0;兩程序實測公開入口每分片取得 2 次、深層入口 1 次(tdlp632 `cross-proc` 探測,規則帳本 R6) |
| 2026-11-25 | 全域技能 | role-coder-for-test §5.3(2026-11-24 新增於技能庫原稿,各機執行 `sync.bat` 後可見;本機已安裝之副本尚無該節) | 於該節補一條:「經依賴套件取得者,先確認該依賴之**公開入口**是否真的具鎖——依賴之 dist 若內嵌 wsemi,頂層 wsemi 升版對其無作用(`npm ls` 之 deduped 會誤導);檢查 `grep -c E_LOCK_TIMEOUT <依賴>/dist/*.js`,為 0 時改取依賴之深層 `src/ensureBins.mjs`(經頂層 wsemi),或待依賴連動發布後再改回」 | 同上列;`sgud/exp/experience.md`〈測試取得 ffmpeg.exe 與樣本〉 |
| 2026-11-25 | 全域設定 | dspec〈外部執行檔之存放下載校驗與離線〉§6 E5 | E5 末段「使用端之測試不必自寫鎖:共用同一快取資料夾即只下載一次」宜加但書:「前提是所用之取得函數確實經具鎖之 wsemi(≥1.9.75);依賴之 dist 內嵌舊版 wsemi 者除外」 | 同上列 |
