import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import parseDlpManifest from './parseDlpManifest.mjs'


//urlBaseDef, 清單與執行檔皆自同一分支之同一資料夾下載
let urlBaseDef = 'https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/'

//fnExe, fnManifest
let fnExe = 'yt-dlp.exe'
let fnManifest = 'manifest.json'

//預設之重試與逾時上限
//GitHub raw之CDN快取約5分鐘(Cache-Control: max-age=300)，推送新exe後清單與exe可能短暫不同步而雜湊不符，
//故雜湊/大小不符與暫時性錯誤(連線失敗,5xx,429,停滯)重試，每次重試前重新取清單，間隔retryDelayMs*次數(20,40,60秒)，
//整體(含下載時間)不超過totalMs，故postinstall最壞耗時有上限，失敗不使npm安裝失敗，執行時autoDownloadFiles會再補下載
let optDef = {
    maxAttempts: 4, //最多嘗試次數
    retryDelayMs: 20000, //重試間隔基數，第n次重試前等待retryDelayMs*n
    stallMs: 30000, //連續多久沒收到資料視為停滯，中止該次下載
    totalMs: 600000, //整體時間上限
}


function mkErr(code, msg, extra = {}) {
    let err = new Error(msg)
    err.code = code
    Object.assign(err, extra)
    return err
}


function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}


function short(h) {
    return `${h.slice(0, 16)}...`
}


//codeMsg, 系統錯誤(含code)轉為簡短說明
function codeMsg(err) {
    return [err.code, err.message].filter((v) => v).join(' ')
}


