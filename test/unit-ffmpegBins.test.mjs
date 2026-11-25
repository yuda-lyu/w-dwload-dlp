import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'
import ensureBinsFfmpeg from 'w-ffmpeg/src/ensureBins.mjs'
import { createFfmpegProvider, FFMPEG_NAME, FFMPEG_PARTS, FFMPEG_EXTRACT_BATCHES, FFMPEG_TOTAL_MS, FFMPEG_LOCK_LIMIT_MS, FFMPEG_BUDGET_MS } from './tools/ffmpegBins.mjs'
import { summarizeTrace } from './tools/ffmpegTrace.mjs'


//規格: rulebook R6(測試取得ffmpeg.exe之集中、時限對齊下載預算、跨程序只下載一次) 與 外部執行檔之存放下載校驗與離線 §6 E5、T9「使用端:測試之首次取得集中於共用工具、時限對齊下載預算(不沿用180秒)」
//本檔不連網、不下載(取得函數以假函數注入); 真實之跨程序只下載一次以清空快取後之平行全套驗收(test/tools/ffmpegTrace.mjs彙總)

let fdt = path.resolve('./test/_tmp/unitFfmpegBins')
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

    it(`should count the parts and the extract batches the same as the manifest of w-ffmpeg, so the budget is derived from the real download units (E5: lock limit = units x totalMs)`, function() {
        //規格: 鎖等候上限依下載次數(分片數)與解壓批數推得; 清單變動(分片數改變)時本案紅, 提醒更新FFMPEG_PARTS
        assert.ok(entry !== undefined, 'w-ffmpeg manifest has no ffmpeg.exe')
        assert.ok(Array.isArray(entry.parts), 'ffmpeg.exe is no longer a split archive; revisit FFMPEG_PARTS and the budget')
        assert.strict.equal(entry.parts.length, FFMPEG_PARTS)
        assert.strict.equal(entry.assembled.type, 'zip') //zip單一成員(extract.member)為1批
        assert.strict.equal(typeof entry.extract.member, 'string')
        assert.strict.equal(FFMPEG_EXTRACT_BATCHES, 1)
    })

    it(`should give the hook a time limit above the lock wait limit of fsEnsureBins and far above the global 180 seconds, within the timer maximum (R6: align the limit with the download budget)`, function() {
        //規格: 該處之時限對齊下載預算(不沿用180秒); 須大於wsemi之鎖等候上限(逾上限由fsEnsureBins以E_LOCK_TIMEOUT失敗, 而非先被mocha逾時掩蓋)
        let expected = entry.parts.length * FFMPEG_TOTAL_MS + 1 * (FFMPEG_TOTAL_MS + 5000) + Math.min(FFMPEG_TOTAL_MS, 60000) //無鏡像時: 下載次數×totalMs＋解壓批數×(totalMs＋5秒)＋寬裕(totalMs與60秒之小者)
        assert.strict.equal(FFMPEG_LOCK_LIMIT_MS, expected)
        assert.strict.equal(FFMPEG_BUDGET_MS > FFMPEG_LOCK_LIMIT_MS, true)
        assert.strict.equal(FFMPEG_BUDGET_MS > 180000 * 5, true)
        assert.strict.equal(FFMPEG_BUDGET_MS <= 2147483647, true)
        assert.strict.equal(FFMPEG_TOTAL_MS > 0 && FFMPEG_TOTAL_MS < 600000, true) //收緊於預設之10分鐘, 使最壞預算不致逾1小時
    })

    it(`should equal the hold limit that the real fsEnsureBins records in the lock owner file while it gets ffmpeg.exe (black box: a stalled fetch keeps the lock held)`, async function() {
        //規格: 時限對齊下載預算; FFMPEG_LOCK_LIMIT_MS須與wsemi實際記錄於鎖之持有上限(owner.json之limitMs)一致, 不以實作算式之複本自證(wsemi改KILL_WAIT_MS或下載次數時本案紅)
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
        let p = ensureBinsFfmpeg({ names: FFMPEG_NAME, cacheDir, mirror: '', offline: false, fetch: fetchStub, totalMs: FFMPEG_TOTAL_MS, maxAttempts: 1, retryDelayMs: 1 })
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
        assert.strict.equal(rec.limitMs, FFMPEG_LOCK_LIMIT_MS)
        assert.strict.equal(rec.pid, process.pid)
    })

    it(`should reach fsEnsureBins with the cross-process lock: wsemi 1.9.75 or later is the single hoisted copy used by w-ffmpeg/src/ensureBins.mjs (E5)`, function() {
        //規格: 取得函數須為具跨程序鎖者(wsemi 1.9.75起); w-ffmpeg 1.0.60之dist內嵌舊版wsemi而無鎖, 故本工具取其深層入口src/ensureBins.mjs(經頂層wsemi)
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        assert.strict.equal(atLeast(verOf(pkg.dependencies.wsemi), [1, 9, 75]), true, pkg.dependencies.wsemi)
        let dirWsemi = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBins.mjs'))), '..')
        let installed = JSON.parse(fs.readFileSync(path.join(dirWsemi, 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(verOf(installed), [1, 9, 75]), true, installed)
        assert.strict.equal(fs.existsSync(path.join(dirFf, 'node_modules', 'wsemi')), false, 'w-ffmpeg has its own nested wsemi (not the single hoisted copy)')
        let srcEnsure = fs.readFileSync(path.join(dirFf, 'src', 'ensureBins.mjs'), 'utf8')
        assert.strict.equal(srcEnsure.includes(`from 'wsemi/src/fsEnsureBins.mjs'`), true)
        let core = fs.readFileSync(path.join(dirWsemi, 'src', 'fsEnsureBinsCore.mjs'), 'utf8')
        assert.strict.equal(core.includes('E_LOCK_TIMEOUT') && core.includes('lock-wait'), true, 'the installed wsemi has no cross-process lock')
        //本工具取的是該深層入口, 而非公開入口(其dist內嵌舊版wsemi、無鎖)
        let srcTool = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'ffmpegBins.mjs'), 'utf8')
        assert.strict.equal(/^import \w+ from 'w-ffmpeg\/src\/ensureBins\.mjs'$/m.test(srcTool), true)
        assert.strict.equal(/from 'w-ffmpeg'/.test(srcTool), false)
    })

    it(`should call the injected ensureBins once with names, the totalMs and an onTrace, and resolve the path of ffmpeg.exe; concurrent calls share the one call`, async function() {
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
        assert.strict.equal(calls[0].totalMs, FFMPEG_TOTAL_MS)
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
