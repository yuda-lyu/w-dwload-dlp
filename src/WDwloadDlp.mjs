import path from 'path'
import fs from 'fs'
import process from 'process'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import each from 'lodash-es/each.js'
import genID from 'wsemi/src/genID.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import sep from 'wsemi/src/sep.mjs'
import strright from 'wsemi/src/strright.mjs'
import strdelright from 'wsemi/src/strdelright.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import cint from 'wsemi/src/cint.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import execProcess from 'wsemi/src/execProcess.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import fsIsFolder from 'wsemi/src/fsIsFolder.mjs'
import fsCopyFile from 'wsemi/src/fsCopyFile.mjs'
import fsRenameFile from 'wsemi/src/fsRenameFile.mjs'
import fsCleanFolder from 'wsemi/src/fsCleanFolder.mjs'
import fsDeleteFile from 'wsemi/src/fsDeleteFile.mjs'
import fsDeleteFolder from 'wsemi/src/fsDeleteFolder.mjs'
import mZip from 'w-zip/src/mZip.mjs'


let fdSrv = path.resolve()


function isWindows() {
    return process.platform === 'win32'
}


function fsMergeFiles(files, target) {

    //check
    if (!isearr(files) && !isestr(files)) {
        throw new Error(`files[${files}] is not an effective string or array`)
    }
    if (!isearr(files)) {
        files = [files]
    }

    //pm
    let pm = genPm()

    //writeable
    let writeable = fs.createWriteStream(target)

    //core
    let core = () => {
        if (size(files) === 0) {
            writeable.end()
            pm.resolve()
        }
        else {
            let readable = fs.createReadStream(files.shift())
            readable.pipe(writeable, { end: false })
            readable.on('end', () => {
                core()
            })
            readable.on('error', (err) => {
                pm.reject(err)
            })
        }
    }

    //core
    core()

    return pm
}


/**
 * 下載video檔案，預設轉mp4，核心調用yt-dlp，只能用於Windows作業系統
 *
 * yt-dlp: https://github.com/yt-dlp/yt-dlp
 *
 * @param {String} url 輸入網址字串，支援網站種類詳見yt-dlp
 * @param {String} fp 輸入儲存video(*.mp4)檔案路徑字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.clean=false] 輸入預先清除暫存檔布林值，預設false
 * @param {Function} [opt.funProg=null] 輸入回傳進度函數，傳入參數為prog代表進度百分比、nn代表當前已下載ts檔案數量、na代表全部須下載ts檔案數量，預設null
 * @returns {Promise} 回傳Promise，resolve回傳成功訊息，reject回傳錯誤訊息
 * @example
 * // import WDwloadDlp from 'w-dwload-dlp'
 * import WDwloadDlp from './src/WDwloadDlp.mjs'
 *
 * async function test() {
 *
 *     //url
 *     let url = `https://www.youtube.com/watch?v=uj8hjLyEBmU&ab_channel=%E7%A0%81%E5%86%9C%E9%AB%98%E5%A4%A9` //youtube
 *     // let url = `https://www.bilibili.com/video/BV1JZ421x7q8/?spm_id_from=333.1073.channel.secondary_floor_video.click` //bilibili
 *
 *     //fp
 *     let fp = './test.mp4'
 *
 *     //funProg
 *     let funProg = (prog, nn, nat) => {
 *         console.log('prog', `${prog.toFixed(2)}%`, nn, nat)
 *     }
 *
 *     //WDwloadDlp
 *     await WDwloadDlp(url, fp, {
 *         clean: true, //單一程序執行時, 事先清除之前暫存檔, 減少浪費硬碟空間
 *         funProg,
 *     })
 *
 *     console.log('done:', fp)
 * }
 * test()
 *     .catch((err) => {
 *         console.log('catch', err)
 *     })
 * // prog 0.49% 1 99
 * // prog 5.05% 4 99
 * // ...
 * // prog 99.00% 98 99
 * // prog 100.00% 99 99
 * // done: ./test.mp4
 *
 */