function num(v, def) {
    return (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? v : def
}


//網路層錯誤(undici之TypeError: fetch failed/terminated, 原因在cause)轉為簡短說明
function describeNet(err) {
    let msg = (err && err.message) ? err.message : String(err)
    let c = err ? err.cause : null
    let d = c ? `${c.code || ''} ${c.message || ''}`.trim() : ''
    return d ? `${msg} (${d})` : msg
}


//丟棄回應本體以釋放連線, 失敗不影響結果
async function dropBody(res) {
    try {
        await res.body.cancel()
    }
    catch (err) {}
}


//單一請求之計時: 連續stallMs沒有資料(touch)中止, 整體超過截止時間中止, 中止原因存於reason
function openReq(ctx) {
    let ac = new AbortController()
    let reason = null
    let abort = (err) => {
        if (reason === null) {
            reason = err
            ac.abort(err)
        }
    }
    let remain = ctx.deadline - performance.now()
    if (remain <= 0) {
        throw mkErr('E_TIMEOUT_TOTAL', `the total time budget of ${ctx.totalMs / 1000}s is used up`, { step: 'budget' })
    }
    let timerTotal = setTimeout(() => {
        abort(mkErr('E_TIMEOUT_TOTAL', `the total time budget of ${ctx.totalMs / 1000}s is used up`))
    }, remain)
    let timerStall = null
    let touch = () => {
        clearTimeout(timerStall)
        timerStall = setTimeout(() => {
            abort(mkErr('E_TIMEOUT', `no data received for ${ctx.stallMs / 1000}s`))
        }, ctx.stallMs)
    }
    touch()
    return {
        signal: ac.signal,
        touch,
        reason: () => reason,
        close: () => {
            clearTimeout(timerTotal)
            clearTimeout(timerStall)
        },
    }
}


//整理請求過程之錯誤: 計時器中止的以中止原因為準, 非本模組定義之錯誤視為網路錯誤
function tagErr(err, req, step) {
    let e = req.reason() || err
    if (!(e && typeof e.code === 'string' && e.code.startsWith('E_'))) {
        e = mkErr('E_NETWORK', describeNet(e))
    }
    if (!e.step) {
        e.step = step
    }
    return e
}


//讀取回應本文字串, 設上限避免異常回應占用記憶體
async function readTextCapped(res, cap, req) {
    let chunks = []
    let n = 0
    if (res.body) {
        for await (let chunk of res.body) {
            n += chunk.length
            if (n > cap) {
                throw mkErr('E_MANIFEST_FORMAT', `manifest is invalid: larger than ${cap} bytes`, { step: 'manifest' })
            }
            chunks.push(Buffer.from(chunk))
            req.touch()
        }
    }
    return Buffer.concat(chunks).toString('utf8')
}


//fetchManifest, 取得並檢核清單, 取不到或格式不符即拋錯
async function fetchManifest(ctx) {
    let url = `${ctx.urlBase}${fnManifest}`
    let req = openReq(ctx)
    try {
        let res = await fetch(url, { signal: req.signal })
        if (!res.ok) {
            await dropBody(res)
            throw mkErr('E_MANIFEST_HTTP', `can not get ${url}: HTTP ${res.status} ${res.statusText}`.trim(), { status: res.status })
        }
        let text = await readTextCapped(res, 65536, req)
        try {
            return parseDlpManifest(text, fnExe)
        }
        catch (err) {
            err.message = `${url}: ${err.message}`
            throw err
        }
    }
    catch (err) {
        throw tagErr(err, req, 'manifest')
    }
    finally {
        req.close()
    }
}


//waitClose, 等寫入串流關閉, 最多等ms毫秒, 回傳是否已關閉
function waitClose(ws, ms) {
    if (ws.closed) {
        return Promise.resolve(true)
    }
    return new Promise((resolve) => {
        let timer = setTimeout(() => resolve(false), ms)
        ws.once('close', () => {
            clearTimeout(timer)
            resolve(true)
        })
    })
}


//fetchExe, 串流下載至暫存檔並同時計算SHA-256與大小, 相符才回傳, 不符拋錯(暫存檔由呼叫端清除)
//tmp為{fp,collided}: fp為暫存檔路徑; 因同名檔已存在而無法以排他方式建立時collided設為true, 該檔不屬於本次下載, 呼叫端不得刪除
async function fetchExe(ctx, spec, tmp) {
    let fpTmp = tmp.fp
    let url = `${ctx.urlBase}${fnExe}`
    let req = openReq(ctx)
    let ws = null
    let errFs = null
    try {
        let res = await fetch(url, { signal: req.signal })
        if (!res.ok) {
            await dropBody(res)
            throw mkErr('E_HTTP', `can not get ${url}: HTTP ${res.status} ${res.statusText}`.trim(), { status: res.status })
        }

        //回應宣告之大小與清單不同(且未經內容編碼)即不必下載, 常見於清單與exe因快取而不同步
        let cl = res.headers.get('content-length')
        let ce = res.headers.get('content-encoding')
        if (cl !== null && /^\d+$/.test(cl.trim()) && (!ce || ce.trim().toLowerCase() === 'identity') && Number(cl) !== spec.size) {
            await dropBody(res)
            throw mkErr('E_SIZE_MISMATCH', `size mismatch for ${fnExe}: expected ${spec.size} bytes, the server announces ${cl} bytes`, { step: 'verify' })
        }

        //串流寫入暫存檔並計算雜湊, 超過清單大小即中止, 不讓異常回應寫滿磁碟
        let hash = crypto.createHash('sha256')
        let size = 0
        let tr = new Transform({
            transform(chunk, enc, cb) {
                size += chunk.length
                if (size > spec.size) {
                    cb(mkErr('E_SIZE_MISMATCH', `size mismatch for ${fnExe}: expected ${spec.size} bytes, received more than that`, { step: 'verify' }))
                    return
                }
                hash.update(chunk)
                req.touch()
                cb(null, chunk)
            },
        })
        ws = ctx.fs.createWriteStream(fpTmp, { flags: 'wx' })
        ws.on('error', (err) => {

            //pipeline因他處錯誤銷毀ws時也會觸發error(同一個錯誤物件), 系統層檔案錯誤才帶syscall, 以此區分
            if (typeof err.syscall === 'string') {
                errFs = err
                if (err.code === 'EEXIST') {
                    tmp.collided = true
                }
            }

        })

        //pipeline帶入signal: 停滯或整體時間用盡時連同寫入端(含本文已讀完後等待寫出/關閉的階段)一併中止
        await pipeline(res.body ? Readable.fromWeb(res.body) : Readable.from([]), tr, ws, { signal: req.signal })

        //等檔案控制代碼關閉, 才能更名
        if (!(await waitClose(ws, 5000))) {
            throw mkErr('E_FS', `the temporary file "${fpTmp}" was not closed within 5s`, { step: 'download' })
        }

        //verify
        let sha256 = hash.digest('hex')
        if (size !== spec.size) {
            throw mkErr('E_SIZE_MISMATCH', `size mismatch for ${fnExe}: expected ${spec.size} bytes, got ${size} bytes (sha256 ${short(sha256)})`, { step: 'verify' })
        }
        if (sha256 !== spec.sha256) {
            throw mkErr('E_HASH_MISMATCH', `SHA-256 mismatch for ${fnExe}: expected ${short(spec.sha256)} (${spec.size} bytes), got ${short(sha256)} (${size} bytes)`, { step: 'verify' })
        }
    }
    catch (err) {

        //確保暫存檔之檔案控制代碼已關閉, 呼叫端才能刪除
        if (ws && !ws.closed) {
            ws.destroy()
            await waitClose(ws, 5000)
        }

        if (errFs) {
            throw mkErr('E_FS', `can not write "${fpTmp}": ${codeMsg(errFs)}`, { step: 'download', cause: errFs })
        }
        throw tagErr(err, req, 'download')
    }
    finally {
        req.close()
    }
}


//檔案內容是否即為清單所載(大小與SHA-256皆相符)
async function isExpected(ctx, fp, spec) {
    try {
        let st = ctx.fs.statSync(fp)
        if (!st.isFile() || st.size !== spec.size) {
            return false
        }
        let hash = crypto.createHash('sha256')
        for await (let chunk of ctx.fs.createReadStream(fp)) {
            hash.update(chunk)
        }
        return hash.digest('hex') === spec.sha256
    }
    catch (err) {
        return false
    }
}


//renameFinal, 暫存檔經驗證後更名為正式檔名; Windows下剛寫入之exe偶遭防毒掃描占用而更名失敗, 故重試;
//仍失敗但正式檔名已是清單所載內容(別的行程已完成同一下載)視為成功
async function renameFinal(ctx, fpTmp, fp, spec) {
    let lastErr = null
    for (let i = 1; i <= 5; i++) {
        try {
            ctx.fs.renameSync(fpTmp, fp)
            return
        }
        catch (err) {
            lastErr = err
            if (await isExpected(ctx, fp, spec)) {
                return
            }
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
                break
            }
            if (i < 5) {
                await sleep(Math.min(ctx.retryDelayMs, 200) * i)
            }
        }
    }
    throw mkErr('E_RENAME', `the verified file can not be renamed to "${fp}": ${codeMsg(lastErr)}`, { step: 'rename', cause: lastErr })
}


