import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import WFfmpeg from 'w-ffmpeg'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { setupMirror } from './tools/dwMirror.mjs'


//規格(sgud/rule/rulebook.md R5): url以-開頭時不得被yt-dlp當成選項(選項注入); url一律置於`--`之後, 該字串視為網址而被yt-dlp拒收([dlpFailed]…is not a valid URL), 不執行該選項
//本檔以真正之yt-dlp.exe(本機鏡像供檔, 經ensureBins校驗)執行, 不連外網(網址不合法於解析前即被拒); 只替換w-ffmpeg之ensureBins(其取得屬w-ffmpeg範圍), 並攔截全域fetch斷言未連網
//修前: WDwloadDlp('--version', fp)令yt-dlp印出版本並以離開碼0結束, 回[outputNotFound]
describe(`url beginning with a dash is a url, not an option of yt-dlp`, function() {
    this.timeout(180000)

    //本套件只支援Windows
    if (process.platform !== 'win32') {
        return
    }

    let fdt = path.resolve('./test/_tmp/optionInjection')
    let fdTmp = path.join(fdt, 'tmp')
    let fdRoot = path.join(fdTmp, 'w-dwload-dlp')
    let fdOut = path.join(fdt, 'out')
    let fpFfmpeg = path.join(fdt, 'fake-ffmpeg', 'ffmpeg.exe')
    let m = null
    let envBak = {}
    let ffBak = null
    let fetchBak = null
    let netCalls = []

    before(function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdTmp, { recursive: true })
        fs.mkdirSync(fdOut, { recursive: true })
        fs.mkdirSync(path.dirname(fpFfmpeg), { recursive: true })
        fs.writeFileSync(fpFfmpeg, 'FAKE-FFMPEG')
        m = setupMirror('optionInjection/mirror')
        for (let k of ['W_BIN_CACHE', 'W_BIN_OFFLINE', 'TEMP', 'TMP']) {
            envBak[k] = process.env[k]
        }
        process.env.W_BIN_CACHE = path.join(fdt, 'cache')
        process.env.W_BIN_OFFLINE = '1'
        process.env.TEMP = fdTmp
        process.env.TMP = fdTmp
        assert.strict.equal(path.resolve(os.tmpdir()).toLowerCase(), path.resolve(fdTmp).toLowerCase()) //os.tmpdir()確實已導向測試夾
        ffBak = WFfmpeg.ensureBins
        WFfmpeg.ensureBins = async() => ({ 'ffmpeg.exe': fpFfmpeg })
        fetchBak = globalThis.fetch
        globalThis.fetch = (url) => {
            netCalls.push(String(url))
            throw new Error(`network access is forbidden in tests: ${url}`)
        }
    })
    after(function() {
        globalThis.fetch = fetchBak
        WFfmpeg.ensureBins = ffBak
        for (let k of Object.keys(envBak)) {
            if (envBak[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = envBak[k]
            }
        }
        m.restore()
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })
    beforeEach(function() {
        netCalls.length = 0
    })

    let rejectOf = async(p) => {
        let r = await p.then((v) => ({ ok: true, v }), (err) => ({ ok: false, err }))
        assert.strict.equal(r.ok, false, `should reject, but resolved with ${JSON.stringify(r.v)}`)
        assert.strict.equal(typeof r.err, 'string')
        return r.err
    }

    it(`should refuse '--version' and '--help' as urls in WDwloadDlp, instead of running them as options of yt-dlp`, async function() {
        //規格: url置於--之後; yt-dlp視其為網址而拒收, 首行為[dlpFailed]並載明not a valid URL; 修前yt-dlp執行了該選項並以離開碼0結束, 回[outputNotFound]
        for (let url of ['--version', '--help']) {
            let fp = path.join(fdOut, 'x.mp4')
            let err = await rejectOf(WDwloadDlp(url, fp))
            assert.strict.equal(err.split('\n')[0].startsWith('[dlpFailed] '), true, `${url}: ${err}`)
            assert.strict.equal(err.includes('is not a valid URL'), true, `${url}: ${err}`)
            assert.strict.equal(fs.existsSync(fp), false)
        }
        assert.strict.deepEqual(fs.existsSync(fdRoot) ? fs.readdirSync(fdRoot) : [], []) //工作夾已刪
        assert.strict.deepEqual(netCalls, [])
    })

    it(`should refuse '--version' and '--help' as urls in dwloadSubtitle`, async function() {
        //規格: 同上, 新入口之第1次呼叫亦以--隔開
        for (let url of ['--version', '--help']) {
            let err = await rejectOf(WDwloadDlp.dwloadSubtitle(url))
            assert.strict.equal(err.split('\n')[0].startsWith('[dlpFailed] '), true, `${url}: ${err}`)
            assert.strict.equal(err.includes('is not a valid URL'), true, `${url}: ${err}`)
        }
        assert.strict.deepEqual(fs.existsSync(fdRoot) ? fs.readdirSync(fdRoot) : [], [])
        assert.strict.deepEqual(netCalls, [])
    })

})
