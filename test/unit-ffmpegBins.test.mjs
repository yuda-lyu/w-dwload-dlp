import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import WFfmpeg from 'w-ffmpeg'
import * as ffTool from './tools/ffmpegBins.mjs'
import { summarizeTrace } from './tools/ffmpegTrace.mjs'


//規格: rulebook R6(測試取得ffmpeg.exe之集中、時限以函式庫之預算函式求得、跨程序只下載一次) 與 外部執行檔之存放下載校驗與離線 §6 E5(含E5-3)、T9「使用端:測試之首次取得集中於共用工具、時限對齊下載預算(不沿用180秒)」
//本檔不連網、不下載(取得函數以假函數注入, 或以停住之假fetch取得鎖後讓其失敗); 真實之跨程序只下載一次以清空快取後之平行全套驗收(test/tools/ffmpegTrace.mjs彙總)

let { createFfmpegProvider, calcFfmpegLockLimitMs, FFMPEG_NAME, FFMPEG_PARTS, FFMPEG_LOCK_LIMIT_MS, FFMPEG_BUDGET_MS } = ffTool

let fdt = path.resolve('./test/_tmp/unitFfmpegBins')
let dirTest = path.dirname(fileURLToPath(import.meta.url))
let require = createRequire(import.meta.url)
let verOf = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((v) => parseInt(v, 10))
let atLeast = (a, b) => {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) {
            return a[i] > b[i]
        }
    }
    return true
}

//DEFAULT_TOTAL_MS, wsemi之fsEnsureBins與fsEnsureBinsBudget文件載明之opt.totalMs預設值(每檔下載之整體時間上限); 傳給取得函數之每檔上限不得短於它(未傳即為預設)
let DEFAULT_TOTAL_MS = 600000