//removeTemp, 刪除暫存檔, 暫時性占用重試, 回傳最後的錯誤(成功回傳null), 由呼叫端如實呈現
async function removeTemp(ctx, fpTmp) {
    let lastErr = null
    for (let i = 1; i <= 3; i++) {
        try {
            ctx.fs.rmSync(fpTmp, { force: true })
            return null
        }
        catch (err) {
            lastErr = err
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
                break
            }
            if (i < 3) {
                await sleep(Math.min(ctx.retryDelayMs, 200) * i)
            }
        }
    }
    return lastErr
}


//attemptOnce, 一次完整嘗試: 取清單, 下載至暫存檔並驗證, 更名; 不論成敗皆清暫存檔, 正式檔名只在驗證通過後才被寫入
async function attemptOnce(ctx) {
    let tmp = { fp: `${ctx.fp}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.part`, collided: false }
    let errMain = null
    try {
        let spec = await fetchManifest(ctx)
        ctx.log(`downloading url[${ctx.urlBase}${fnExe}]...`, `to fp[${ctx.fp}]`, `version[${spec.version}]`)
        await fetchExe(ctx, spec, tmp)
        await renameFinal(ctx, tmp.fp, ctx.fp, spec)
    }
    catch (err) {
        errMain = err
    }

    //清暫存檔; 同名檔已存在而無法排他建立者(collided)不屬於本次下載, 不可刪除
    let errClean = tmp.collided ? null : await removeTemp(ctx, tmp.fp)
    if (errClean) {
        ctx.leftovers.push({ fp: tmp.fp, err: errClean })
        ctx.log(`warning: the temporary file "${tmp.fp}" could not be removed: ${errClean.message}`)
    }
    if (errMain) {
        throw errMain
    }
}


