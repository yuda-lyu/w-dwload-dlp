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
