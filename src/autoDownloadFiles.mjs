import path from 'path'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import autoDownloadFilesFfmpeg from 'w-ffmpeg/src/autoDownloadFiles.mjs'
import downloadFiles from './downloadFiles.mjs'


//fnExe, yt-dlp執行檔名稱
let fnExe = 'yt-dlp.exe'


//pmDownload, 下載中之Promise, 供併發呼叫共用同一次下載, 避免同時多次下載寫入同一批檔案
let pmDownload = null


/**
 * 自動定位yt-dlp.exe與ffmpeg.exe，若無檔案則自動下載，回傳各執行檔的絕對路徑
 *
 * yt-dlp.exe依序偵測當前工作路徑的yt-dlp/與node_modules/w-dwload-dlp/yt-dlp/，皆無時，
 * 代表安裝時npm封鎖scripts致postinstall未執行，故自動調用downloadFiles重新下載
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

    //fdSrv, 於調用時取當前工作路徑
    let fdSrv = path.resolve()

    //fdBaseSelf, fdBaseNM, yt-dlp.exe可能所在資料夾(開發套件本身時於cwd的yt-dlp/, 被安裝為相依套件時於node_modules/w-dwload-dlp/yt-dlp/)
    let fdBaseSelf = `${fdSrv}/yt-dlp/`
    let fdBaseNM = `${fdSrv}/node_modules/w-dwload-dlp/yt-dlp/`

    //fdBase
    let fdBase = ''
    if (fsIsFile(`${fdBaseSelf}${fnExe}`)) {
        fdBase = fdBaseSelf
    }
    else if (fsIsFile(`${fdBaseNM}${fnExe}`)) {
        fdBase = fdBaseNM
    }
    else {

        //fdBaseDL, 下載落點, 有node_modules/w-dwload-dlp/代表為被安裝之相依套件, 否則為套件自身
        let fdBaseDL = fsIsFolder(`${fdSrv}/node_modules/w-dwload-dlp/`) ? fdBaseNM : fdBaseSelf

        //downloadFiles, 無yt-dlp.exe代表安裝時npm封鎖scripts致postinstall未執行, 故於此重新執行下載,
        //併發呼叫共用同一個下載Promise, 避免重複下載
        if (pmDownload === null) {
            pmDownload = downloadFiles(fdBaseDL)
                .catch((err) => {

                    //下載失敗歸零, 使下次呼叫可重試下載
                    pmDownload = null

                    return Promise.reject(err)
                })
        }
        await pmDownload

        //check
        if (fsIsFile(`${fdBaseDL}${fnExe}`)) {
            fdBase = fdBaseDL
        }

    }

    //check
    if (fdBase === '') {
        return Promise.reject('can not find yt-dlp.exe')
    }

    //fpExeDlp
    let fpExeDlp = path.resolve(fdBase, fnExe)

    //fpExeFfmpeg, 調用w-ffmpeg之autoDownloadFiles自動定位ffmpeg.exe, 無檔案則由w-ffmpeg自行下載
    let { fpExe: fpExeFfmpeg } = await autoDownloadFilesFfmpeg()

    return {
        fpExeDlp,
        fpExeFfmpeg,
    }
}


export default autoDownloadFiles
