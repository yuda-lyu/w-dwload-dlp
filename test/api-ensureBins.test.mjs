import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'http'
import cp from 'child_process'
import assert from 'assert'
import crypto from 'crypto'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import ensureBins from '../src/ensureBins.mjs'
import { createFakeRun } from './tools/fakeRun.mjs'


function isWindows() {
    return process.platform === 'win32'
}


//mkBuf, 產生固定內容之假exe(線性同餘, 不同seed內容不同), 非隨機
function mkBuf(size, seed = 1) {
    let buf = Buffer.alloc(size)
    let x = seed >>> 0
    for (let i = 0; i < size; i++) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0
        buf[i] = x >>> 24
    }
    return buf
}


function sha256Of(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex')
}


//flip, 與原內容同長度但內容不同
function flip(buf, i = 1000) {
    let b = Buffer.from(buf)
    b[i] = b[i] ^ 0xff
    return b
}


async function hashOf(fp) {
    let h = crypto.createHash('sha256')
    for await (let chunk of fs.createReadStream(fp)) {
        h.update(chunk)
    }
    return { sha256: h.digest('hex'), size: fs.statSync(fp).size }
}


//listFiles, 遞迴列出資料夾內所有檔案(不存在回傳空陣列)
function listFiles(fd) {
    if (!fs.existsSync(fd)) {
        return []
    }
    return fs.readdirSync(fd, { recursive: true, withFileTypes: true }).filter((v) => v.isFile()).map((v) => path.join(v.parentPath, v.name))
}


