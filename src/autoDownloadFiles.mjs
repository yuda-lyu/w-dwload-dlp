import path from 'path'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import downloadFiles from './downloadFiles.mjs'


/**
 * 自動定位yt-dlp.exe，若無檔案則自動下載，回傳yt-dlp.exe的絕對路徑
 *
 * 依序偵測當前工作路徑的yt-dlp/與node_modules/w-dwload-dlp/yt-dlp/，皆無yt-dlp.exe時，
 * 代表安裝時npm封鎖scripts致postinstall未執行，故自動調用downloadFiles重新下載，落點為node_modules/w-dwload-dlp/yt-dlp/
 *
 * 供w-dwload-dlp自身與其他依賴w-dwload-dlp的套件或專案調用，無須各自實作偵測與下載邏輯
 *
 * 因yt-dlp.exe只能用於Windows作業系統，故調用前須自行檢核作業系統
 *
 * @returns {Promise} 回傳Promise，resolve回傳yt-dlp.exe的絕對路徑字串，reject回傳錯誤訊息
 * @example
 * import autoDownloadFiles from 'w-dwload-dlp/src/autoDownloadFiles.mjs'
 *
 * async function test() {
 *
 *     //autoDownloadFiles, 無yt-dlp.exe時自動下載, 下載失敗則reject
 *     let fpExeDlp = await autoDownloadFiles()
 *
 *     console.log('fpExeDlp', fpExeDlp)
 *     // fpExeDlp D:\xxx\node_modules\w-dwload-dlp\yt-dlp\yt-dlp.exe
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

    //fnExe
    let fnExe = 'yt-dlp.exe'

    //fdExeSrc, fdExeNM, yt-dlp.exe可能所在資料夾(開發套件本身時於cwd的yt-dlp/, 被安裝為相依套件時於node_modules/w-dwload-dlp/yt-dlp/)
    let fdExeSrc = `${fdSrv}/yt-dlp/`
    let fdExeNM = `${fdSrv}/node_modules/w-dwload-dlp/yt-dlp/`

    //fdExe
    let fdExe = ''
    if (fsIsFile(`${fdExeSrc}${fnExe}`)) {
        fdExe = fdExeSrc
    }
    else if (fsIsFile(`${fdExeNM}${fnExe}`)) {
        fdExe = fdExeNM
    }
    else {

        //downloadFiles, 無yt-dlp.exe代表安裝時npm封鎖scripts致postinstall未執行,
        //故於此重新執行下載, 落點為本套件於node_modules內的yt-dlp/
        await downloadFiles(fdExeNM)
        if (fsIsFile(`${fdExeNM}${fnExe}`)) {
            fdExe = fdExeNM
        }

    }

    //check
    if (fdExe === '') {
        return Promise.reject('can not find yt-dlp.exe')
    }

    //fpExe
    let fpExe = path.resolve(fdExe, fnExe)

    return fpExe
}


export default autoDownloadFiles
