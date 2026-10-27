import autoDownloadFilesFfmpeg from 'w-ffmpeg/src/autoDownloadFiles.mjs'
import ensureDlpExe from './ensureDlpExe.mjs'


/**
 * 自動定位yt-dlp.exe與ffmpeg.exe，若無檔案則自動下載，回傳各執行檔的絕對路徑
 *
 * yt-dlp.exe依序偵測當前工作路徑的yt-dlp/與node_modules/w-dwload-dlp/yt-dlp/，皆無時，
 * 代表安裝時npm封鎖scripts致postinstall未執行，故自動調用downloadFiles重新下載，
 * 下載時會取同一分支之yt-dlp/manifest.json核對SHA-256與大小，相符才落檔，不符則失敗且不留檔(見ensureDlpExe與downloadFiles)；
 * 既有之yt-dlp.exe直接採用，不重算雜湊、不連網
 *
 * ffmpeg.exe由w-ffmpeg之autoDownloadFiles負責偵測與下載，故基於本套件開發之套件或專案，
 * 僅須調用本函數即可備齊全部執行檔，無須各自再調用w-ffmpeg之autoDownloadFiles
 *
 * 供w-dwload-dlp自身與其他依賴w-dwload-dlp的套件調用，無須各自實作偵測與下載邏輯
 *
 * 因yt-dlp.exe與ffmpeg.exe只能用於Windows作業系統，故調用前須自行檢核作業系統
 *
 * @returns {Promise} 回傳Promise，resolve回傳執行檔路徑物件，內含fpExeDlp與fpExeFfmpeg兩絕對路徑字串，reject回傳錯誤訊息
 * @example
 * import autoDownloadFiles from 'w-dwload-dlp/src/autoDownloadFiles.mjs'
 *
 * async function test() {
 *
 *     //autoDownloadFiles, 無yt-dlp.exe或ffmpeg.exe時自動下載, 下載失敗則reject
 *     let { fpExeDlp, fpExeFfmpeg } = await autoDownloadFiles()
 *
 *     console.log('fpExeDlp', fpExeDlp)
 *     // fpExeDlp D:\xxx\node_modules\w-dwload-dlp\yt-dlp\yt-dlp.exe
 *
 *     console.log('fpExeFfmpeg', fpExeFfmpeg)
 *     // fpExeFfmpeg D:\xxx\node_modules\w-ffmpeg\src\ffmpeg.exe
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 *
 */
async function autoDownloadFiles() {

    //fpExeDlp, 自動定位yt-dlp.exe, 無檔案則下載並驗證
    let fpExeDlp = await ensureDlpExe()

    //fpExeFfmpeg, 調用w-ffmpeg之autoDownloadFiles自動定位ffmpeg.exe, 無檔案則由w-ffmpeg自行下載
    let { fpExe: fpExeFfmpeg } = await autoDownloadFilesFfmpeg()

    return {
        fpExeDlp,
        fpExeFfmpeg,
    }
}


export default autoDownloadFiles
