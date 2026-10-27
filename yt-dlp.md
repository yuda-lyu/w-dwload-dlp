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

更新yt-dlp.exe(須同步更新清單):
1. 替換yt-dlp/yt-dlp.exe，並更新yt-dlp/yt-dlp-ver.txt首列(格式`yt-dlp <tag>`，如`yt-dlp 2026.10.26`)。
2. 於套件根目錄執行`node toolg/genManifest.mjs`，由exe與ver檔重產yt-dlp/manifest.json(schema、file、version、sha256、size)。
3. 執行`npm test`，test/unit-dlpManifest.test.mjs會檢核清單與exe(雜湊、大小)及ver檔(版本)一致，忘了更新清單即紅。
4. exe與manifest.json須同一提交推上GitHub master分支：消費端下載時先取同分支之manifest.json，下載exe後比對雜湊與大小，相符才落檔；兩者都不入npm包，故只換exe時推上GitHub即對新安裝生效，不必發布npm。推送後數分鐘內GitHub raw的CDN快取可能使清單與exe暫時不同步，下載端會間隔重試(最多4次，整體不超過10分鐘)。
5. 清單格式與下載驗證細節見README之Download integrity。