async function WDwloadDlp(url, fp, opt = {}) {
    let errTemp = null
    let rc

    //clean
    let clean = get(opt, 'clean')
    if (!isbol(clean)) {
        clean = false
    }

    //funProg
    let funProg = get(opt, 'funProg')

    //isWindows
    if (!isWindows()) {
        return Promise.reject('operating system is not windows')
    }

    //check
    if (!isestr(url)) {
        return Promise.reject('url is not a file')
    }

    //fdExe
    let fdms = 'yt-dlp'
    let fdExeSelf = `${fdSrv}/${fdms}/`
    let fdExeDist = `${fdSrv}/node_modules/w-dwload-dlp/${fdms}/`
    let fdExe = fdExeSelf
    if (fsIsFolder(fdExeDist)) {
        fdExe = fdExeDist
    }

    //exeDlp
    let exeDlp = path.resolve(fdExe, 'yt-dlp.exe')
    exeDlp = `"${exeDlp}"` //用雙引號包住避免路徑有空格
    // console.log('exeDlp', exeDlp)

    //exeFfmpeg
    let exeFfmpeg = path.resolve(fdExe, 'ffmpeg.exe')
    // console.log('exeFfmpeg', exeFfmpeg)

    //check ffmpeg, 若ffmpeg不存在則由分拆zip檔解壓縮出來用
    if (!fsIsFile(exeFfmpeg)) {

        //zipFfmpeg
        let zipFfmpeg = path.resolve(fdExe, 'ffmpeg.zip')

        //fsMergeFiles to ffmpeg.zip
        let fp1 = path.resolve(fdExe, 'ffmpeg.zip.001')
        let fp2 = path.resolve(fdExe, 'ffmpeg.zip.002')
        let fp3 = path.resolve(fdExe, 'ffmpeg.zip.003')
        let fp4 = path.resolve(fdExe, 'ffmpeg.zip.004')
        let fp5 = path.resolve(fdExe, 'ffmpeg.zip.005')
        await fsMergeFiles([fp1, fp2, fp3, fp4, fp5], zipFfmpeg)

        //unzip
        let fdFfmpeg = path.resolve(fdExe, 'temp')
        if (true) {
            await mZip.unzip(zipFfmpeg, fdFfmpeg)
            // console.log('mZip.unzip', r)
        }

        //fsRenameFile ffmpeg.exe
        if (true) {
            let exeFfmpegTemp = path.resolve(`${fdFfmpeg}/`, 'ffmpeg.exe')
            // console.log('exeFfmpegTemp', exeFfmpegTemp)
            fsRenameFile(exeFfmpegTemp, exeFfmpeg)
            // console.log('fsRenameFile', r)
        }

        //fsDeleteFile ffmpeg.zip
        fsDeleteFile(zipFfmpeg)

        //fsDeleteFolder temp
        fsDeleteFolder(fdFfmpeg)

    }

    //cwdOri, cwdTar
    let cwdOri = process.cwd()
    let cwdTar = fdExe
    // console.log('process.cwd1', process.cwd())

    //chdir, 若不切換mseed2ascii預設輸出檔案是在工作路徑, 輸出檔變成會出現在專案下
    process.chdir(cwdTar)
    // console.log('process.cwd2', process.cwd())

    //id
    let id = `${now2strp()}-${genID(6)}`

    //fnAny
    let fnAny = `${id}` //無副檔名

    //fdDownloads
    let fdDownloads = path.resolve(fdExe, 'Downloads')
    // console.log('fdDownloads', fdDownloads)

    //clean
    if (clean) {
        fsCleanFolder(fdDownloads)
    }

    //fpInAny
    let fpInAny = path.resolve(fdDownloads, fnAny)
    // console.log('fpInAny', fpInAny)

    //fpInMp4
    let fpInMp4 = path.resolve(fdDownloads, `${id}.mp4`)
    // console.log('fpInMp4', fpInMp4)

    let fmts = []
    // let mode = 'mp4' //default
    let dn = 0 //default
    let da = 1 //default
    // let bdl = false
    let nnPre = 0
    let nn = 0
    let na = 100 //default
    let naf = 0
    let prog = 0
    let bFunProg = isfun(funProg)
    let cbStdout = (msg) => {
        // console.log('cbStdout', msg)
        msg = msg.replaceAll('\n', ' ') //可能多訊息合併觸發, 去除換行符號不分列處理, 並只偵測處理前面(第1條)
        // console.log('cbStdout', `*${msg}*`)

        //s
        let s = sep(msg, ' ')
        // console.log('s', s)

        //fmts
        if (msg.indexOf('format(s):') >= 0) {
            let ss = sep(msg, 'format(s):')
            let ss1 = get(ss, 1, '')
            fmts = sep(ss1, '+')
            // console.log('fmts', fmts)
            da = size(fmts)
        }

        //自動更新fmts, 並將size(fmts)視為階段數
        if (size(fmts) > 0) {
            let _kfmt = -1
            // let _fmt = ''
            each(fmts, (fmt, kfmt) => {
                if (msg.indexOf(`.f${fmt}.`) >= 0) {
                    _kfmt = kfmt
                    // _fmt = fmt
                }
            })
            let _dn = _kfmt + 1
            if (dn < _dn) {
                dn = _dn
                // console.log('_kfmt', _kfmt, '_fmt', _fmt)
                // console.log('dn', dn, 'da', da)
            }
        }

        //自動更新na
        if (naf === 0 && msg.indexOf('(frag') >= 0) {
            //(frag 82/99)
            let ss = sep(msg, '(frag')
            let ss1 = get(ss, 1, '')
            ss1 = ss1.replaceAll(')', '')
            let nnna = sep(ss1, '/')
            let _na = get(nnna, 1, '')
            if (isnum(_na)) {
                _na = cint(_na)
                if (_na > 0) {
                    naf = _na
                    // console.log('naf', naf)
                }
            }
        }

        //s1
        let s1 = get(s, 1, '')

        //bp
        let bp1 = strright(s1, 1) === '%'
        let bp2 = msg.indexOf('(frag 0/') >= 0 //第1個可能是下載清單瞬間會100%, 直接忽略不考慮
        let bp = bp1 && !bp2

        //prog
        let _prog = 0
        if (bp) {
            _prog = strdelright(s1, 1)
            _prog = cdbl(_prog)
            // console.log('_prog(ori)', _prog)
        }

        //依照階段重算_prog
        if (_prog > 0) {

            //rDif, rPre
            let rDif = 1 / da
            let pPre = ((dn - 1) / da) * 100

            //計算分階段值
            _prog = rDif * _prog + pPre
            // console.log('_prog(stage)', _prog)

        }

        //最高99%, 因可能還有轉檔(例如webm轉mp4), 故最後100%改由最後完成階段觸發
        _prog *= 0.99
        // console.log('_prog(99%)', _prog)

        //update
        if (prog < _prog) {
            prog = _prog
        }
        else {
            return
        }
        // console.log('prog(now)', prog)

        //update nn
        if (naf > 0) {
            na = naf
        }
        nn = cint(prog / 100 * na)
        // console.log('nn', nn, 'nat', nat)

        //check, 若nn沒有>nnPre則視為不需要觸發funProg, 減少切太細導致高頻觸發
        if (nn <= nnPre) {
            return
        }

        //call
        if (bFunProg) {
            // console.log('prog', nn, nat, prog)
            funProg(prog, nn, na)
        }

        //update
        nnPre = nn

    }

    //cmdDl
    let cmdDl = `"${url}" -o "${fpInAny}" --newline --merge-output-format "mp4"`
    // console.log('cmdDl', cmdDl)

    //execProcess
    await execProcess(exeDlp, cmdDl, { cbStdout })
        // .then(function(res) {
        //     console.log('execProcess then', res)
        // })
        .catch((err) => {
            console.log('execProcess catch', err)
            errTemp = 'execProcess error'
        })

    //call
    if (bFunProg) {
        prog = 100
        // console.log('prog', prog)
        funProg(prog, na, na) //因是強制100%, 故nn要直接給na
    }

    //chdir, 不論正常或錯誤皆需還原工作路徑
    process.chdir(cwdOri)

    //check
    if (isestr(errTemp)) {
        return Promise.reject(errTemp)
    }

    //check
    if (!fsIsFile(fpInMp4)) {

        //_fpInMp4, dlp針對某些mp4下載後會無法自動提供副檔名, 得再偵測無副檔名之檔案是否存在
        let _fpInMp4 = path.resolve(fdDownloads, id)

        //check
        if (!fsIsFile(_fpInMp4)) {
            console.log(`can not find the merged file[${fpInMp4}]`)
            errTemp = `invalid url[${url}] or can not download`
            return Promise.reject(errTemp)
        }

        //modify
        fpInMp4 = _fpInMp4

    }

    //fpOut
    let fpOut = fp
    // console.log('fpOut', fpOut)

    //fsCopyFile
    rc = fsCopyFile(fpInMp4, fpOut)
    errTemp = get(rc, 'error')
    if (errTemp) {
        return Promise.reject(errTemp.toString())
    }

    //fsDeleteFile
    rc = fsDeleteFile(fpInMp4)
    //可能無檔案無法刪, 故不檢查錯誤

    return 'ok'
}


export default WDwloadDlp
