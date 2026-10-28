## yt-dlp

yt-dlp是youtube-dl的最新分支，為Python開源專案，可通過指令下載上百種影音串流平台的內容。

yt-dlp github
https://github.com/yt-dlp/yt-dlp

須至yt-dlp releases下載最新版yt-dlp.exe(windows平台):
https://github.com/yt-dlp/yt-dlp/releases

yt-dlp會通過ffmpeg合併影音檔，但因ffmpeg有部份問題，yt-dlp有另外fork並編譯ffmpeg，更新yt-dlp時須再另外至ffmpeg-builds下載重編版(windows x64):
https://github.com/yt-dlp/FFmpeg-Builds

指令為:
yt-dlp.exe YT網址 -o "檔案位置名稱"

更新yt-dlp.exe(外部執行檔規格U2，主幹模式，須同步更新清單):
1. 替換bin/yt-dlp.exe(不入npm包，只入git)。
2. 於套件根目錄執行`node toolg/genBinManifest.mjs`，依bin/實檔重產bin/manifest.json(sha256與size取自實檔，version取自`bin/yt-dlp.exe --version`，不手寫)。
3. 執行`npm test`，test/unit-binManifest.test.mjs會檢核清單與bin/實檔(雜湊、大小)及exe自報版本一致，並檢核清單即為工具所產，忘了更新清單即紅。
4. bin/yt-dlp.exe與bin/manifest.json須同一提交推上GitHub master分支：消費端連網呼叫時先取master之bin/manifest.json，再自master取bin/yt-dlp.exe，以清單校驗雜湊與大小後才落快取；兩者都不入npm包(npm包內只有bin/manifest.json作為取不到主幹清單時之基準清單)，故只換exe時推上GitHub即對所有消費端生效，不必發布npm；npm包內之基準清單於下次發布時隨版更新。推送後數分鐘內GitHub raw的CDN快取可能使清單與exe暫時不同步(雜湊不符時下載端拒用並報`E_HASH_MISMATCH`，稍後重試即可)。
5. 清單格式、環境變數(W_BIN_CACHE、W_BIN_MIRROR、W_BIN_OFFLINE)與離線部署見README〈外部執行檔〉。
