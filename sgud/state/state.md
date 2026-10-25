# w-dwload-dlp 狀態

## 內附執行檔

| 項目 | 現況 |
|---|---|
| `yt-dlp/yt-dlp.exe` | yt-dlp stable **2026.10.21**(2026-10-25 更新;官方 SHA2-256SUMS 驗證相符);內附 brotli **1.2.0**——屬 CVE-2026-111497(Brotli 解碼器越界寫入,影響 1.0.3～1.2.0)之受影響版本,上游 yt-dlp 至 2026.10.21 仍釘 `brotli==1.2.0`,待其改釘 ≥ 1.2.1 之正式版 |
| `yt-dlp/yt-dlp-ver.txt` | 第一列記內附 yt-dlp 版本(`yt-dlp <tag>`) |
| `yt-dlp/ffmpeg.exe` | 不入版控、不入 npm 包,執行時自動下載 |

## 更新方式

- npm 包不含 `yt-dlp.exe`;消費端 postinstall(或執行時 `autoDownloadFiles`)自 GitHub raw master 下載,故 exe 推上 GitHub 即對新安裝生效,npm 發布另帶版本號.
- 管控端(opensrcOper)每日 09:10(UTC+8)後檢查 yt-dlp 新正式版,有新版即以 `update-ytdlp.mjs` 下載、驗證(SHA2-256SUMS、`--version`、`-v` 之 brotli 版本)、替換,再跑全套(`test/dw_mp4`、`dw_m3u8` 會實際下載,即新 exe 之冒煙測試)後發布.

## 已知缺口與待辦

- 內附 brotli 待上游升至 ≥ 1.2.1(見上).
