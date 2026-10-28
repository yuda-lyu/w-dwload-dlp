import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { createFakeRun } from './tools/fakeRun.mjs'


function isWindows() {
    return process.platform === 'win32'
}


const ms1h = 60 * 60 * 1000


//規格: 每次呼叫用自己之工作夾os.tmpdir()/w-dwload-dlp/<唯一id>/, 下載、合併、轉檔之中介檔皆在其內, 結束時(成功或失敗)刪除該夾, 結果檔已交給fp;
//不再有opt.clean(共用下載夾且預先清除, 併行呼叫會互相清掉對方下載中之檔); 每次呼叫開始時刪除os.tmpdir()/w-dwload-dlp/下修改時間逾24小時之工作夾(崩潰殘留), 只刪符合工作夾命名之資料夾, 刪除失敗忽略
//以假yt-dlp(test/tools/fakeDlp.mjs)真的起子行程並寫真的檔案, 不連外網; 以環境變數TEMP/TMP把os.tmpdir()導到test/_tmp/workFolder/tmp, 不碰使用者之暫存夾
describe(`work folder of each call`, function() {
    this.timeout(180000)

    let fr = createFakeRun('workFolder')
    let { fdt, spawnCalls, setEnv } = fr
    let fdTmp = path.join(fdt, 'tmp')
    let fdRoot = path.join(fdTmp, 'w-dwload-dlp')
    let fdOut = path.join(fdt, 'out')
    let fdGate = path.join(fdt, 'gate')
    let fpGate = path.join(fdGate, 'g')
    let reWork = /^\d{14}-[0-9A-Za-z]{6}$/
    let tmpBak = {}

    before(fr.install)
    before(function() {
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cache'), W_BIN_MIRROR: fr.mirror, W_BIN_OFFLINE: '1' })
        for (let k of ['TEMP', 'TMP']) {
            tmpBak[k] = process.env[k]
            process.env[k] = fdTmp
        }
        fs.mkdirSync(fdTmp, { recursive: true })
        assert.strict.equal(path.resolve(os.tmpdir()).toLowerCase(), path.resolve(fdTmp).toLowerCase()) //os.tmpdir()確實已導向測試夾
    })
    after(function() {
        for (let k of ['TEMP', 'TMP']) {
            if (tmpBak[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = tmpBak[k]
            }
        }
    })
    after(fr.uninstall)
    beforeEach(fr.reset)
    beforeEach(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
        fs.rmSync(fdOut, { recursive: true, force: true })
        fs.rmSync(fdGate, { recursive: true, force: true })
        fs.mkdirSync(fdOut, { recursive: true })
        fs.mkdirSync(fdGate, { recursive: true })
    })
    //running, 停在閘門之呼叫; 案例中途斷言失敗時, 放行並等其結束, 避免假yt-dlp與未處理之rejection殘留到下一案
    let running = []
    afterEach(async function() {
        for (let name of ['a', 'b', 's']) {
            release(name)
        }
        await Promise.allSettled(running)
        running = []
        delete process.env.FAKE_DLP_GATE
    })

    //workOf, 該次呼叫啟動yt-dlp時之輸出資料夾(-o之上層), 即該次呼叫之工作夾
    let workOf = (url) => {
        let c = spawnCalls.find((v) => v.args[0] === url)
        assert.strict.notEqual(c, undefined, `yt-dlp was not started for ${url}`)
        return path.dirname(path.resolve(c.args[c.args.indexOf('-o') + 1]))
    }

    let listRoot = () => {
        return fs.existsSync(fdRoot) ? fs.readdirSync(fdRoot).sort() : []
    }

    let sameDir = (a, b) => {
        return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    }

    //gated, 令假yt-dlp寫完.part後停在閘門, 以name(url末段)放行
    let gated = () => {
        process.env.FAKE_DLP_GATE = fpGate
    }
    let release = (name) => {
        fs.writeFileSync(`${fpGate}-${name}`, '')
    }
    let waitStarted = async(names) => {
        let tEnd = Date.now() + 30000
        while (!names.every((name) => fs.existsSync(`${fpGate}-${name}.started`))) {
            if (Date.now() > tEnd) {
                throw new Error(`fake yt-dlp did not start: ${names}`)
            }
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
    }

    //seed, 在工作夾上層夾建立一個指定名稱之殘留夾(或檔), 並把修改時間設為ageMs之前
    let seed = (name, ageMs, { asFile = false } = {}) => {
        let p = path.join(fdRoot, name)
        fs.mkdirSync(fdRoot, { recursive: true })
        if (asFile) {
            fs.writeFileSync(p, 'LEFTOVER')
        }
        else {
            fs.mkdirSync(path.join(p, 'sub'), { recursive: true })
            fs.writeFileSync(path.join(p, 'sub', 'x.mp4'), 'LEFTOVER')
        }
        let t = new Date(Date.now() - ageMs)
        fs.utimesSync(p, t, t) //須在建立內容之後設定, 否則資料夾修改時間又被更新
        return p
    }

    let urlOf = (name) => `https://example.invalid/${name}`

    it(`should give each of two concurrent calls its own work folder under the temporary folder, and delete only its own when it ends, so the other call keeps its download in progress and gets a complete output (R1)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        gated()
        let fpA = path.join(fdOut, 'a.mp4')
        let fpB = path.join(fdOut, 'b.mp4')
        let doneB = false
        let pA = WDwloadDlp(urlOf('a'), fpA)
        let pB = WDwloadDlp(urlOf('b'), fpB).then((r) => {
            doneB = true
            return r
        })
        running.push(pA, pB)
        await waitStarted(['a', 'b']) //兩個yt-dlp皆已在執行且各自有下載中之檔

        //各自之工作夾: 互不相同, 在<os.tmpdir()>/w-dwload-dlp/下, 名稱為<14位時間>-<6碼id>
        let wA = workOf(urlOf('a'))
        let wB = workOf(urlOf('b'))
        assert.strict.equal(sameDir(wA, wB), false, `${wA} ${wB}`)
        for (let w of [wA, wB]) {
            assert.strict.equal(sameDir(path.dirname(w), fdRoot), true, w)
            assert.strict.equal(reWork.test(path.basename(w)), true, w)
            let names = fs.readdirSync(w)
            assert.strict.equal(names.length, 1, names.join(',')) //下載中之檔在自己之工作夾內
            assert.strict.equal(names[0].endsWith('.mp4.part'), true, names[0])
            assert.strict.equal(fs.readFileSync(path.join(w, names[0]), 'utf8'), 'FAKE-PART')
        }
        assert.strict.equal(listRoot().length, 2)

        //A先結束: A之成功輸出完整, A之工作夾已刪; B之工作夾與其下載中之檔不受影響
        release('a')
        assert.strict.equal(await pA, 'ok')
        assert.strict.equal(fs.readFileSync(fpA, 'utf8'), `FAKE-MP4 ${urlOf('a')}`)
        assert.strict.equal(fs.existsSync(wA), false)
        assert.strict.equal(fs.existsSync(wB), true)
        let namesB = fs.readdirSync(wB)
        assert.strict.equal(namesB.length, 1, namesB.join(','))
        assert.strict.equal(fs.readFileSync(path.join(wB, namesB[0]), 'utf8'), 'FAKE-PART') //B下載中之檔未被A清掉
        assert.strict.equal(doneB, false)

        //B再結束
        release('b')
        assert.strict.equal(await pB, 'ok')
        assert.strict.equal(fs.readFileSync(fpB, 'utf8'), `FAKE-MP4 ${urlOf('b')}`)
        assert.strict.equal(fs.existsSync(wB), false)
        assert.strict.deepStrictEqual(listRoot(), []) //上層夾內不留任何東西
    })

    //mkBlockedFp, fp之上層是檔案而非資料夾, 複製必失敗(fp之上層不存在時fsCopyFile會自動建立)
    let mkBlockedFp = () => {
        fs.writeFileSync(path.join(fdOut, 'blocker'), 'x')
        return path.join(fdOut, 'blocker', 'f3.mp4')
    }

    for (let c of [
        { title: 'yt-dlp fails', name: 'fail', code: 'dlpFailed', fp: () => path.join(fdOut, 'f1.mp4') },
        { title: 'yt-dlp ends without the output file', name: 'nofile', code: 'outputNotFound', fp: () => path.join(fdOut, 'f2.mp4') },
        { title: 'the output can not be copied to fp', name: 'v', code: 'copyFailed', fp: mkBlockedFp },
    ]) {
        it(`should delete the work folder with everything in it when the call is rejected because ${c.title} (R1)`, async function() {
            if (!isWindows()) {
                this.skip()
            }
            let fp = c.fp()
            let err = await WDwloadDlp(urlOf(c.name), fp).catch((e) => e)
            assert.strict.equal(typeof err, 'string') //既有之reject型態為字串
            assert.strict.equal(err.startsWith(`[${c.code}]`), true, err)
            assert.strict.equal(spawnCalls.length, 1)
            let w = workOf(urlOf(c.name))
            assert.strict.equal(sameDir(path.dirname(w), fdRoot), true, w)
            assert.strict.equal(fs.existsSync(w), false, `${w} should have been deleted`)
            assert.strict.deepStrictEqual(listRoot(), [])
            assert.strict.equal(fs.existsSync(fp), false) //沒有交付輸出
        })
    }

    it(`should not create a work folder when the call is rejected before yt-dlp is prepared (R1)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let err = await WDwloadDlp('', path.join(fdOut, 'e1.mp4')).catch((e) => e)
        assert.strict.equal(err, '[invalidUrl] url is not an effective string')
        fr.ffMode = 'fail'
        err = await WDwloadDlp(urlOf('v'), path.join(fdOut, 'e2.mp4')).catch((e) => e)
        assert.strict.equal(err.startsWith('[exeNotReady] '), true, err)
        assert.strict.deepStrictEqual(spawnCalls, [])
        assert.strict.deepStrictEqual(listRoot(), [])
    })

    it(`should delete, at the start of a call, only the work folders whose modification time is over 24 hours old, and leave everything else under the temporary folder alone (R2)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let staleA = seed('20240101000000-StaleA', 25 * ms1h)
        let staleB = seed('20240101000001-StaleB', 24 * ms1h + 60 * 1000)
        let fresh23 = seed('20240101000002-Fresh2', 23 * ms1h)
        let freshBorder = seed('20240101000003-Border', 24 * ms1h - 60 * 1000)
        let freshNow = seed('20240101000004-FreshN', 0) //模擬併行中他呼叫之工作夾
        let others = [
            seed('Downloads', 48 * ms1h), //非本套件之工作夾命名
            seed('manual-backup', 48 * ms1h),
            seed('20240101000005-OldFil', 48 * ms1h, { asFile: true }), //命名相符但不是資料夾
            seed('2024010100000-ShortD', 48 * ms1h), //命名不符: 時間不足14位
            seed('20240101000006-Short', 48 * ms1h), //命名不符: id不足6碼
            seed('x20240101000007-AbCdEf', 48 * ms1h), //命名不符: 多前綴
            seed('20240101000008-AbCdEfg', 48 * ms1h), //命名不符: id超過6碼
        ]
        let keep = [fresh23, freshBorder, freshNow, ...others]
        assert.strict.equal(listRoot().length, 2 + keep.length)

        //夾具自檢: 預期被視為工作夾者(含命名相符之檔案)名稱確符合格式, 預期不符者確不符, 否則下方[留下]之斷言恆真
        for (let v of [staleA, staleB, fresh23, freshBorder, freshNow, others[2]]) {
            assert.strict.equal(reWork.test(path.basename(v)), true, v)
        }
        for (let v of [others[0], others[1], others[3], others[4], others[5], others[6]]) {
            assert.strict.equal(reWork.test(path.basename(v)), false, v)
        }

        gated()
        let fp = path.join(fdOut, 's.mp4')
        let p = WDwloadDlp(urlOf('s'), fp)
        running.push(p)
        await waitStarted(['s'])

        //殘留夾於呼叫一開始(yt-dlp執行中)即已刪除, 而非等到結束
        assert.strict.equal(fs.existsSync(staleA), false)
        assert.strict.equal(fs.existsSync(staleB), false)
        for (let v of keep) {
            assert.strict.equal(fs.existsSync(v), true, `${v} should be kept`)
        }

        release('s')
        assert.strict.equal(await p, 'ok')
        assert.strict.equal(fs.readFileSync(fp, 'utf8'), `FAKE-MP4 ${urlOf('s')}`)

        //結束後: 自己之工作夾已刪, 其餘原封不動(內容未變)
        let w = workOf(urlOf('s'))
        assert.strict.equal(fs.existsSync(w), false)
        assert.strict.deepStrictEqual(listRoot(), keep.map((v) => path.basename(v)).sort())
        for (let v of keep) {
            if (fs.statSync(v).isDirectory()) {
                assert.strict.equal(fs.readFileSync(path.join(v, 'sub', 'x.mp4'), 'utf8'), 'LEFTOVER')
            }
            else {
                assert.strict.equal(fs.readFileSync(v, 'utf8'), 'LEFTOVER')
            }
        }
    })

    it(`should have no effect for the removed option clean: the work folders of other calls and the other folders are not cleaned (R2)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let sibling = seed('20240101000009-Sibl01', 0)
        assert.strict.equal(reWork.test(path.basename(sibling)), true) //夾具自檢: 名稱確為工作夾格式
        let legacy = seed('Downloads', 0)
        let fp = path.join(fdOut, 'c.mp4')
        assert.strict.equal(await WDwloadDlp(urlOf('v'), fp, { clean: true }), 'ok')
        assert.strict.equal(fs.readFileSync(path.join(sibling, 'sub', 'x.mp4'), 'utf8'), 'LEFTOVER')
        assert.strict.equal(fs.readFileSync(path.join(legacy, 'sub', 'x.mp4'), 'utf8'), 'LEFTOVER')
        assert.strict.equal(fs.readFileSync(fp, 'utf8'), `FAKE-MP4 ${urlOf('v')}`)
    })

    it(`should ignore a failure of deleting, the stale folders and its own work folder, and still return the result (R2)`, async function() {
        if (!isWindows()) {
            this.skip()
        }

        //暖機: 先成功一次使快取就緒, 使下方攔截只影響工作夾之刪除
        assert.strict.equal(await WDwloadDlp(urlOf('v'), path.join(fdOut, 'warm.mp4')), 'ok')
        spawnCalls.length = 0

        let stale = seed('20240101000010-Locked', 30 * ms1h)
        let rmBak = fs.rmSync
        let rmTried = []
        fs.rmSync = (p, o) => {
            if (path.resolve(String(p)).toLowerCase().startsWith(path.resolve(fdRoot).toLowerCase() + path.sep)) {
                rmTried.push(path.resolve(String(p)))
                let err = new Error(`EPERM: fake, operation not permitted, rm '${p}'`)
                err.code = 'EPERM'
                throw err
            }
            return rmBak(p, o)
        }
        let r = null
        let fp = path.join(fdOut, 'r.mp4')
        try {
            r = await WDwloadDlp(urlOf('v'), fp)
        }
        finally {
            fs.rmSync = rmBak
        }
        assert.strict.equal(r, 'ok')
        assert.strict.equal(fs.readFileSync(fp, 'utf8'), `FAKE-MP4 ${urlOf('v')}`)

        //確實試過刪除(攔截有效), 刪不掉之夾留下
        let w = workOf(urlOf('v'))
        assert.strict.equal(rmTried.some((v) => sameDir(v, stale)), true, rmTried.join('\n'))
        assert.strict.equal(rmTried.some((v) => sameDir(v, w)), true, rmTried.join('\n'))
        assert.strict.equal(fs.existsSync(stale), true)
        assert.strict.equal(fs.existsSync(w), true)

        //下一次呼叫(刪除恢復正常): 清掉逾時之殘留; 自己上次刪不掉之夾尚未逾24小時, 留待逾時; 其逾時後亦被清掉(呼叫所產生之工作夾名稱確為清除所認得之格式)
        assert.strict.equal(await WDwloadDlp(urlOf('v'), path.join(fdOut, 'r2.mp4')), 'ok')
        assert.strict.equal(fs.existsSync(stale), false)
        assert.strict.equal(fs.existsSync(w), true)
        let t = new Date(Date.now() - 25 * ms1h)
        fs.utimesSync(w, t, t)
        assert.strict.equal(await WDwloadDlp(urlOf('v'), path.join(fdOut, 'r3.mp4')), 'ok')
        assert.strict.equal(fs.existsSync(w), false)
        assert.strict.deepStrictEqual(listRoot(), [])
    })

    it(`should retry deleting its own work folder while it is busy for a short time (for example scanned by an anti-virus), so that nothing is left behind (R1)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let rmBak = fs.rmSync
        let busyLeft = 2
        fs.rmSync = (p, o) => {
            if (busyLeft > 0 && path.resolve(String(p)).toLowerCase().startsWith(path.resolve(fdRoot).toLowerCase() + path.sep)) {
                busyLeft--
                let err = new Error(`EBUSY: fake, resource busy or locked, rm '${p}'`)
                err.code = 'EBUSY'
                throw err
            }
            return rmBak(p, o)
        }
        let r = null
        let fp = path.join(fdOut, 'busy.mp4')
        try {
            r = await WDwloadDlp(urlOf('v'), fp)
        }
        finally {
            fs.rmSync = rmBak
        }
        assert.strict.equal(r, 'ok')
        assert.strict.equal(fs.readFileSync(fp, 'utf8'), `FAKE-MP4 ${urlOf('v')}`)
        assert.strict.equal(busyLeft, 0) //攔截有效: 前兩次刪除確實遇到忙碌
        assert.strict.equal(fs.existsSync(workOf(urlOf('v'))), false)
        assert.strict.deepStrictEqual(listRoot(), [])
    })

})