//withEnv, 暫時設定環境變數(值為undefined代表刪除), 結束後還原
async function withEnv(vars, fun) {
    let old = {}
    for (let k of Object.keys(vars)) {
        old[k] = process.env[k]
        if (vars[k] === undefined) {
            delete process.env[k]
        }
        else {
            process.env[k] = vars[k]
        }
    }
    try {
        return await fun()
    }
    finally {
        for (let k of Object.keys(vars)) {
            if (old[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = old[k]
            }
        }
    }
}


async function catchErr(fun) {
    try {
        await fun()
    }
    catch (err) {
        return err
    }
    return null
}


//規格: 外部執行檔之存放下載校驗與離線(制式規格) D1~D4、O1~O4、M5、E2、E3、§8 T3~T8
//主幹模式(floating)之yt-dlp.exe經本機HTTP伺服器(扮raw.githubusercontent.com, fetch只改主機指向本機)與本地資料夾(扮鏡像與快取), 不連外網
describe(`ensureBins (floating mode)`, function() {
    this.timeout(180000)

    let RAW = 'https://raw.githubusercontent.com'
    let port = 8981
    let fdt = path.resolve('./test/_tmp/ensureBins')
    let name = 'yt-dlp.exe'
    let pkgName = 'w-dwload-dlp'
    let urlManifest = `${RAW}/yuda-lyu/w-dwload-dlp/master/bin/manifest.json`
    let urlExe = `${RAW}/yuda-lyu/w-dwload-dlp/master/bin/yt-dlp.exe`

    //基準清單(npm包內之bin/manifest.json)與其實檔
    let base = null
    let realBuf = null
    let realSha = ''

    //主幹清單所載之新版(假exe, 小檔), 與主幹上之現況
    let trunkBuf = mkBuf(300000, 7)
    let trunkSha = sha256Of(trunkBuf)
    let mkTrunk = (buf, version = '9999.01.01') => {
        return {
            schema: 1,
            pkg: pkgName,
            mode: 'floating',
            repo: 'yuda-lyu/w-dwload-dlp',
            version,
            files: [{ name, path: 'bin/yt-dlp.exe', sha256: sha256Of(buf), size: buf.length }],
        }
    }

    //伺服器狀態: manifestMode為good、missing(404)、down(切斷連線)、garbage、wrongpkg、badschema、nosha; exeMode為good、flip、short、missing
    let st = { manifestMode: 'good', trunk: null, exeMode: 'good', exeBody: null }
    let hits = []
    let server = null

    //fetch, 只接受GitHub原始檔網址並改指本機伺服器, 其餘(外網)一律拋錯; urls記錄被請求之原網址
    let urls = []
    let fetch = (url, init) => {
        let u = String(url)
        urls.push(u)
        if (!u.startsWith(`${RAW}/`)) {
            throw new Error(`unexpected url[${u}]`)
        }
        return globalThis.fetch(u.replace(RAW, `http://127.0.0.1:${port}`), init)
    }

    //fetchBan, 任何網路請求皆視為錯誤(用於斷言未連網)
    let fetchBan = (url) => {
        urls.push(String(url))
        throw new Error(`network access is not allowed in this case[${url}]`)
    }

    //每案獨立資料夾, afterEach刪除
    let seq = 0
    let temps = []
    let newDir = (tag) => {
        seq++
        let fd = path.join(fdt, `${tag}-${seq}`)
        temps.push(fd)
        return fd
    }

    //putMirror, 把buf依鏡像結構(<鏡像>/<套件>/<sha256>/<name>)放入, sha256為清單所載者
    let putMirror = (mirror, buf, sha = sha256Of(buf)) => {
        let fd = path.join(mirror, pkgName, sha)
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, name), buf)
        return path.join(fd, name)
    }

    //ensure, 連網取得(取主幹清單), 單次嘗試使失敗案不等重試間隔
    let ensure = (cacheDir, o = {}) => {
        return ensureBins({ cacheDir, fetch, mirror: '', offline: false, maxAttempts: 1, retryDelayMs: 0, ...o })
    }

    //cacheFiles, 快取夾內除「最近一次成功之主幹清單副本(紀錄)」外之檔案
    let cacheFiles = (cacheDir) => {
        return listFiles(cacheDir).filter((v) => path.basename(v) !== 'manifest-last.json')
    }

    before(async function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        base = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
        realBuf = fs.readFileSync('bin/yt-dlp.exe')
        realSha = base.files[0].sha256
        server = http.createServer((req, res) => {
            hits.push(req.url)
            if (req.url === '/yuda-lyu/w-dwload-dlp/master/bin/manifest.json') {
                let m = st.manifestMode
                if (m === 'missing') {
                    res.writeHead(404)
                    res.end()
                    return
                }
                if (m === 'down') {
                    req.socket.destroy()
                    return
                }
                let body = ''
                if (m === 'garbage') {
                    body = 'this is not json'
                }
                else if (m === 'wrongpkg') {
                    body = JSON.stringify({ ...st.trunk, pkg: 'w-other' })
                }
                else if (m === 'badschema') {
                    body = JSON.stringify({ ...st.trunk, unexpectedKey: 1 })
                }
                else if (m === 'nosha') {
                    body = JSON.stringify({ ...st.trunk, files: [{ name, path: 'bin/yt-dlp.exe', size: 1 }] })
                }
                else {
                    body = JSON.stringify(st.trunk)
                }
                res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
                res.end(body)
                return
            }
            if (req.url === '/yuda-lyu/w-dwload-dlp/master/bin/yt-dlp.exe') {
                let body = st.exeBody
                if (st.exeMode === 'missing') {
                    res.writeHead(404)
                    res.end()
                    return
                }
                if (st.exeMode === 'flip') {
                    body = flip(body)
                }
                if (st.exeMode === 'short') {
                    body = body.subarray(0, body.length - 1)
                }
                res.writeHead(200, { 'content-length': String(body.length) })
                res.end(body)
                return
            }
            res.writeHead(404)
            res.end()
        })

        //listen, 自8981起向後找可用埠(固定遞增, 不隨機)
        for (let i = 0; i < 20; i++) {
            let ok = await new Promise((resolve, reject) => {
                let onErr = (err) => {
                    if (err.code === 'EADDRINUSE') {
                        resolve(false)
                    }
                    else {
                        reject(err)
                    }
                }
                server.once('error', onErr)
                server.listen(port + i, '127.0.0.1', () => {
                    server.off('error', onErr)
                    resolve(true)
                })
            })
            if (ok) {
                port = port + i
                break
            }
        }
        assert.strict.equal(server.listening, true, 'no free port from 8981')
    })

    after(async function() {
        await new Promise((resolve) => {
            server.close(resolve)
        })
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })

    beforeEach(function() {
        st = { manifestMode: 'good', trunk: mkTrunk(trunkBuf), exeMode: 'good', exeBody: trunkBuf }
        hits = []
        urls = []
    })

    afterEach(function() {
        for (let fd of temps) {
            fs.rmSync(fd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        }
        temps = []
    })

    //主幹清單與基準清單相同(實檔為bin/yt-dlp.exe), 供需要真實檔案之案使用
    let trunkIsBase = () => {
        st.trunk = { ...base }
        st.exeBody = realBuf
    }

    it(`should have the baseline manifest describe the real bin/yt-dlp.exe (M1, M4)`, async function() {
        assert.strict.equal(sha256Of(realBuf), realSha)
        assert.strict.equal(realBuf.length, base.files[0].size)
    })

    it(`should take the manifest from the trunk first and download the file it names from master, verify it and cache only the final file; the second call does not download the file again (T3, M5, D1, D3, D4, O2)`, async function() {
        let cacheDir = newDir('cache')

        let r1 = await ensure(cacheDir)
        assert.strict.deepStrictEqual(Object.keys(r1), [name])
        assert.strict.equal(r1[name], path.join(cacheDir, trunkSha, name)) //D3: <快取>/<sha256>/<name>, sha256取自主幹清單(非基準清單)
        assert.strict.deepStrictEqual(await hashOf(r1[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.deepStrictEqual(urls, [urlManifest, urlExe]) //M5: 先取主幹清單, 再自master取exe(非釘選提交、非releases/latest)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [r1[name]]) //只存最終檔, 不留暫存檔

        urls = []
        let r2 = await ensure(cacheDir)
        assert.strict.equal(r2[name], r1[name])
        assert.strict.deepStrictEqual(urls, [urlManifest]) //D4: 命中且校驗, 不再下載exe; 主幹模式每次連網呼叫仍取一次清單
        assert.strict.equal(hits.filter((v) => v.endsWith('/yt-dlp.exe')).length, 1)
    })

    it(`should hit the cache without any network when the trunk manifest equals the baseline and the call is offline (T3, D4, O3)`, async function() {
        trunkIsBase()
        let cacheDir = newDir('cache')
        let r1 = await ensure(cacheDir)
        assert.strict.equal(r1[name], path.join(cacheDir, realSha, name))
        assert.strict.deepStrictEqual(await hashOf(r1[name]), { sha256: realSha, size: realBuf.length })
        assert.strict.deepStrictEqual(urls, [urlManifest, urlExe])

        urls = []
        hits = []
        let r2 = await ensure(cacheDir, { fetch: fetchBan, offline: true })
        assert.strict.equal(r2[name], r1[name])
        assert.strict.deepStrictEqual(urls, [])
        assert.strict.deepStrictEqual(hits, [])
    })

    it(`should reject a file whose bytes differ from the manifest and leave no file (T4, M2, D2)`, async function() {
        st.exeMode = 'flip'
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir))
        assert.strict.equal(err && err.code, 'E_HASH_MISMATCH', err && err.message)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it(`should reject a file whose size differs from the manifest and leave no file (T4, M2, D2)`, async function() {
        st.exeMode = 'short'
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir))
        assert.strict.equal(err && err.code, 'E_SIZE_MISMATCH', err && err.message)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it(`should reject an HTTP error status without leaving a file (T4, E3)`, async function() {
        st.exeMode = 'missing'
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir))
        assert.strict.equal(err && err.code, 'E_HTTP', err && err.message)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it(`should reject, not accept, a file that does not match the sha256 which the trunk manifest announces (T4, M5, current wsemi behavior: the verified manifest is the trunk one)`, async function() {
        //主幹清單所載之雜湊與master上之exe不符(例如CDN使清單與檔案不同步): 檔案不得進快取; 錯誤為E_HASH_MISMATCH
        st.trunk = mkTrunk(flip(trunkBuf))
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir))
        assert.strict.equal(err && err.code, 'E_HASH_MISMATCH', err && err.message)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [])
    })

    it(`should get the file the trunk manifest names from a local folder mirror, and not download it (T5, O1, O2)`, async function() {
        let mirror = newDir('mirror')
        putMirror(mirror, trunkBuf)
        let cacheDir = newDir('cache')
        let r = await ensure(cacheDir, { mirror })
        assert.strict.equal(r[name], path.join(cacheDir, trunkSha, name))
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.deepStrictEqual(urls, [urlManifest]) //exe取自鏡像, 未連GitHub取exe
    })

    it(`should get the baseline file from a local folder mirror offline without any network (T5, O1, O3)`, async function() {
        let mirror = newDir('mirror')
        putMirror(mirror, realBuf, realSha)
        let cacheDir = newDir('cache')
        let r = await ensure(cacheDir, { fetch: fetchBan, mirror, offline: true })
        assert.strict.equal(r[name], path.join(cacheDir, realSha, name))
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: realSha, size: realBuf.length })
        assert.strict.deepStrictEqual(urls, [])
        assert.strict.deepStrictEqual(hits, [])
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [r[name]])
    })

    it(`should refuse a tampered mirror file: offline fails with E_OFFLINE_MISSING and caches nothing; online falls back to GitHub, still verified, and leaves the mirror untouched (T5, O2)`, async function() {
        let mirror = newDir('mirror')
        let fpMirror = putMirror(mirror, flip(realBuf, 5000), realSha) //同長度、內容不同
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir, { fetch: fetchBan, mirror, offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.deepStrictEqual(cacheFiles(cacheDir), [])

        let mirror2 = newDir('mirror')
        let fpMirror2 = putMirror(mirror2, flip(trunkBuf, 5000), trunkSha)
        let cacheDir2 = newDir('cache')
        let r = await ensure(cacheDir2, { mirror: mirror2 })
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.equal(urls.includes(urlExe), true) //被竄改者改自GitHub取得
        assert.strict.equal(fs.readFileSync(fpMirror2).equals(flip(trunkBuf, 5000)), true)
        assert.strict.equal(fs.readFileSync(fpMirror).equals(flip(realBuf, 5000)), true)
    })

    it(`should use a W_BIN_CACHE folder as a mirror (T5, O4)`, async function() {
        //O4: 設W_BIN_CACHE=<資料夾>取得所得之資料夾即為鏡像(結構<資料夾>/<套件>/<sha256>/<name>)
        let envRoot = newDir('envroot')
        let rEnv = await withEnv({ W_BIN_CACHE: envRoot, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: undefined }, () => {
            return ensureBins({ fetch, mirror: '', offline: false, maxAttempts: 1, retryDelayMs: 0 })
        })
        assert.strict.equal(rEnv[name], path.join(envRoot, pkgName, trunkSha, name))

        urls = []
        let cacheDir = newDir('cache')
        let r = await ensure(cacheDir, { mirror: envRoot })
        assert.strict.equal(r[name], path.join(cacheDir, trunkSha, name))
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.deepStrictEqual(urls, [urlManifest])
    })

    it(`should reject offline with E_OFFLINE_MISSING naming the file, sha256, size, the cache path and the mirror path when nothing is available, without any network (T6, O3, E3)`, async function() {
        let cacheDir = newDir('cache')
        let err = await catchErr(() => ensure(cacheDir, { fetch: fetchBan, offline: true }))
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        let cachePath = path.join(cacheDir, realSha, name)
        assert.strict.equal(err.message.includes(name), true, err.message)
        assert.strict.equal(err.message.includes(realSha), true, err.message) //離線不取主幹清單, 故為基準清單所載之值
        assert.strict.equal(err.message.includes(`${realBuf.length} bytes`), true, err.message)
        assert.strict.equal(err.message.includes(cachePath), true, err.message)
        assert.strict.equal(err.message.includes(`<W_BIN_MIRROR>/${pkgName}/${realSha}/${name}`), true, err.message)
        assert.strict.deepStrictEqual(err.missing.map((v) => [v.name, v.sha256, v.size, v.cachePath]), [[name, realSha, realBuf.length, cachePath]])
        assert.strict.deepStrictEqual(urls, [])
        assert.strict.deepStrictEqual(hits, []) //連主幹清單都不取
        assert.strict.deepStrictEqual(listFiles(cacheDir), [])
    })

    it(`should re-obtain the file when the cached file was altered with the same size or truncated (T7, D4)`, async function() {
        let cacheDir = newDir('cache')
        let r1 = await ensure(cacheDir)
        assert.strict.equal(hits.filter((v) => v.endsWith('/yt-dlp.exe')).length, 1)

        fs.writeFileSync(r1[name], flip(fs.readFileSync(r1[name]), 5000)) //同長度竄改
        assert.strict.notEqual((await hashOf(r1[name])).sha256, trunkSha)
        let r2 = await ensure(cacheDir)
        assert.strict.equal(r2[name], r1[name])
        assert.strict.deepStrictEqual(await hashOf(r2[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.equal(hits.filter((v) => v.endsWith('/yt-dlp.exe')).length, 2)

        fs.truncateSync(r2[name], 1024) //大小不符
        let r3 = await ensure(cacheDir)
        assert.strict.deepStrictEqual(await hashOf(r3[name]), { sha256: trunkSha, size: trunkBuf.length })
        assert.strict.equal(hits.filter((v) => v.endsWith('/yt-dlp.exe')).length, 3)
    })

    it(`should re-obtain a tampered cache file from the mirror when offline (T7, D4, O3)`, async function() {
        let mirror = newDir('mirror')
        putMirror(mirror, realBuf, realSha)
        let cacheDir = newDir('cache')
        let r1 = await ensure(cacheDir, { fetch: fetchBan, mirror, offline: true })
        fs.writeFileSync(r1[name], flip(fs.readFileSync(r1[name]), 5000))
        let r2 = await ensure(cacheDir, { fetch: fetchBan, mirror, offline: true })
        assert.strict.equal(r2[name], r1[name])
        assert.strict.deepStrictEqual(await hashOf(r2[name]), { sha256: realSha, size: realBuf.length })
        assert.strict.deepStrictEqual(urls, [])
    })

    for (let mode of ['missing', 'down', 'garbage', 'wrongpkg', 'badschema', 'nosha']) {
        it(`should use the baseline manifest when the trunk manifest can not be used: ${mode} (T8, M5)`, async function() {
            st.manifestMode = mode
            let mirror = newDir('mirror')
            putMirror(mirror, realBuf, realSha)
            let cacheDir = newDir('cache')
            let r = await ensure(cacheDir, { mirror })
            assert.strict.equal(r[name], path.join(cacheDir, realSha, name)) //基準清單所載之版本, 非主幹清單之新版
            assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: realSha, size: realBuf.length })
            assert.strict.deepStrictEqual(urls, [urlManifest]) //有嘗試取主幹清單; exe取自鏡像
        })
    }

    it(`should download the baseline file from GitHub when the trunk manifest is missing (T8, M5, T3)`, async function() {
        st.manifestMode = 'missing'
        st.exeBody = realBuf
        let cacheDir = newDir('cache')
        let r = await ensure(cacheDir)
        assert.strict.equal(r[name], path.join(cacheDir, realSha, name))
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: realSha, size: realBuf.length })
        assert.strict.deepStrictEqual(urls, [urlManifest, urlExe])
    })

    it(`should read W_BIN_CACHE, W_BIN_MIRROR and W_BIN_OFFLINE from the environment (D3, O1, O3)`, async function() {
        let mirror = newDir('mirror')
        putMirror(mirror, realBuf, realSha)
        let envRoot = newDir('envroot')
        let r = await withEnv({ W_BIN_CACHE: envRoot, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' }, () => {
            return ensureBins({ fetch: fetchBan })
        })
        //D3: 共用快取為<W_BIN_CACHE>/<套件>/<sha256>/<name>
        assert.strict.equal(r[name], path.join(envRoot, pkgName, realSha, name))
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: realSha, size: realBuf.length })
        assert.strict.equal(hits.length, 0)

        //W_BIN_OFFLINE=1且無快取無鏡像: E_OFFLINE_MISSING, 不連網
        let envRoot2 = newDir('envroot')
        let err = await withEnv({ W_BIN_CACHE: envRoot2, W_BIN_MIRROR: undefined, W_BIN_OFFLINE: '1' }, () => {
            return catchErr(() => ensureBins({ fetch: fetchBan }))
        })
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
        assert.strict.equal(err.message.includes(path.join(envRoot2, pkgName, realSha, name)), true, err.message)
        assert.strict.deepStrictEqual(urls, [])
    })

    it(`should place the default cache under the package root even when the module is loaded from another working directory (D3)`, function() {
        //pkgRoot於模組載入時決定, 故以子行程於他處工作目錄載入(被安裝為相依套件時, 載入時之工作目錄為使用者專案而非套件根)
        //為不在本套件根建立bin-cache/(fsEnsureBins離線缺檔時亦會建立空的快取根)且不受開發機既有快取影響, 於暫存夾組一個假套件根(src/ensureBins.mjs之副本＋bin/manifest.json)
        let fdPkg = path.join(fdt, 'pkg')
        fs.mkdirSync(path.join(fdPkg, 'src'), { recursive: true })
        fs.mkdirSync(path.join(fdPkg, 'bin'), { recursive: true })
        fs.copyFileSync('src/ensureBins.mjs', path.join(fdPkg, 'src/ensureBins.mjs'))
        fs.copyFileSync('bin/manifest.json', path.join(fdPkg, 'bin/manifest.json'))
        let env = { ...process.env }
        for (let k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE']) {
            delete env[k]
        }
        let cwdOther = os.tmpdir()
        let r = cp.spawnSync(process.execPath, [path.resolve('test/tools/ensureBinsChild.mjs'), path.join(fdPkg, 'src/ensureBins.mjs')], { cwd: cwdOther, env, encoding: 'utf8', windowsHide: true })
        assert.strict.equal(r.status, 0, r.stderr)
        let o = JSON.parse(r.stdout.trim().split('\n').pop())
        assert.strict.equal(path.resolve(o.cwd), path.resolve(cwdOther)) //確實於他處載入
        assert.strict.equal(o.code, 'E_OFFLINE_MISSING')
        assert.strict.equal(o.cachePath, path.join(fdPkg, 'bin-cache', realSha, name)) //缺檔之應放路徑為(假)套件根下之預設快取, 與cwd無關
    })

    it(`should not forward floatingManifestUrl, which would change the trust anchor of the trunk manifest (M5, E2)`, async function() {
        //傳同一repo之他分支網址: 若被轉傳, 取清單的網址會是該網址; 套件端丟棄它, 故取的是由清單repo與manifestPath決定之master網址
        let other = `${RAW}/yuda-lyu/w-dwload-dlp/other/bin/manifest.json`
        let cacheDir = newDir('cache')
        await ensure(cacheDir, { floatingManifestUrl: other })
        assert.strict.equal(urls[0], urlManifest)
        assert.strict.equal(urls.includes(other), false)

        //傳無效值: 若被轉傳, fsEnsureBins會以E_ARG拒絕; 套件端丟棄它故仍正常取得
        let mirror = newDir('mirror')
        putMirror(mirror, realBuf, realSha)
        let r = await ensure(newDir('cache'), { fetch: fetchBan, mirror, offline: true, floatingManifestUrl: 'not-a-valid-url' })
        assert.strict.deepStrictEqual(await hashOf(r[name]), { sha256: realSha, size: realBuf.length })
    })

})