describe(`ffmpegBins (the single point of getting ffmpeg.exe in tests, R6)`, function() {

    before(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
    })
    after(function() {
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })

    let dirFf = path.dirname(require.resolve('w-ffmpeg/package.json'))
    let manifest = JSON.parse(fs.readFileSync(path.join(dirFf, 'bin', 'manifest.json'), 'utf8'))
    let entry = manifest.files.find((v) => v.name === FFMPEG_NAME)

    it(`should count the parts the same as the manifest of w-ffmpeg, so the trace summary expects each real download unit once (E5)`, function() {
        //規格: 事件彙總(ffmpegTrace)須見到全部分片各下載1次; 清單變動(分片數改變)時本案紅, 提醒更新FFMPEG_PARTS(預算已不依賴它, 由fsEnsureBinsBudget讀清單求得)
        assert.ok(entry !== undefined, 'w-ffmpeg manifest has no ffmpeg.exe')
        assert.ok(Array.isArray(entry.parts), 'ffmpeg.exe is no longer a split archive; revisit FFMPEG_PARTS and the trace summary')
        assert.strict.equal(entry.parts.length, FFMPEG_PARTS)
    })

    it(`should give the hook twice the lock limit of fsEnsureBins (worst case of a concurrent first getting), within the timer maximum and far above the global 180 seconds (E5-3, R6)`, function() {
        //規格: E5-3 首次取得之before時限依fsEnsureBinsBudget求得, 並行時最壞約為兩倍(先等他方、他方失敗才自行取得), 建議取兩倍; 須大於鎖等候上限(逾上限由fsEnsureBins以E_LOCK_TIMEOUT失敗, 而非先被mocha逾時掩蓋)
        assert.strict.equal(typeof calcFfmpegLockLimitMs, 'function', 'the tool has no calcFfmpegLockLimitMs (the budget is not derived from fsEnsureBinsBudget)')
        assert.strict.equal(FFMPEG_LOCK_LIMIT_MS, calcFfmpegLockLimitMs()) //常數即以預設環境(W_BIN_MIRROR、W_BIN_OFFLINE)呼叫該函數之值
        assert.strict.equal(FFMPEG_BUDGET_MS, 2 * FFMPEG_LOCK_LIMIT_MS)
        assert.strict.equal(FFMPEG_BUDGET_MS > FFMPEG_LOCK_LIMIT_MS, true)
        assert.strict.equal(FFMPEG_BUDGET_MS > 180000 * 5, true)
        assert.strict.equal(FFMPEG_BUDGET_MS <= 2147483647, true)
    })

    it(`should derive the lock limit from the manifest of w-ffmpeg by the library function, not below one default per-file limit for each part, and add the mirror when one is used (E5-3)`, function() {
        //規格: 預算以函式庫之預算函式求得, 不自寫算式; 每個下載單位(分片)至少含一個預設之每檔上限(totalMs預設600000)
        let base = { mirror: '', offline: false }
        let v0 = calcFfmpegLockLimitMs(base)
        assert.strict.equal(v0 >= entry.parts.length * DEFAULT_TOTAL_MS, true, `${v0}`)
        //使用鏡像者每個來源另加1次(先試鏡像): 預算須隨環境之鏡像增加, 不得固定
        let v1 = calcFfmpegLockLimitMs({ mirror: path.join(fdt, 'mirror-not-used'), offline: false })
        assert.strict.equal(v1 > v0, true, `${v1} ${v0}`)
        //每檔上限(totalMs)給大則預算隨之增加, 即預算確實由totalMs與清單推得(非常數)
        let v2 = calcFfmpegLockLimitMs({ ...base, totalMs: DEFAULT_TOTAL_MS * 2 })
        assert.strict.equal(v2 > v0, true, `${v2} ${v0}`)
    })

    it(`should equal the hold limit that the real fsEnsureBins of the public entry records in the lock owner file while it gets ffmpeg.exe, and the hook limit is at least twice of it (black box: a stalled fetch keeps the lock held)`, async function() {
        //規格: 時限對齊下載預算; 工具之預算須與經公開入口WFfmpeg.ensureBins之fsEnsureBins實際記錄於鎖之持有上限(owner.json之limitMs)一致, 不以實作算式之複本自證(wsemi改算式或清單改下載次數時本案紅);
        //經公開入口取得, 一併證明公開入口已具跨程序鎖(w-ffmpeg 1.0.61起之dist內嵌wsemi 1.9.75以上; 1.0.60無鎖則無.lock-資料夾而本案紅)
        let cacheDir = path.join(fdt, 'cache-lock')
        fs.mkdirSync(cacheDir, { recursive: true })
        let rejects = []
        let onFirst = null
        let firstCall = new Promise((resolve) => {
            onFirst = resolve
        })
        let fetchStub = () => {
            onFirst()
            return new Promise((resolve, reject) => { // eslint-disable-line no-unused-vars
                rejects.push(reject)
            })
        }
        let p = WFfmpeg.ensureBins({ names: FFMPEG_NAME, cacheDir, mirror: '', offline: false, fetch: fetchStub, maxAttempts: 1, retryDelayMs: 1 })
            .then(() => null, (e) => e)
        await firstCall //已開始下載: 鎖已建立且owner.json已寫入
        let owners = fs.readdirSync(cacheDir).filter((v) => v.startsWith('.lock-')).map((v) => path.join(cacheDir, v, 'owner.json')).filter((v) => fs.existsSync(v))
        assert.strict.equal(owners.length, 1)
        let rec = JSON.parse(fs.readFileSync(owners[0], 'utf8'))
        for (let reject of rejects) {
            reject(Object.assign(new Error('stub network down'), { code: 'ECONNRESET' }))
        }
        let err = await p
        assert.strict.equal(err !== null && typeof err.code === 'string', true) //取不到時以帶code之錯誤失敗, 且鎖已釋放
        assert.strict.equal(fs.readdirSync(cacheDir).filter((v) => v.startsWith('.lock-')).length, 0)
        assert.strict.equal(rec.pid, process.pid)
        assert.strict.equal(rec.limitMs >= FFMPEG_PARTS * DEFAULT_TOTAL_MS, true) //未傳totalMs: 每個分片至少一個預設之每檔上限
        assert.strict.equal(FFMPEG_BUDGET_MS >= 2 * rec.limitMs, true, `${FFMPEG_BUDGET_MS} ${rec.limitMs}`) //env設鏡像時工具之預算只會更大
        assert.strict.equal(rec.limitMs, calcFfmpegLockLimitMs({ mirror: '', offline: false })) //預算函式之值即鎖實際記錄之上限
    })

    it(`should reach the cross-process lock through the public entry of w-ffmpeg: the hoisted wsemi has fsEnsureBinsBudget and the dist of w-ffmpeg has the lock code (E5, E5-3)`, function() {
        //規格: 取得函數須為具跨程序鎖者; w-ffmpeg 1.0.60之dist內嵌舊版wsemi而無鎖, 1.0.61起之dist內嵌wsemi 1.9.75以上而有鎖, 故本工具取公開入口; 預算函式fsEnsureBinsBudget於wsemi 1.9.76起
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        assert.strict.equal(atLeast(verOf(pkg.dependencies.wsemi), [1, 9, 76]), true, pkg.dependencies.wsemi)
        assert.strict.equal(atLeast(verOf(pkg.dependencies['w-ffmpeg']), [1, 0, 61]), true, pkg.dependencies['w-ffmpeg'])
        let dirWsemi = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBinsBudget.mjs'))), '..')
        let installed = JSON.parse(fs.readFileSync(path.join(dirWsemi, 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(verOf(installed), [1, 9, 76]), true, installed)
        let installedFf = JSON.parse(fs.readFileSync(path.join(dirFf, 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(verOf(installedFf), [1, 0, 61]), true, installedFf)
        let dist = fs.readFileSync(require.resolve('w-ffmpeg'), 'utf8')
        assert.strict.equal(dist.includes('E_LOCK_TIMEOUT') && dist.includes('lock-wait'), true, 'the dist of the installed w-ffmpeg has no cross-process lock')
    })

    it(`should get ffmpeg.exe through the public entry WFfmpeg.ensureBins, with names and onTrace and without a per-file limit shorter than the default of fsEnsureBins (R6, spec E5-3)`, async function() {
        //規格: 取得走公開入口(以替換WFfmpeg.ensureBins為證: 被呼叫者即工具所用者); 傳給下載函式之每檔上限(totalMs)不短於其預設(未傳即預設)
        let bak = WFfmpeg.ensureBins
        let bakOffline = process.env.W_BIN_OFFLINE
        let calls = []
        WFfmpeg.ensureBins = async(opt) => {
            calls.push(opt)
            return { [FFMPEG_NAME]: 'Z:\\fake\\ffmpeg.exe' }
        }
        process.env.W_BIN_OFFLINE = '1' //保險: 即使工具改走他入口而未被替換, 亦只讀快取而不連網下載
        let r = null
        try {
            r = await createFfmpegProvider({ env: {} }).get()
        }
        finally {
            WFfmpeg.ensureBins = bak
            if (bakOffline === undefined) {
                delete process.env.W_BIN_OFFLINE
            }
            else {
                process.env.W_BIN_OFFLINE = bakOffline
            }
        }
        assert.strict.equal(calls.length, 1, 'the tool did not call WFfmpeg.ensureBins of the public entry')
        assert.strict.equal(r, 'Z:\\fake\\ffmpeg.exe')
        assert.strict.equal(calls[0].names, FFMPEG_NAME)
        assert.strict.equal(typeof calls[0].onTrace, 'function')
        assert.strict.deepStrictEqual(Object.keys(calls[0]).sort(), ['names', 'onTrace']) //只傳這兩項: 預算(calcFfmpegLockLimitMs)即依names、環境變數與預設totalMs求得, 多傳cacheDir、mirror、offline、totalMs者預算與實際鎖上限會不一致
        assert.strict.equal(calls[0].totalMs, undefined, `${DEFAULT_TOTAL_MS}`) //不傳即取fsEnsureBins之預設(DEFAULT_TOTAL_MS), 每檔上限不短於其預設, 與預算之算式一致
    })

    it(`should not import a deep entry of w-ffmpeg in any test file or test tool, only the public entry (R6)`, function() {
        //規格: 取得ffmpeg.exe只走w-ffmpeg之公開入口; 本套件自己之src/ensureBins.mjs(../src/)不在此列
        let re = /^(?:import|export)\b[^\n]*['"]w-ffmpeg\/|\bimport\(\s*['"]w-ffmpeg\//m //靜態匯入／再匯出與動態匯入(不含字串中之說明文字, 如他檔之正規表示式)
        let files = []
        for (let d of [dirTest, path.join(dirTest, 'tools')]) {
            for (let v of fs.readdirSync(d)) {
                if (v.endsWith('.mjs') && v !== path.basename(fileURLToPath(import.meta.url))) {
                    files.push(path.join(d, v))
                }
            }
        }
        assert.strict.equal(files.length > 10, true) //掃描範圍確實涵蓋測試檔與工具
        assert.strict.equal(files.some((v) => path.basename(v) === 'ffmpegBins.mjs'), true)
        let hits = files.filter((v) => re.test(fs.readFileSync(v, 'utf8'))).map((v) => path.basename(v))
        assert.strict.deepStrictEqual(hits, [])
        let srcTool = fs.readFileSync(path.join(dirTest, 'tools', 'ffmpegBins.mjs'), 'utf8')
        assert.strict.equal(/^import \w+ from 'w-ffmpeg'$/m.test(srcTool), true)
    })

    it(`should call the injected ensureBins once with names and an onTrace, and resolve the path of ffmpeg.exe; concurrent calls share the one call`, async function() {
        let calls = []
        let p = createFfmpegProvider({
            env: {},
            ensureBins: async(opt) => {
                calls.push(opt)
                await new Promise((resolve) => setImmediate(resolve))
                return { [FFMPEG_NAME]: 'Z:\\fake\\ffmpeg.exe' }
            },
        })
        let rs = await Promise.all([p.get(), p.get(), p.get()])
        assert.strict.deepStrictEqual(rs, ['Z:\\fake\\ffmpeg.exe', 'Z:\\fake\\ffmpeg.exe', 'Z:\\fake\\ffmpeg.exe'])
        assert.strict.equal(await p.get(), 'Z:\\fake\\ffmpeg.exe') //之後仍共用
        assert.strict.equal(calls.length, 1)
        assert.strict.equal(calls[0].names, FFMPEG_NAME)
        assert.strict.equal(calls[0].totalMs, undefined)
        assert.strict.equal(typeof calls[0].onTrace, 'function')
    })

    it(`should not remember a failure: the next call asks again and a later success is returned`, async function() {
        let n = 0
        let p = createFfmpegProvider({
            env: {},
            ensureBins: async() => {
                n++
                if (n === 1) {
                    let err = new Error('fake failure')
                    err.code = 'E_NETWORK'
                    throw err
                }
                return { [FFMPEG_NAME]: 'Z:\\fake\\ffmpeg.exe' }
            },
        })
        let err1 = await p.get().then(() => null, (e) => e)
        assert.strict.equal(err1.code, 'E_NETWORK')
        assert.strict.equal(await p.get(), 'Z:\\fake\\ffmpeg.exe')
        assert.strict.equal(n, 2)
    })

    it(`should append one JSON line per event with only the whitelisted fields and the pid when W_DLP_TEST_TRACE is set, and write nothing when it is not set`, async function() {
        let fpLog = path.join(fdt, 'trace.jsonl')
        let evs = [
            { type: 'download', name: FFMPEG_NAME, file: 'bin/ffmpeg.zip.001', secret: 'must-not-be-written' },
            { type: 'lock-wait', name: FFMPEG_NAME, phase: 'start', hit: null },
            { type: 'cache', name: FFMPEG_NAME, hit: true },
            { type: 'settle', ok: true },
        ]
        let mk = (env) => createFfmpegProvider({
            env,
            ensureBins: async(opt) => {
                for (let ev of evs) {
                    opt.onTrace(Object.freeze({ ...ev }))
                }
                return { [FFMPEG_NAME]: 'Z:\\fake\\ffmpeg.exe' }
            },
        })
        await mk({}).get()
        assert.strict.equal(fs.existsSync(fpLog), false)
        await mk({ W_DLP_TEST_TRACE: fpLog }).get()
        let lines = fs.readFileSync(fpLog, 'utf8').split('\n').filter((v) => v !== '')
        assert.strict.equal(lines.length, 4)
        let rows = lines.map((v) => JSON.parse(v))
        assert.strict.deepStrictEqual(rows.map((v) => v.type), ['download', 'lock-wait', 'cache', 'settle'])
        assert.strict.equal(rows.every((v) => v.pid === process.pid && typeof v.t === 'number'), true)
        assert.strict.equal(rows[0].file, 'bin/ffmpeg.zip.001')
        assert.strict.equal(rows[1].phase, 'start')
        assert.strict.equal(rows[1].hit, null)
        assert.strict.equal(rows[2].hit, true)
        assert.strict.equal(rows[3].ok, true)
        assert.strict.equal(rows.some((v) => 'secret' in v), false)
    })

    it(`should not let a failure of the trace log (folder missing) disturb the getting: the log is only for the acceptance`, async function() {
        let p = createFfmpegProvider({
            env: { W_DLP_TEST_TRACE: path.join(fdt, 'no-such-dir', 'trace.jsonl') },
            ensureBins: async(opt) => {
                opt.onTrace(Object.freeze({ type: 'download', file: 'bin/ffmpeg.zip.001' }))
                return { [FFMPEG_NAME]: 'Z:\\fake\\ffmpeg.exe' }
            },
        })
        assert.strict.equal(await p.get(), 'Z:\\fake\\ffmpeg.exe')
    })

    it(`should summarize a trace so that the acceptance can tell one download from several: each part downloaded once by one process, the others waiting for the lock`, function() {
        let part = (n) => `bin/ffmpeg.zip.00${n}`
        let ev = (o) => JSON.stringify(o)
        let good = [
            ev({ pid: 11, type: 'download', file: part(1) }), ev({ pid: 11, type: 'download', file: part(2) }), ev({ pid: 11, type: 'download', file: part(3) }),
            ev({ pid: 11, type: 'download', file: part(4) }), ev({ pid: 11, type: 'download', file: part(5) }),
            ev({ pid: 22, type: 'lock-wait', phase: 'start' }), ev({ pid: 22, type: 'lock-wait', phase: 'end', hit: true }), ev({ pid: 22, type: 'cache', hit: true }),
            '', 'not json',
        ]
        let r = summarizeTrace(good)
        assert.strict.equal(r.ok, true)
        assert.strict.deepStrictEqual(r.downloaders, [11])
        assert.strict.deepStrictEqual(r.waiters, [22])
        assert.strict.deepStrictEqual(r.cacheHitPids, [22])
        assert.strict.equal(r.bad, 1)
        assert.strict.equal(Object.keys(r.downloadsByFile).length, 5)
        //兩個程序各自下載同一分片(無鎖之形狀): 不ok
        let dup = [...good, ev({ pid: 33, type: 'download', file: part(1) })]
        let r2 = summarizeTrace(dup)
        assert.strict.equal(r2.ok, false)
        assert.strict.equal(r2.downloadsByFile[part(1)], 2)
        assert.strict.deepStrictEqual(r2.downloaders, [11, 33])
        //無任何下載(空紀錄)不ok, 以免空紀錄被當成通過; 只見到部分分片之紀錄亦不ok(須見到全部分片各下載1次)
        assert.strict.equal(summarizeTrace([]).ok, false)
        assert.strict.equal(summarizeTrace([ev({ pid: 11, type: 'download', file: part(1) })]).ok, false)
        assert.strict.equal(summarizeTrace(good.slice(0, 4)).ok, false) //4個分片
    })

    it(`should work as a command: print the summary as JSON, exit 0 when each of the parts was downloaded once, 1 when not, 2 without an argument`, function() {
        let part = (n) => `bin/ffmpeg.zip.00${n}`
        let lines = [1, 2, 3, 4, 5].map((n) => JSON.stringify({ pid: 11, type: 'download', file: part(n) }))
        let fpOk = path.join(fdt, 'cli-ok.jsonl')
        let fpDup = path.join(fdt, 'cli-dup.jsonl')
        fs.writeFileSync(fpOk, `${lines.join('\n')}\n`)
        fs.writeFileSync(fpDup, `${[...lines, JSON.stringify({ pid: 22, type: 'download', file: part(3) })].join('\n')}\n`)
        let run = (...args) => spawnSync(process.execPath, ['test/tools/ffmpegTrace.mjs', ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 })
        let r1 = run(fpOk)
        assert.strict.equal(r1.status, 0, r1.stderr)
        assert.strict.equal(JSON.parse(r1.stdout).ok, true)
        let r2 = run(fpDup)
        assert.strict.equal(r2.status, 1, r2.stderr)
        assert.strict.equal(JSON.parse(r2.stdout).downloadsByFile[part(3)], 2)
        assert.strict.equal(run().status, 2)
        assert.strict.notEqual(run(path.join(fdt, 'no-such.jsonl')).status, 0) //讀不到紀錄檔不得以0結束
    })

})
