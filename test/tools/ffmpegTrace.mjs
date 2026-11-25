import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { FFMPEG_PARTS } from './ffmpegBins.mjs'


//ffmpeg.exe取得事件紀錄之彙總(rulebook R6之驗收工具)
//事件紀錄由test/tools/ffmpegBins.mjs於環境變數W_DLP_TEST_TRACE指定檔案時逐行(JSON)附加寫入; 驗收:清空node_modules/w-ffmpeg/bin-cache後以npm test(平行)跑全套, 再以本工具彙總
//用法: node test/tools/ffmpegTrace.mjs <紀錄檔>  (任一分片被下載逾1次、或無任何程序下載即離開碼1)


/**
 * summarizeTrace, 彙總事件紀錄之各行
 *
 * @param {Array} lines 事件紀錄之各行(字串, 空行與無法解析之行略過但計入bad)
 * @param {Object} [opt={}] 設定物件
 * @param {Number} [opt.parts=FFMPEG_PARTS] 預期之分片數(空快取之驗收須見到全部分片各下載1次)
 * @returns {Object} { downloadsByFile: { [分片]: 次數 }, downloaders: [PID], waiters: [PID], takeovers: 次數, cacheHitPids: [PID], bad, ok }; ok為恰有opt.parts個分片且每個分片恰下載1次(空快取之驗收); 快取已備妥時下載0次(ok為false, 不屬空快取驗收), 請以downloadsByFile為準
 */
function summarizeTrace(lines, opt = {}) {
    let parts = opt.parts === undefined ? FFMPEG_PARTS : opt.parts
    let downloadsByFile = {}
    let downloaders = new Set()
    let waiters = new Set()
    let cacheHitPids = new Set()
    let takeovers = 0
    let bad = 0
    for (let line of lines) {
        if (String(line).trim() === '') {
            continue
        }
        let ev = null
        try {
            ev = JSON.parse(line)
        }
        catch (err) { // eslint-disable-line no-unused-vars
            bad++
            continue
        }
        if (ev.type === 'download') {
            downloadsByFile[ev.file] = (downloadsByFile[ev.file] || 0) + 1
            downloaders.add(ev.pid)
        }
        else if (ev.type === 'lock-wait' && ev.phase === 'start') {
            waiters.add(ev.pid)
        }
        else if (ev.type === 'lock-takeover') {
            takeovers++
        }
        else if (ev.type === 'cache' && ev.hit === true) {
            cacheHitPids.add(ev.pid)
        }
    }
    let counts = Object.values(downloadsByFile)
    return {
        downloadsByFile,
        downloaders: [...downloaders],
        waiters: [...waiters],
        takeovers,
        cacheHitPids: [...cacheHitPids],
        bad,
        ok: counts.length === parts && counts.every((v) => v === 1),
    }
}


//isMain, 是否為命令列直接執行(兩邊皆取realpath: ESM主模組之URL會經realpath而argv[1]不會, 路徑含連結或磁碟機代號大小寫不同時才不致誤判為被匯入而靜默結束)
let isMain = () => {
    try {
        return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]))
    }
    catch (err) { // eslint-disable-line no-unused-vars
        return false
    }
}


//CLI
if (process.argv[1] && isMain()) {
    let fp = process.argv[2]
    if (!fp) {
        console.log('usage: node test/tools/ffmpegTrace.mjs <trace file>')
        process.exit(2)
    }
    let r = summarizeTrace(fs.readFileSync(fp, 'utf8').split('\n'))
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.ok ? 0 : 1)
}


export { summarizeTrace }