//WDwloadDlp主函數無法注入fetch與spawn, 假執行環境(攔截全域fetch與child_process.spawn、假w-ffmpeg)見test/tools/fakeRun.mjs
describe(`entries without an injectable fetch`, function() {
    this.timeout(180000)

    let fr = createFakeRun('ensureBinsEntries')
    let { fdt, manifest, sha256, name, pkgName, mirror, fpFakeFfmpeg, netCalls, spawnCalls, ffCalls, setEnv } = fr

    before(fr.install)
    after(fr.uninstall)
    beforeEach(fr.reset)

    it(`should catch a call to the global fetch (the interception below is effective)`, async function() {
        //對照案: 不離線且未注入fetch時, 下載核心使用全域fetch, 本攔截必須記錄到, 其他案之netCalls為空才有意義
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cache-probe') })
        let err = await ensureBins({ mirror: '', offline: false, maxAttempts: 1, retryDelayMs: 0 }).catch((e) => e)
        assert.strict.equal(err instanceof Error, true)
        assert.strict.equal(netCalls.length > 0, true)
        assert.strict.equal(netCalls[0], `https://raw.githubusercontent.com/${manifest.repo}/master/bin/manifest.json`, netCalls[0]) //主幹模式先取主幹清單
        assert.strict.equal(netCalls.includes(`https://raw.githubusercontent.com/${manifest.repo}/master/bin/yt-dlp.exe`), true) //取不到清單退回基準清單後, 自master取exe
    })

    it(`should attach ensureBins to the main function as a static property (E2)`, function() {
        assert.strict.equal(WDwloadDlp.ensureBins, ensureBins)
    })

    it(`should run the yt-dlp.exe obtained by ensureBins from the local mirror, and the ffmpeg.exe obtained by WFfmpeg.ensureBins, without network, without changing the working directory, writing the download only under the temporary folder of the system (D1, O3, E2)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let cache = path.join(fdt, 'cache-a')
        setEnv({ W_BIN_CACHE: cache, W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' })
        let fdOut = path.join(fdt, 'out')
        fs.mkdirSync(fdOut, { recursive: true })
        let fp = path.join(fdOut, 'a.mp4')
        let cwd0 = process.cwd()
        let progs = []
        let r = await WDwloadDlp('https://example.invalid/v', fp, { funProg: (prog, nn, na) => progs.push([prog, nn, na]) })
        assert.strict.equal(r, 'ok')
        assert.strict.deepStrictEqual(netCalls, []) //未連網

        //啟動者為ensureBins回傳之路徑(快取夾內之已校驗檔), 不是bin/yt-dlp.exe或他處之檔
        assert.strict.equal(spawnCalls.length, 1)
        let c = spawnCalls[0]
        let fpExp = path.join(cache, pkgName, sha256, name)
        assert.strict.equal(c.prog, fpExp)
        assert.strict.notEqual(path.resolve(c.prog).toLowerCase(), path.resolve('bin/yt-dlp.exe').toLowerCase())
        assert.strict.deepStrictEqual(await hashOf(fpExp), { sha256, size: manifest.files[0].size })

        //ffmpeg位置為WFfmpeg.ensureBins回傳之路徑, 且只取ffmpeg.exe
        assert.strict.equal(c.args[c.args.indexOf('--ffmpeg-location') + 1], fpFakeFfmpeg)
        assert.strict.equal(ffCalls.length, 1)
        assert.strict.deepStrictEqual(ffCalls[0].names, 'ffmpeg.exe')

        //資料交換檔不寫執行檔所在夾: 下載落在作業系統暫存夾, 執行檔所在夾只有執行檔本身
        let fpO = path.resolve(c.args[c.args.indexOf('-o') + 1])
        assert.strict.equal(fpO.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep), true, fpO)
        assert.strict.equal(fpO.toLowerCase().startsWith(path.resolve(cache).toLowerCase() + path.sep), false, fpO)
        assert.strict.deepStrictEqual(fs.readdirSync(path.dirname(fpExp)), [name])
        assert.strict.equal(fs.existsSync(path.dirname(fpO)), false) //結束後整個工作夾已刪除(見api-workFolder)

        //不切換工作路徑(process.chdir為全程序狀態, 併發呼叫會互相干擾)
        assert.strict.equal(c.cwd, cwd0)
        assert.strict.equal(process.cwd(), cwd0)

        //輸出
        assert.strict.equal(fs.readFileSync(fp, 'utf8'), 'FAKE-MP4 https://example.invalid/v')
        assert.strict.equal(progs.length > 0 && progs[progs.length - 1][0] === 100, true)
    })

    it(`should reject with "[exeNotReady]" carrying E_OFFLINE_MISSING and the sha256 when yt-dlp.exe is not available offline, before asking for ffmpeg.exe and without starting any program (E3)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cache-b'), W_BIN_OFFLINE: '1' })
        let err = await WDwloadDlp('https://example.invalid/v', path.join(fdt, 'out', 'b.mp4')).catch((e) => e)
        assert.strict.equal(typeof err, 'string') //既有之reject型態為字串
        assert.strict.equal(err.startsWith('[exeNotReady] '), true, err)
        assert.strict.equal(err.includes('E_OFFLINE_MISSING'), true, err)
        assert.strict.equal(err.includes(sha256), true, err)
        assert.strict.deepStrictEqual(netCalls, [])
        assert.strict.deepStrictEqual(spawnCalls, [])
        assert.strict.deepStrictEqual(ffCalls, [])
    })

    it(`should reject with "[exeNotReady]" and start nothing when ffmpeg.exe can not be obtained (E3)`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cache-c'), W_BIN_MIRROR: mirror, W_BIN_OFFLINE: '1' })
        fr.ffMode = 'fail'
        let err = await WDwloadDlp('https://example.invalid/v', path.join(fdt, 'out', 'c.mp4')).catch((e) => e)
        assert.strict.equal(typeof err, 'string')
        assert.strict.equal(err.startsWith('[exeNotReady] '), true, err)
        assert.strict.equal(err.includes('E_FAKE_FFMPEG'), true, err)
        assert.strict.deepStrictEqual(spawnCalls, [])
        assert.strict.deepStrictEqual(netCalls, [])
    })

    it(`should keep the existing input checks of WDwloadDlp unchanged`, async function() {
        if (!isWindows()) {
            this.skip()
        }
        let err = await WDwloadDlp('', path.join(fdt, 'out', 'd.mp4')).catch((e) => e)
        assert.strict.equal(err, '[invalidUrl] url is not an effective string')
        assert.strict.deepStrictEqual(ffCalls, [])
    })

})