//isRetryable, 暫時性錯誤(含快取不同步造成之雜湊/大小不符)才重試, 格式錯誤,404等確定性錯誤與時間用盡不重試
function isRetryable(err) {
    if (['E_HASH_MISMATCH', 'E_SIZE_MISMATCH', 'E_NETWORK', 'E_TIMEOUT'].includes(err.code)) {
        return true
    }
    if (['E_HTTP', 'E_MANIFEST_HTTP'].includes(err.code)) {
        return err.status >= 500 || err.status === 408 || err.status === 429
    }
    return false
}


//hintOf, 依錯誤類別給可據以處置之建議
function hintOf(err, ctx) {
    let sync = `the manifest and the exe on the branch may be out of sync for a few minutes after an update (GitHub raw caches for about 5 minutes), or the file was damaged in transit; retry later and check proxy/antivirus`
    switch (err.code) {
    case 'E_HASH_MISMATCH':
    case 'E_SIZE_MISMATCH':
        return `hint: ${sync}. Nothing was installed.`
    case 'E_MANIFEST_FORMAT':
        return `hint: the manifest on the branch is malformed, report it to the maintainer; no unverified download is performed.`
    case 'E_MANIFEST_HTTP':
    case 'E_HTTP':
        if (err.status === 429) {
            return `hint: the server is limiting the request rate (HTTP 429), retry later; check that ${ctx.urlBase} is reachable.`
        }
        if (err.status === 408) {
            return `hint: the server timed out waiting for the request (HTTP 408), retry later; check the network/proxy.`
        }
        return `hint: ${err.status >= 500 ? 'the server has a temporary problem, retry later' : 'the file does not exist on the branch or access is denied, report it to the maintainer'}; check that ${ctx.urlBase} is reachable.`
    case 'E_NETWORK':
    case 'E_TIMEOUT':
        return `hint: check the network/proxy and retry later.`
    case 'E_TIMEOUT_TOTAL':
        return `hint: the connection is too slow, check the network and retry later.`
    case 'E_FS':
        return `hint: check the free disk space and the write permission of "${path.dirname(ctx.fp)}".`
    case 'E_RENAME':
        return `hint: ${fnExe} may be in use or locked by antivirus, close the programs using it and retry; the previous file (if any) was left untouched.`
    default:
        return ''
    }
}


/**
 * 自GitHub下載yt-dlp.exe並驗證完整性
 *
 * 先取同一分支之yt-dlp/manifest.json(含sha256與size)，再把yt-dlp.exe串流下載至同資料夾之暫存檔，
 * 下載同時計算SHA-256與大小，與清單相符才更名為yt-dlp.exe(覆蓋舊檔)，不符則刪暫存檔並失敗。
 * 取不到清單或清單格式不符即失敗，不退回未驗證之下載；任何失敗路徑皆不以新下載之未驗證或不完整內容取代yt-dlp.exe
 * (原有之舊檔原樣保留)，暫存檔刪不掉時於錯誤訊息如實說明；若某次嘗試之暫存檔刪不掉而之後嘗試成功，則下載成功，
 * 殘留之暫存檔只以log輸出warning。
 * 因GitHub raw有CDN快取，推送新exe後數分鐘內清單與exe可能不同步，故雜湊/大小不符與暫時性錯誤會間隔重試，
 * 每次重試前重新取清單，總嘗試次數與整體時間皆有上限。整體時間上限約束網路階段(含寫入暫存檔與其關閉)，
 * 驗證通過後之本機更名與清理退避另加至多約3秒，不計入。
 *
 * @private
 * @param {String} fdBase 輸入存放資料夾路徑字串，yt-dlp.exe落於其下
 * @param {Object} [opt={}] 輸入設定物件，預設{}，供測試注入
 * @param {String} [opt.urlBase] 輸入清單與執行檔所在網址資料夾字串，預設為GitHub master分支之yt-dlp/
 * @param {Number} [opt.maxAttempts=4] 輸入最多嘗試次數
 * @param {Number} [opt.retryDelayMs=20000] 輸入重試間隔基數(毫秒)，第n次重試前等待retryDelayMs*n
 * @param {Number} [opt.stallMs=30000] 輸入連續沒收到資料視為停滯之毫秒數
 * @param {Number} [opt.totalMs=600000] 輸入整體時間上限(毫秒)
 * @param {Object} [opt.fs] 輸入fs，預設node之fs
 * @param {Function} [opt.log] 輸入訊息輸出函式，預設console.log
 * @returns {Promise} 回傳Promise，resolve回傳yt-dlp.exe路徑，reject回傳Error，內含code(E_MANIFEST_HTTP,E_MANIFEST_FORMAT,E_HTTP,E_NETWORK,E_TIMEOUT,E_TIMEOUT_TOTAL,E_SIZE_MISMATCH,E_HASH_MISMATCH,E_FS,E_RENAME)、step、attempts
 */
