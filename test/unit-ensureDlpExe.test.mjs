import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import ensureDlpExe from '../src/ensureDlpExe.mjs'
import autoDownloadFiles from '../src/autoDownloadFiles.mjs'
import { sha256, mkBuf, mkSpec, mkBad, sendBuf, sendJson, send, startServer, newDir, rmDir, ls } from './tools/dlpServer.mjs'


//本機HTTP伺服器模擬GitHub raw, 不連外網; 暫存於test/_tmp/ensureDlpExe/
//驗證autoDownloadFiles之yt-dlp.exe定位層: 併發共用同一次下載, 錯誤傳遞, 既有exe不連網不重算雜湊

let NAME = 'ensureDlpExe'
let good = mkBuf(300000, 1)
let spec = mkSpec(good)
let srv = null


function downloadOpt(extra = {}) {
    return { urlBase: srv.urlBase, log: () => {}, retryDelayMs: 5, stallMs: 2000, totalMs: 20000, ...extra }
}


async function fail(pm) {
    let err = null
    try {
        await pm
    }
    catch (e) {
        err = e
    }
    assert.ok(err, 'should reject')
    return err
}


describe('ensureDlpExe', function() {

    this.timeout(60000)

    before(async function() {
        srv = await startServer(8761)
    })

    after(async function() {
        await srv.close()
        rmDir(NAME)
    })

    beforeEach(function() {
        srv.reset()
        srv.onManifest = (n, req, res) => sendJson(res, spec)
        srv.onExe = (n, req, res) => sendBuf(res, good)
    })


    it('無exe: 下載並驗證, 回傳yt-dlp/yt-dlp.exe絕對路徑', async function() {
        let fdSrv = newDir(NAME, 'basic')
        let fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(fp, path.join(fdSrv, 'yt-dlp', 'yt-dlp.exe'))
        assert.strictEqual(sha256(fs.readFileSync(fp)), spec.sha256)
        assert.deepStrictEqual(ls(path.join(fdSrv, 'yt-dlp')), ['yt-dlp.exe'])
    })

    it('併發5次呼叫: 只下載一次(清單與exe各請求1次), 全部得到同一路徑', async function() {
        let fdSrv = newDir(NAME, 'concurrent')
        srv.onExe = (n, req, res) => setTimeout(() => sendBuf(res, good), 150)
        let ps = []
        for (let i = 0; i < 5; i++) {
            ps.push(ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() }))
        }
        let rs = await Promise.all(ps)
        assert.strictEqual(new Set(rs).size, 1)
        assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 1 })
        assert.deepStrictEqual(ls(path.join(fdSrv, 'yt-dlp')), ['yt-dlp.exe'])
    })

    it('併發下載失敗: 全部呼叫者皆收到錯誤, 不留檔; 失敗後再呼叫會重新下載', async function() {
        let fdSrv = newDir(NAME, 'concurrentFail')
        srv.onExe = (n, req, res) => setTimeout(() => sendBuf(res, mkBad(good)), 100)
        let ps = []
        for (let i = 0; i < 5; i++) {
            ps.push(fail(ensureDlpExe({ fdSrv, downloadOpt: downloadOpt({ maxAttempts: 1 }) })))
        }
        let errs = await Promise.all(ps)
        for (let err of errs) {
            assert.strictEqual(err.code, 'E_HASH_MISMATCH')
        }
        assert.strictEqual(srv.hits.exe, 1)
        assert.deepStrictEqual(ls(path.join(fdSrv, 'yt-dlp')), [])

        //失敗後Promise已歸零, 再呼叫重新下載
        srv.onExe = (n, req, res) => sendBuf(res, good)
        let fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(srv.hits.exe, 2)
        assert.strictEqual(sha256(fs.readFileSync(fp)), spec.sha256)
    })

    it('下載成功後檔案被移除: 再呼叫會重新下載(不沿用已resolve之Promise)', async function() {
        let fdSrv = newDir(NAME, 'removed')
        let fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        fs.rmSync(fp)
        await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(srv.hits.exe, 2)
        assert.ok(fs.existsSync(fp))
    })

    it('清單取不到: 錯誤傳給呼叫者, 不留檔', async function() {
        let fdSrv = newDir(NAME, 'man404')
        srv.onManifest = (n, req, res) => send(res, 404, 'not found')
        let err = await fail(ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() }))
        assert.strictEqual(err.code, 'E_MANIFEST_HTTP')
        assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 0 })
        assert.deepStrictEqual(ls(path.join(fdSrv, 'yt-dlp')), [])
    })

    it('併發2次但下載落點不同(各缺檔的兩個工作目錄): 各自下載, 皆成功(不共用他處之結果)', async function() {
        let fdSrvA = newDir(NAME, 'destA')
        let fdSrvB = newDir(NAME, 'destB')
        srv.onExe = (n, req, res) => setTimeout(() => sendBuf(res, good), 100)
        let [a, b] = await Promise.all([
            ensureDlpExe({ fdSrv: fdSrvA, downloadOpt: downloadOpt() }),
            ensureDlpExe({ fdSrv: fdSrvB, downloadOpt: downloadOpt() }),
        ])
        assert.strictEqual(a, path.join(fdSrvA, 'yt-dlp', 'yt-dlp.exe'))
        assert.strictEqual(b, path.join(fdSrvB, 'yt-dlp', 'yt-dlp.exe'))
        assert.strictEqual(srv.hits.exe, 2, '落點不同各下載一次')
        assert.strictEqual(sha256(fs.readFileSync(a)), spec.sha256)
        assert.strictEqual(sha256(fs.readFileSync(b)), spec.sha256)
    })

    it('既有exe(即使內容與清單不符): 直接採用, 不連網, 不重算雜湊(不讀檔內容、不呼叫createHash), 內容不變', async function() {
        let fdSrv = newDir(NAME, 'existing')
        let fd = path.join(fdSrv, 'yt-dlp')
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, 'yt-dlp.exe'), 'NOT-THE-REAL-EXE')

        //監看雜湊與讀檔入口(自身之node_modules/w-dwload-dlp分支同理, 由下一案涵蓋)
        let calls = []
        let ori = { createHash: crypto.createHash, readFileSync: fs.readFileSync, createReadStream: fs.createReadStream }
        crypto.createHash = (...a) => {
            calls.push('createHash')
            return ori.createHash(...a)
        }
        fs.readFileSync = (...a) => {
            calls.push(`readFileSync:${a[0]}`)
            return ori.readFileSync(...a)
        }
        fs.createReadStream = (...a) => {
            calls.push(`createReadStream:${a[0]}`)
            return ori.createReadStream(...a)
        }
        let fp = ''
        try {
            fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        }
        finally {
            crypto.createHash = ori.createHash
            fs.readFileSync = ori.readFileSync
            fs.createReadStream = ori.createReadStream
        }
        assert.deepStrictEqual(calls, [])
        assert.strictEqual(fp, path.join(fd, 'yt-dlp.exe'))
        assert.deepStrictEqual(srv.hits, { manifest: 0, exe: 0 })
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), 'NOT-THE-REAL-EXE')
    })

    it('既有exe位於node_modules/w-dwload-dlp/yt-dlp/: 同樣直接採用, 不連網', async function() {
        let fdSrv = newDir(NAME, 'existingNM')
        let fd = path.join(fdSrv, 'node_modules', 'w-dwload-dlp', 'yt-dlp')
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, 'yt-dlp.exe'), 'NOT-THE-REAL-EXE')
        let fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(fp, path.join(fd, 'yt-dlp.exe'))
        assert.deepStrictEqual(srv.hits, { manifest: 0, exe: 0 })
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), 'NOT-THE-REAL-EXE')
    })

    it('被安裝為相依套件(node_modules/w-dwload-dlp/存在): 下載至node_modules/w-dwload-dlp/yt-dlp/, 之後直接採用', async function() {
        let fdSrv = newDir(NAME, 'asDep')
        fs.mkdirSync(path.join(fdSrv, 'node_modules', 'w-dwload-dlp'), { recursive: true })
        let fp = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(fp, path.join(fdSrv, 'node_modules', 'w-dwload-dlp', 'yt-dlp', 'yt-dlp.exe'))
        assert.strictEqual(sha256(fs.readFileSync(fp)), spec.sha256)
        let fp2 = await ensureDlpExe({ fdSrv, downloadOpt: downloadOpt() })
        assert.strictEqual(fp2, fp)
        assert.strictEqual(srv.hits.exe, 1)
    })

    it('autoDownloadFiles: 已備齊執行檔時回傳兩個絕對路徑且不連網(fetch替身若被呼叫即失敗)', async function() {
        let root = newDir(NAME, 'autoDl')
        fs.mkdirSync(path.join(root, 'yt-dlp'), { recursive: true })
        fs.writeFileSync(path.join(root, 'yt-dlp', 'yt-dlp.exe'), 'fake')
        fs.mkdirSync(path.join(root, 'node_modules', 'w-ffmpeg', 'src'), { recursive: true })
        fs.writeFileSync(path.join(root, 'node_modules', 'w-ffmpeg', 'src', 'ffmpeg.exe'), 'fake')
        let cwd = process.cwd()
        let fetchOri = globalThis.fetch
        let called = []
        globalThis.fetch = async (url) => {
            called.push(String(url))
            throw new TypeError('network must not be used')
        }
        process.chdir(root)
        let r = null
        try {
            r = await autoDownloadFiles()
        }
        finally {
            process.chdir(cwd)
            globalThis.fetch = fetchOri
        }
        assert.deepStrictEqual(called, [])
        assert.strictEqual(fs.realpathSync(r.fpExeDlp), fs.realpathSync(path.join(root, 'yt-dlp', 'yt-dlp.exe')))
        assert.strictEqual(fs.realpathSync(r.fpExeFfmpeg), fs.realpathSync(path.join(root, 'node_modules', 'w-ffmpeg', 'src', 'ffmpeg.exe')))
    })

    it('autoDownloadFiles: yt-dlp.exe下載失敗時reject(錯誤傳遞), 不留檔', async function() {
        let root = newDir(NAME, 'autoDlFail')
        let cwd = process.cwd()
        let fetchOri = globalThis.fetch
        let called = []
        globalThis.fetch = async (url) => {
            called.push(String(url))
            return new Response('not found', { status: 404 }) //確定性錯誤, 不重試, 測試不必等重試間隔
        }
        process.chdir(root)
        let err = null
        try {
            err = await fail(autoDownloadFiles())
        }
        finally {
            process.chdir(cwd)
            globalThis.fetch = fetchOri
        }
        assert.strictEqual(err.code, 'E_MANIFEST_HTTP')
        assert.deepStrictEqual(called, ['https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/manifest.json'])
        assert.deepStrictEqual(ls(path.join(root, 'yt-dlp')), [])
    })

})
