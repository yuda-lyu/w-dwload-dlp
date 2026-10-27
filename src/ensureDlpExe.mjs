import path from 'path'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import downloadFiles from './downloadFiles.mjs'


//fnExe, yt-dlp執行檔名稱
let fnExe = 'yt-dlp.exe'


//pmDownloads, 下載中之Promise(以下載落點資料夾為鍵), 供落點相同之併發呼叫共用同一次下載, 避免同時多次下載寫入同一批檔案;
//落點不同者(如下載進行中切換工作路徑)各自下載, 不共用他處之結果
let pmDownloads = new Map()


/**
 * 自動定位yt-dlp.exe，若無檔案則自動下載，回傳yt-dlp.exe的絕對路徑
 *
 * yt-dlp.exe依序偵測當前工作路徑的yt-dlp/與node_modules/w-dwload-dlp/yt-dlp/，皆無時，
 * 代表安裝時npm封鎖scripts致postinstall未執行，故自動調用downloadFiles重新下載(下載後驗證完整性，見downloadFiles)。
 * 既有之yt-dlp.exe直接採用，不重算雜湊、不連網，只在下載時驗證。
 *
 * 由autoDownloadFiles調用，另獨立成檔供測試注入工作路徑與下載設定
 *
 * @private
 * @param {Object} [opt={}] 輸入設定物件，預設{}，供測試注入
 * @param {String} [opt.fdSrv] 輸入工作路徑，預設調用時之當前工作路徑
 * @param {Object} [opt.downloadOpt] 輸入傳給downloadFiles之設定物件
 * @returns {Promise} 回傳Promise，resolve回傳yt-dlp.exe的絕對路徑字串，reject回傳錯誤
 */
async function ensureDlpExe(opt = {}) {

    //fdSrv, 於調用時取當前工作路徑
    let fdSrv = opt.fdSrv ? path.resolve(opt.fdSrv) : path.resolve()

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
        if (!pmDownloads.has(fdBaseDL)) {
            pmDownloads.set(fdBaseDL, downloadFiles(fdBaseDL, opt.downloadOpt)
                .finally(() => {

                    //下載結束(成敗皆然)歸零, 使下次呼叫重新依檔案是否存在判定; 若只於失敗時歸零, 下載成功後檔案被移除(重裝套件、防毒隔離)時, 會沿用已resolve之Promise而不再下載
                    pmDownloads.delete(fdBaseDL)

                }))
        }
        await pmDownloads.get(fdBaseDL)

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
    return path.resolve(fdBase, fnExe)
}


export default ensureDlpExe