async function downloadFiles(fdBase, opt = {}) {

    //check
    if (typeof fdBase !== 'string' || fdBase === '') {
        return Promise.reject(mkErr('E_ARG', 'w-dwload-dlp: fdBase is not an effective string', { step: 'argument', attempts: 0 }))
    }

    //ctx
    opt = opt || {}
    let urlBase = (typeof opt.urlBase === 'string' && opt.urlBase !== '') ? opt.urlBase : urlBaseDef
    if (!urlBase.endsWith('/')) {
        urlBase += '/'
    }
    let maxAttempts = Math.max(1, Math.floor(num(opt.maxAttempts, optDef.maxAttempts)))
    let ctx = {
        urlBase,
        fs: opt.fs || fs,
        log: (typeof opt.log === 'function') ? opt.log : console.log,
        retryDelayMs: num(opt.retryDelayMs, optDef.retryDelayMs),
        stallMs: num(opt.stallMs, optDef.stallMs) || optDef.stallMs,
        totalMs: num(opt.totalMs, optDef.totalMs) || optDef.totalMs,
        fp: path.join(fdBase, fnExe),
        leftovers: [],
        deadline: 0,
    }
    ctx.deadline = performance.now() + ctx.totalMs //用單調時計, 不受系統校時影響

    //mkdir
    try {
        ctx.fs.mkdirSync(fdBase, { recursive: true })
    }
    catch (err) {
        return Promise.reject(mkErr('E_FS', `w-dwload-dlp: can not create folder "${fdBase}": ${codeMsg(err)}\nhint: check the free disk space and the write permission of "${fdBase}".`, { step: 'prepare', attempts: 0, cause: err }))
    }

    //attempts
    let errLast = null
    let nAttempt = 0
    let noteStop = ''
    for (let i = 1; i <= maxAttempts; i++) {
        nAttempt = i
        try {
            await attemptOnce(ctx)
            return ctx.fp
        }
        catch (err) {
            errLast = err
        }
        if (!isRetryable(errLast)) {
            break
        }
        if (i >= maxAttempts) {
            break
        }
        let delay = ctx.retryDelayMs * i
        if (performance.now() + delay >= ctx.deadline) {
            noteStop = `retry stopped: waiting ${delay / 1000}s would exceed the total time budget of ${ctx.totalMs / 1000}s`
            break
        }
        ctx.log(`attempt ${i}/${maxAttempts} failed (${errLast.code}): ${errLast.message}; retry in ${delay / 1000}s`)
        await sleep(delay)
    }

    //final error, 帶出哪一步失敗, 預期與實際, 建議, 與刪不掉之暫存檔
    let lines = [`w-dwload-dlp: failed to download ${fnExe} (step: ${errLast.step || 'unknown'}, attempt ${nAttempt} of ${maxAttempts}): ${errLast.message}`]
    let hint = hintOf(errLast, ctx)
    if (hint) {
        lines.push(hint)
    }
    if (noteStop) {
        lines.push(noteStop)
    }
    for (let v of ctx.leftovers) {
        lines.push(`note: the temporary file "${v.fp}" could not be removed (${v.err.message}), it is not a usable ${fnExe}, remove it manually`)
    }
    let errNew = new Error(lines.join('\n'), { cause: errLast })
    errNew.code = errLast.code
    errNew.step = errLast.step
    errNew.attempts = nAttempt
    if (errLast.status !== undefined) {
        errNew.status = errLast.status
    }
    if (ctx.leftovers.length > 0) {
        errNew.cleanupError = ctx.leftovers[0].err
    }
    throw errNew
}


export default downloadFiles
