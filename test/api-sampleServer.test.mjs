import fs from 'fs'
import net from 'net'
import http from 'http'
import crypto from 'crypto'
import assert from 'assert'
import { startSampleServer, isolateExternal, PLAYLIST, SAMPLE_SHA256 } from './tools/sampleServer.mjs'


//規格: rulebook R6: 測試不於執行時自jsDelivr下載樣本, 改由本機HTTP服務供應(樣本即w-demores之aigen_hls); 未知路徑404並記錄, 使新增之外部依賴現形
//本檔以真HTTP請求驗證服務本身(真實連同yt-dlp.exe之消費由dw_m3u8.test.mjs、dw_subtitle.test.mjs驗證)

let sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

//get, 以node:http發請求(不經代理), 回傳{ status, headers, body }
let get = (url, opt = {}) => {
    return new Promise((resolve, reject) => {
        let req = http.request(url, { method: opt.method || 'GET', headers: opt.headers || {}, agent: false }, (res) => {
            let bufs = []
            res.on('data', (v) => bufs.push(v))
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs) }))
        })
        req.on('error', reject)
        req.end()
    })
}


describe(`sampleServer (the local supply of the m3u8 sample, R6)`, function() {

    let srv = null
    before(async function() {
        srv = await startSampleServer()
    })
    after(async function() {
        if (srv) {
            await srv.close()
        }
    })

    it(`should bind 127.0.0.1 only with an OS assigned port`, function() {
        assert.strict.match(srv.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
        assert.strict.equal(srv.urls.m3u8, `${srv.origin}/hls/playlist.m3u8`)
        assert.strict.equal(Number(srv.origin.split(':')[2]) > 0, true)
        assert.strict.equal(srv.host, '127.0.0.1') //實際綁定之位址(非0.0.0.0或::)
    })

    it(`should serve the playlist byte for byte as the w-demores original (LF text, sha256 pinned) with the HLS content type`, async function() {
        let r = await get(srv.urls.m3u8)
        assert.strict.equal(r.status, 200)
        assert.strict.equal(r.headers['content-type'], 'application/vnd.apple.mpegurl')
        assert.strict.equal(sha(r.body), SAMPLE_SHA256.playlist)
        assert.strict.equal(r.body.toString('utf8'), PLAYLIST)
        assert.strict.equal(r.body.toString('utf8').split('\n').includes('segment_000.ts'), true) //相對路徑之分段
        assert.strict.equal(r.body.toString('utf8').includes('\r'), false)
    })

    it(`should serve the segment byte for byte as the w-demores original (311892 bytes, sha256 pinned) from test/fixtures/hls`, async function() {
        let r = await get(`${srv.origin}/hls/segment_000.ts`)
        assert.strict.equal(r.status, 200)
        assert.strict.equal(r.headers['content-type'], 'video/mp2t')
        assert.strict.equal(r.body.length, 311892)
        assert.strict.equal(sha(r.body), SAMPLE_SHA256.segment)
        assert.strict.equal(sha(fs.readFileSync('test/fixtures/hls/segment_000.ts')), SAMPLE_SHA256.segment) //夾具檔即為w-demores原檔
    })

    it(`should answer byte ranges of the segment (206 with Content-Range), a suffix range, and 416 for an unsatisfiable range`, async function() {
        let full = fs.readFileSync('test/fixtures/hls/segment_000.ts')
        let r1 = await get(`${srv.origin}/hls/segment_000.ts`, { headers: { Range: 'bytes=10-109' } })
        assert.strict.equal(r1.status, 206)
        assert.strict.equal(r1.headers['content-range'], `bytes 10-109/${full.length}`)
        assert.strict.equal(r1.body.equals(full.subarray(10, 110)), true)
        let r2 = await get(`${srv.origin}/hls/segment_000.ts`, { headers: { Range: 'bytes=-50' } })
        assert.strict.equal(r2.status, 206)
        assert.strict.equal(r2.body.equals(full.subarray(full.length - 50)), true)
        let r3 = await get(`${srv.origin}/hls/segment_000.ts`, { headers: { Range: `bytes=${full.length + 5}-` } })
        assert.strict.equal(r3.status, 416)
    })

    it(`should answer HEAD with the headers of the resource and no body (a downloader may probe the playlist and the segment before getting them)`, async function() {
        let r1 = await get(srv.urls.m3u8, { method: 'HEAD' })
        assert.strict.equal(r1.status, 200)
        assert.strict.equal(r1.headers['content-type'], 'application/vnd.apple.mpegurl')
        assert.strict.equal(Number(r1.headers['content-length']), Buffer.byteLength(PLAYLIST))
        assert.strict.equal(r1.body.length, 0)
        let r2 = await get(`${srv.origin}/hls/segment_000.ts`, { method: 'HEAD' })
        assert.strict.equal(r2.status, 200)
        assert.strict.equal(Number(r2.headers['content-length']), 311892)
        assert.strict.equal(r2.headers['accept-ranges'], 'bytes')
        assert.strict.equal(r2.body.length, 0)
    })

    it(`should answer 404 for any other path and 405 for other methods, and record every request so that an unlisted dependency shows up`, async function() {
        let n0 = srv.requests.length
        let r1 = await get(`${srv.origin}/npm/w-demores/res/video/aigen_hls/playlist.m3u8`)
        assert.strict.equal(r1.status, 404) //jsDelivr形式之路徑不被供應
        let r2 = await get(srv.urls.m3u8, { method: 'POST' })
        assert.strict.equal(r2.status, 405)
        assert.strict.equal(srv.requests.length, n0 + 2)
        assert.strict.deepStrictEqual(srv.requests.slice(n0).map((v) => [v.method, v.status]), [['GET', 404], ['POST', 405]])
    })

    it(`should free the port when closed`, async function() {
        let s2 = await startSampleServer()
        let port = Number(s2.origin.split(':')[2])
        await s2.close()
        let err = await new Promise((resolve) => {
            let sock = net.connect({ host: '127.0.0.1', port })
            sock.on('connect', () => {
                sock.destroy()
                resolve(null)
            })
            sock.on('error', (e) => resolve(e))
        })
        assert.strict.equal(err !== null && err.code === 'ECONNREFUSED', true)
    })

})


describe(`isolateExternal (every external request of the test and of yt-dlp.exe goes to a dead proxy, R6)`, function() {

    let keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']

    it(`should point HTTP(S) at an unreachable proxy with only 127.0.0.1 and localhost direct, and restore the previous values, or remove them when there were none`, function() {
        let old = {}
        for (let k of keys) {
            old[k] = process.env[k]
        }
        try {
            //有原值: 還原原值
            process.env.HTTP_PROXY = 'http://old-proxy.invalid:1'
            process.env.HTTPS_PROXY = 'http://old-proxy.invalid:2'
            process.env.NO_PROXY = 'old.invalid'
            let restore1 = isolateExternal()
            assert.strict.equal(process.env.HTTP_PROXY, 'http://127.0.0.1:9')
            assert.strict.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:9')
            assert.strict.equal(process.env.NO_PROXY, '127.0.0.1,localhost')
            restore1()
            assert.strict.equal(process.env.HTTP_PROXY, 'http://old-proxy.invalid:1')
            assert.strict.equal(process.env.HTTPS_PROXY, 'http://old-proxy.invalid:2')
            assert.strict.equal(process.env.NO_PROXY, 'old.invalid')
            //無原值: 移除
            for (let k of keys) {
                delete process.env[k]
            }
            let restore2 = isolateExternal()
            restore2()
            for (let k of keys) {
                assert.strict.equal(process.env[k], undefined, k)
            }
        }
        finally {
            for (let k of keys) {
                if (old[k] === undefined) {
                    delete process.env[k]
                }
                else {
                    process.env[k] = old[k]
                }
            }
        }
    })

})
