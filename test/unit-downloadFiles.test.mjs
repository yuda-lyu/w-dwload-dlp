import fs from 'fs'
import path from 'path'
import assert from 'assert'
import zlib from 'zlib'
import { Writable } from 'stream'
import downloadFiles from '../src/downloadFiles.mjs'
import { sha256, mkBuf, mkSpec, mkBad, sendBuf, sendChunked, sendJson, send, startServer, newDir, rmDir, ls } from './tools/dlpServer.mjs'


//本機HTTP伺服器模擬GitHub raw, 不連外網; 暫存於test/_tmp/downloadFiles/
//每個案例的預期皆翻譯自任務規格: 驗證後才落檔, 任何失敗路徑不在正式檔名留下未驗證或不完整之檔, 重試與時間有界, 錯誤訊息可據以處置

let NAME = 'downloadFiles'
let good = mkBuf(300000, 1)
let spec = mkSpec(good)
let srv = null


//opt, 測試用設定(縮短間隔與逾時)
function opt(extra = {}) {
    return { urlBase: srv.urlBase, log: () => {}, retryDelayMs: 5, stallMs: 2000, totalMs: 20000, ...extra }
}


//fail, 等待reject並回傳錯誤, 若成功則測試失敗
async function fail(pm) {
    let err = null
    try {
        await pm
    }
    catch (e) {
        err = e
    }
    assert.ok(err, 'downloadFiles should reject')
    return err
}


//fsx, 以真實fs為底覆寫部分函式(故障注入)
function fsx(over) {
    return { ...fs, ...over }
}


function eperm(msg) {
    return Object.assign(new Error(`EPERM: operation not permitted, ${msg}`), { code: 'EPERM' })
}


describe('downloadFiles', function() {

    this.timeout(60000)

    before(async function() {
        srv = await startServer(8741)
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


    describe('成功', function() {

        it('清單與exe相符: 落檔為yt-dlp.exe, 內容雜湊相符, 目錄無殘留, 清單與exe各請求一次', async function() {
            let fd = newDir(NAME, 'ok')
            let fp = await downloadFiles(fd, opt())
            assert.strictEqual(fp, path.join(fd, 'yt-dlp.exe'))
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
            assert.strictEqual(sha256(fs.readFileSync(fp)), spec.sha256)
            assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 1 })
        })

        it('尾端無斜線之urlBase亦可; fdBase尾端有無斜線皆可', async function() {
            let fd = newDir(NAME, 'okSlash')
            await downloadFiles(`${fd}/`, opt({ urlBase: srv.urlBase.replace(/\/$/, '') }))
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('fdBase不存在則建立', async function() {
            let fd = path.join(newDir(NAME, 'okMkdir'), 'a', 'b')
            await downloadFiles(fd, opt())
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('已有舊yt-dlp.exe: 驗證通過後覆蓋', async function() {
            let fd = newDir(NAME, 'okOverwrite')
            fs.writeFileSync(path.join(fd, 'yt-dlp.exe'), 'OLD')
            await downloadFiles(fd, opt())
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('對外預設網址不變: 未給urlBase時清單與exe皆取自GitHub master分支yt-dlp/(以fetch替身記錄, 不連外網)', async function() {
            let fd = newDir(NAME, 'defUrl')
            let urls = []
            let fetchOri = globalThis.fetch
            globalThis.fetch = async (url) => {
                urls.push(String(url))
                if (String(url).endsWith('manifest.json')) {
                    return new Response(JSON.stringify(spec))
                }
                throw new TypeError('fetch failed')
            }
            try {
                await fail(downloadFiles(fd, { log: () => {}, maxAttempts: 1 }))
            }
            finally {
                globalThis.fetch = fetchOri
            }
            assert.deepStrictEqual(urls, [
                'https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/manifest.json',
                'https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/yt-dlp.exe',
            ])
            assert.deepStrictEqual(ls(fd), [])
        })

    })


    describe('雜湊與大小不符', function() {

        it('同大小不同內容: 重試至上限後失敗, 錯誤訊息含預期與實際雜湊/哪一步/建議, 不留正式檔與暫存檔', async function() {
            let fd = newDir(NAME, 'hash')
            let bad = mkBad(good)
            srv.onExe = (n, req, res) => sendBuf(res, bad)
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 3 })))
            assert.strictEqual(err.code, 'E_HASH_MISMATCH')
            assert.strictEqual(err.step, 'verify')
            assert.strictEqual(err.attempts, 3)
            assert.ok(err.message.includes(`expected ${spec.sha256.slice(0, 16)}`), err.message)
            assert.ok(err.message.includes(`got ${sha256(bad).slice(0, 16)}`), err.message)
            assert.ok(err.message.includes('attempt 3 of 3'), err.message)
            assert.ok(err.message.includes('hint:'), err.message)
            assert.strictEqual(srv.hits.exe, 3, '重試次數有界')
            assert.deepStrictEqual(ls(fd), [])
        })

        it('快取時間差(先得到舊exe後得到新exe): 重試後成功', async function() {
            let fd = newDir(NAME, 'skewExe')
            srv.onExe = (n, req, res) => sendBuf(res, n === 1 ? mkBad(good) : good)
            await downloadFiles(fd, opt())
            assert.strictEqual(srv.hits.exe, 2)
            assert.strictEqual(srv.hits.manifest, 2, '每次重試前重新取清單')
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
        })

        it('快取時間差(先得到舊清單後得到新清單): 重新取清單後成功', async function() {
            let fd = newDir(NAME, 'skewManifest')
            let old = mkSpec(mkBuf(300000, 2), '2026.10.21')
            srv.onManifest = (n, req, res) => sendJson(res, n === 1 ? old : spec)
            await downloadFiles(fd, opt())
            assert.strictEqual(srv.hits.manifest, 2)
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('chunked且乾淨結束但內容短少(標頭無法得知): 以大小不符失敗, 不留檔', async function() {
            let fd = newDir(NAME, 'truncClean')
            srv.onExe = (n, req, res) => sendChunked(res, good.subarray(0, 200000))
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 2 })))
            assert.strictEqual(err.code, 'E_SIZE_MISMATCH')
            assert.ok(err.message.includes('expected 300000 bytes, got 200000 bytes'), err.message)
            assert.strictEqual(srv.hits.exe, 2)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('標頭宣告大小與清單不同: 不下載本文即失敗', async function() {
            let fd = newDir(NAME, 'sizeAnnounced')
            srv.onExe = (n, req, res) => sendBuf(res, good.subarray(0, 200000))
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1 })))
            assert.strictEqual(err.code, 'E_SIZE_MISMATCH')
            assert.ok(err.message.includes('announces 200000'), err.message)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('內容超過清單大小: 中止下載並失敗, 不留檔', async function() {
            let fd = newDir(NAME, 'oversize')
            srv.onExe = (n, req, res) => sendChunked(res, Buffer.concat([good, Buffer.alloc(100000, 1)]))
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1 })))
            assert.strictEqual(err.code, 'E_SIZE_MISMATCH')
            assert.ok(err.message.includes('received more'), err.message)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('驗證失敗時既有舊yt-dlp.exe不被動到', async function() {
            let fd = newDir(NAME, 'oldKept')
            fs.writeFileSync(path.join(fd, 'yt-dlp.exe'), 'OLD')
            srv.onExe = (n, req, res) => sendBuf(res, mkBad(good))
            await fail(downloadFiles(fd, opt({ maxAttempts: 1 })))
            assert.strictEqual(fs.readFileSync(path.join(fd, 'yt-dlp.exe'), 'utf8'), 'OLD')
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

    })


    describe('下載中斷與逾時', function() {

        it('傳輸中連線被切斷: 失敗, 不留正式檔與暫存檔', async function() {
            let fd = newDir(NAME, 'reset')
            srv.onExe = (n, req, res) => {
                res.writeHead(200, { 'content-length': good.length })
                res.write(good.subarray(0, 100000))
                setTimeout(() => res.socket.destroy(), 30)
            }
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 2 })))
            assert.strictEqual(err.code, 'E_NETWORK')
            assert.strictEqual(srv.hits.exe, 2)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('第一次中斷第二次完整: 重試後成功', async function() {
            let fd = newDir(NAME, 'resetThenOk')
            srv.onExe = (n, req, res) => {
                if (n === 1) {
                    res.writeHead(200, { 'content-length': good.length })
                    res.write(good.subarray(0, 100000))
                    setTimeout(() => res.socket.destroy(), 30)
                    return
                }
                sendBuf(res, good)
            }
            await downloadFiles(fd, opt())
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
        })

        it('連線被拒: 重試至上限後失敗', async function() {
            let fd = newDir(NAME, 'refused')
            let tmp = await startServer(8790)
            let urlBase = tmp.urlBase
            await tmp.close()
            let err = await fail(downloadFiles(fd, opt({ urlBase, maxAttempts: 2 })))
            assert.strictEqual(err.code, 'E_NETWORK')
            assert.strictEqual(err.step, 'manifest')
            assert.strictEqual(err.attempts, 2)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('傳輸停滯(連續stallMs沒有資料): 中止並失敗, 不留檔', async function() {
            let fd = newDir(NAME, 'stall')
            srv.onExe = (n, req, res) => {
                res.writeHead(200, { 'content-length': good.length })
                res.write(good.subarray(0, 1000))
            }
            let t0 = Date.now()
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1, stallMs: 300 })))
            assert.strictEqual(err.code, 'E_TIMEOUT')
            assert.ok(Date.now() - t0 < 5000)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('持續有資料但整體超過totalMs: 以時間用盡失敗且不重試, 不留檔', async function() {
            let fd = newDir(NAME, 'total')
            srv.onExe = (n, req, res) => {
                res.writeHead(200, { 'content-length': good.length })
                let iv = setInterval(() => res.write(good.subarray(0, 1000)), 40)
                res.on('close', () => clearInterval(iv))
            }
            let t0 = Date.now()
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 3, totalMs: 500 })))
            assert.strictEqual(err.code, 'E_TIMEOUT_TOTAL')
            assert.ok(Date.now() - t0 < 5000)
            assert.strictEqual(srv.hits.exe, 1, '時間用盡不再重試')
            assert.deepStrictEqual(ls(fd), [])
        })

        it('重試間隔加總會超過totalMs時提前停止: 總耗時有上限', async function() {
            let fd = newDir(NAME, 'budget')
            srv.onExe = (n, req, res) => sendBuf(res, mkBad(good))
            let t0 = Date.now()
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 10, retryDelayMs: 600, totalMs: 1000 })))

            //正常排程: 第1次失敗後等0.6秒、第2次失敗後再等1.2秒會超過上限而提前停止(E_HASH_MISMATCH+retry stopped);
            //主執行緒被長時間擋住而晚醒時, 下一次請求前才發現時間用盡(E_TIMEOUT_TOTAL), 兩者皆為有界之合法結局
            assert.ok(['E_HASH_MISMATCH', 'E_TIMEOUT_TOTAL'].includes(err.code), err.code)
            if (err.code === 'E_HASH_MISMATCH') {
                assert.ok(err.message.includes('retry stopped'), err.message)
            }
            assert.ok(srv.hits.exe >= 1 && srv.hits.exe <= 3, `hits.exe=${srv.hits.exe}`)
            assert.ok(Date.now() - t0 < 3000, `elapsed=${Date.now() - t0}`)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('整體時間為清單與exe共同累計(非每個請求各給一份): 清單150ms+exe150ms > totalMs 240ms 即失敗', async function() {
            let fd = newDir(NAME, 'totalShared')
            srv.onManifest = (n, req, res) => setTimeout(() => sendJson(res, spec), 150)
            srv.onExe = (n, req, res) => setTimeout(() => sendBuf(res, good), 150)
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 3, totalMs: 240 })))
            assert.strictEqual(err.code, 'E_TIMEOUT_TOTAL')
            assert.strictEqual(srv.hits.manifest, 1, '時間用盡不再重試')
            assert.deepStrictEqual(ls(fd), [])
        })

        it('持續有資料(chunk間距小於stallMs、總傳輸長於stallMs)的exe不會被當成停滯: 成功', async function() {
            let fd = newDir(NAME, 'heartbeatExe')
            srv.onExe = (n, req, res) => {
                res.writeHead(200, { 'content-length': good.length })
                let parts = 6
                let step = Math.ceil(good.length / parts)
                let i = 0
                let iv = setInterval(() => {
                    res.write(good.subarray(i * step, (i + 1) * step))
                    i++
                    if (i >= parts) {
                        clearInterval(iv)
                        res.end()
                    }
                }, 120)
                res.on('close', () => clearInterval(iv))
            }
            await downloadFiles(fd, opt({ maxAttempts: 1, stallMs: 400 })) //總傳輸約0.7秒 > stallMs
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
        })

        it('持續有資料的清單不會被當成停滯: 成功', async function() {
            let fd = newDir(NAME, 'heartbeatManifest')
            srv.onManifest = (n, req, res) => {
                let s = JSON.stringify(spec)
                let parts = [s.slice(0, 20), s.slice(20, 60), s.slice(60, 100), s.slice(100)]
                res.writeHead(200, { 'content-type': 'application/json' })
                let i = 0
                let iv = setInterval(() => {
                    res.write(parts[i])
                    i++
                    if (i >= parts.length) {
                        clearInterval(iv)
                        res.end()
                    }
                }, 150)
                res.on('close', () => clearInterval(iv))
            }
            await downloadFiles(fd, opt({ maxAttempts: 1, stallMs: 400 })) //總傳輸約0.6秒 > stallMs
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('本文已收完但寫出/關閉階段卡住: 以停滯逾時中止並失敗(寫入端也受時間界限約束), 不留正式檔', async function() {
            let fd = newDir(NAME, 'writeHang')
            let fsw = fsx({
                createWriteStream: () => new Writable({
                    write(chunk, enc, cb) {
                        cb()
                    },
                    final() {
                        //永不完成
                    },
                }),
            })
            let t0 = Date.now()
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1, stallMs: 300, fs: fsw })))
            assert.strictEqual(err.code, 'E_TIMEOUT')
            assert.ok(Date.now() - t0 < 5000, `elapsed=${Date.now() - t0}`)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('系統時間被往後調整(Date.now跳1小時)不影響整體時間計算: 健康下載仍成功(用單調時計)', async function() {
            let fd = newDir(NAME, 'clockJump')
            let dateNowOri = Date.now
            srv.onManifest = (n, req, res) => {
                sendJson(res, spec)
                Date.now = () => dateNowOri() + 3600000
            }
            try {
                await downloadFiles(fd, opt({ maxAttempts: 1 }))
            }
            finally {
                Date.now = dateNowOri
            }
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

    })


    describe('清單取不到或格式不符', function() {

        it('清單404: 失敗, 不重試, 不請求exe(不退回未驗證之下載), 不留檔', async function() {
            let fd = newDir(NAME, 'man404')
            srv.onManifest = (n, req, res) => send(res, 404, 'not found')
            let err = await fail(downloadFiles(fd, opt()))
            assert.strictEqual(err.code, 'E_MANIFEST_HTTP')
            assert.strictEqual(err.status, 404)
            assert.strictEqual(err.step, 'manifest')
            assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 0 })
            assert.deepStrictEqual(ls(fd), [])
        })

        it('清單5xx: 重試, 之後取到則成功', async function() {
            let fd = newDir(NAME, 'man503retry')
            srv.onManifest = (n, req, res) => (n === 1 ? send(res, 503, 'busy') : sendJson(res, spec))
            await downloadFiles(fd, opt())
            assert.strictEqual(srv.hits.manifest, 2)
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('清單持續5xx: 重試至上限後失敗, 不請求exe', async function() {
            let fd = newDir(NAME, 'man503')
            srv.onManifest = (n, req, res) => send(res, 503, 'busy')
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 2 })))
            assert.strictEqual(err.code, 'E_MANIFEST_HTTP')
            assert.deepStrictEqual(srv.hits, { manifest: 2, exe: 0 })
            assert.deepStrictEqual(ls(fd), [])
        })

        let sp = (o) => JSON.stringify({ ...spec, ...o })
        let spDel = (k) => {
            let o = { ...spec }
            delete o[k]
            return JSON.stringify(o)
        }
        let bads = {
            '非JSON': 'not json',
            '空本文': '',
            '根為陣列': '[]',
            '根為null': 'null',
            '缺sha256': spDel('sha256'),
            '缺size': spDel('size'),
            '缺version': spDel('version'),
            '缺file': spDel('file'),
            '缺schema': spDel('schema'),
            'schema為2': sp({ schema: 2 }),
            'sha256大寫': sp({ sha256: spec.sha256.toUpperCase() }),
            'sha256僅63碼': sp({ sha256: spec.sha256.slice(1) }),
            'sha256含非十六進位': sp({ sha256: `g${spec.sha256.slice(1)}` }),
            'size為字串': sp({ size: String(spec.size) }),
            'size為0': sp({ size: 0 }),
            'size為負': sp({ size: -1 }),
            'size為小數': sp({ size: 1.5 }),
            'file為其他檔名': sp({ file: 'other.exe' }),
            'file含路徑跳脫': sp({ file: '../yt-dlp.exe' }),
            'version為空字串': sp({ version: '' }),
            'version含空白': sp({ version: '2026 10 26' }),
            '本文超過64KiB': ' '.repeat(70000) + JSON.stringify(spec),
        }
        for (let [title, body] of Object.entries(bads)) {
            it(`清單格式錯(${title}): 失敗, 不重試, 不請求exe, 不留檔`, async function() {
                let fd = newDir(NAME, 'manBad')
                srv.onManifest = (n, req, res) => send(res, 200, body)
                let err = await fail(downloadFiles(fd, opt()))
                assert.strictEqual(err.code, 'E_MANIFEST_FORMAT')
                assert.strictEqual(err.step, 'manifest')
                assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 0 })
                assert.deepStrictEqual(ls(fd), [])
            })
        }

    })


    describe('內容編碼', function() {

        it('exe以gzip傳輸(Content-Length為壓縮後大小, 與清單size不同): 對解碼後內容驗證, 成功', async function() {
            let fd = newDir(NAME, 'gzipExe')
            let gz = zlib.gzipSync(good)
            assert.notStrictEqual(gz.length, good.length, '夾具須使壓縮後大小不同於原大小')
            srv.onExe = (n, req, res) => {
                res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': gz.length })
                res.end(gz)
            }
            await downloadFiles(fd, opt({ maxAttempts: 1 }))
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('清單以gzip傳輸且解碼後超過64KiB: E_MANIFEST_FORMAT, 不請求exe', async function() {
            let fd = newDir(NAME, 'gzipManifestBig')
            let gz = zlib.gzipSync(' '.repeat(70000) + JSON.stringify(spec))
            assert.ok(gz.length < 65536, '壓縮後須小於64KiB才能證明是以解碼後大小檢查')
            srv.onManifest = (n, req, res) => {
                res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': gz.length })
                res.end(gz)
            }
            let err = await fail(downloadFiles(fd, opt()))
            assert.strictEqual(err.code, 'E_MANIFEST_FORMAT')
            assert.deepStrictEqual(srv.hits, { manifest: 1, exe: 0 })
            assert.deepStrictEqual(ls(fd), [])
        })

    })


    describe('限流與逾時之處置建議', function() {

        for (let [status, re] of [[429, /limiting the request rate/], [408, /timed out waiting/]]) {
            for (let who of ['manifest', 'exe']) {
                it(`${who} HTTP ${status}: 視為暫時性錯誤而重試, 建議為稍後重試(不是「檔案不存在」)`, async function() {
                    let fd = newDir(NAME, `hint${status}${who}`)
                    let key = who === 'manifest' ? 'onManifest' : 'onExe'
                    srv[key] = (n, req, res) => send(res, status, 'x')
                    let err = await fail(downloadFiles(fd, opt({ maxAttempts: 2 })))
                    assert.strictEqual(err.status, status)
                    assert.strictEqual(err.attempts, 2)
                    assert.ok(re.test(err.message), err.message)
                    assert.ok(!err.message.includes('does not exist'), err.message)
                    assert.deepStrictEqual(ls(fd), [])
                })
            }
        }

    })


    describe('exe取不到', function() {

        it('exe 404: 失敗, 不重試, 不留檔', async function() {
            let fd = newDir(NAME, 'exe404')
            srv.onExe = (n, req, res) => send(res, 404, 'not found')
            let err = await fail(downloadFiles(fd, opt()))
            assert.strictEqual(err.code, 'E_HTTP')
            assert.strictEqual(err.status, 404)
            assert.strictEqual(srv.hits.exe, 1)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('exe 503後恢復: 重試後成功', async function() {
            let fd = newDir(NAME, 'exe503')
            srv.onExe = (n, req, res) => (n === 1 ? send(res, 503, 'busy') : sendBuf(res, good))
            await downloadFiles(fd, opt())
            assert.strictEqual(srv.hits.exe, 2)
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

    })


    describe('檔案系統故障(注入)', function() {

        it('驗證失敗且暫存檔刪不掉: 如實回報暫存檔路徑與原因, 不稱已清除; 正式檔名無檔', async function() {
            let fd = newDir(NAME, 'cleanFail')
            srv.onExe = (n, req, res) => sendBuf(res, mkBad(good))
            let fsw = fsx({
                rmSync: (p, o) => {
                    if (String(p).endsWith('.part')) {
                        throw eperm('unlink')
                    }
                    return fs.rmSync(p, o)
                },
            })
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1, fs: fsw })))
            assert.strictEqual(err.code, 'E_HASH_MISMATCH')
            let parts = ls(fd)
            assert.strictEqual(parts.length, 1, '暫存檔確實還在')
            assert.ok(parts[0].endsWith('.part'))
            assert.ok(err.message.includes('could not be removed'), err.message)
            assert.ok(err.message.includes('remove it manually'), err.message)
            assert.ok(err.message.includes(parts[0]), err.message)
            assert.strictEqual(err.cleanupError.code, 'EPERM')
            fs.rmSync(path.join(fd, parts[0]), { force: true })
        })

        it('更名一直失敗: E_RENAME, 重試更名, 舊檔不動, 暫存檔已清除', async function() {
            let fd = newDir(NAME, 'renameFail')
            let old = mkBad(good) //與清單同大小但內容不同: 不可被當成「別的行程已完成同一下載」
            fs.writeFileSync(path.join(fd, 'yt-dlp.exe'), old)
            let calls = 0
            let fsw = fsx({
                renameSync: () => {
                    calls++
                    throw eperm('rename')
                },
            })
            let err = await fail(downloadFiles(fd, opt({ fs: fsw })))
            assert.strictEqual(err.code, 'E_RENAME')
            assert.strictEqual(err.step, 'rename')
            assert.strictEqual(calls, 5)
            assert.strictEqual(srv.hits.exe, 1, '更名失敗不重新下載')
            assert.ok(fs.readFileSync(path.join(fd, 'yt-dlp.exe')).equals(old))
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
        })

        it('某次嘗試暫存檔刪不掉、之後嘗試成功: 下載成功, 殘留暫存檔以warning如實輸出(不稱已清除)', async function() {
            let fd = newDir(NAME, 'cleanFailThenOk')
            srv.onExe = (n, req, res) => sendBuf(res, n === 1 ? mkBad(good) : good)
            let fsw = fsx({
                rmSync: (p, o) => {
                    if (String(p).endsWith('.part') && fs.existsSync(p)) {
                        throw eperm('unlink')
                    }
                    return fs.rmSync(p, o)
                },
            })
            let logs = []
            let fp = await downloadFiles(fd, opt({ fs: fsw, log: (...a) => logs.push(a.join(' ')) }))
            assert.strictEqual(sha256(fs.readFileSync(fp)), spec.sha256)
            let parts = ls(fd).filter((v) => v.endsWith('.part'))
            assert.strictEqual(parts.length, 1, '第1次嘗試之暫存檔確實還在')
            assert.ok(logs.some((v) => v.includes('could not be removed') && v.includes(parts[0])), logs.join('\n'))
            fs.rmSync(path.join(fd, parts[0]), { force: true })
        })

        it('暫存檔名已被別的下載占用(排他建立失敗): E_FS(EEXIST), 不刪除不屬於本次下載的那個檔', async function() {
            let fd = newDir(NAME, 'collide')
            let fsw = fsx({
                createWriteStream: (p, o) => {
                    fs.writeFileSync(p, 'BELONGS-TO-ANOTHER-DOWNLOAD') //模擬同名暫存檔已由別的下載建立
                    return fs.createWriteStream(p, o)
                },
            })
            let err = await fail(downloadFiles(fd, opt({ maxAttempts: 1, fs: fsw })))
            assert.strictEqual(err.code, 'E_FS')
            assert.strictEqual(err.cause.cause.code, 'EEXIST') //err.cause為本模組之E_FS錯誤, 其cause為系統錯誤
            let parts = ls(fd).filter((v) => v.endsWith('.part'))
            assert.strictEqual(parts.length, 1, '別人的暫存檔仍在')
            assert.strictEqual(fs.readFileSync(path.join(fd, parts[0]), 'utf8'), 'BELONGS-TO-ANOTHER-DOWNLOAD')
            assert.ok(!ls(fd).includes('yt-dlp.exe'))
            fs.rmSync(path.join(fd, parts[0]), { force: true })
        })

        it('更名失敗但正式檔名已是清單所載內容(別的行程完成同一下載): 視為成功', async function() {
            let fd = newDir(NAME, 'renameRace')
            let fsw = fsx({
                renameSync: (a, b) => {
                    fs.writeFileSync(b, good)
                    throw eperm('rename')
                },
            })
            await downloadFiles(fd, opt({ fs: fsw }))
            assert.deepStrictEqual(ls(fd), ['yt-dlp.exe'])
            assert.strictEqual(sha256(fs.readFileSync(path.join(fd, 'yt-dlp.exe'))), spec.sha256)
        })

        it('寫入暫存檔失敗(磁碟已滿): E_FS, 不重試, 建議檢查磁碟空間', async function() {
            let fd = newDir(NAME, 'writeFail')
            let fsw = fsx({
                createWriteStream: () => new Writable({
                    write(chunk, enc, cb) {
                        cb(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -28, syscall: 'write' }))
                    },
                }),
            })
            let err = await fail(downloadFiles(fd, opt({ fs: fsw })))
            assert.strictEqual(err.code, 'E_FS')
            assert.ok(err.message.includes('ENOSPC'), err.message)
            assert.ok(err.message.includes('disk space'), err.message)
            assert.strictEqual(srv.hits.exe, 1)
            assert.deepStrictEqual(ls(fd), [])
        })

        it('資料夾無法建立: E_FS, 不連線', async function() {
            let fd = newDir(NAME, 'mkdirFail')
            fs.writeFileSync(path.join(fd, 'blocker'), 'x')
            let err = await fail(downloadFiles(path.join(fd, 'blocker', 'sub'), opt()))
            assert.strictEqual(err.code, 'E_FS')
            assert.strictEqual(err.step, 'prepare')
            assert.deepStrictEqual(srv.hits, { manifest: 0, exe: 0 })
        })

    })


    describe('輸入檢查', function() {

        for (let v of [undefined, null, '', 123]) {
            it(`fdBase為${JSON.stringify(v)}: 拒絕`, async function() {
                let err = await fail(downloadFiles(v, opt()))
                assert.strictEqual(err.code, 'E_ARG')
                assert.strictEqual(err.step, 'argument')
                assert.strictEqual(err.attempts, 0)
                assert.deepStrictEqual(srv.hits, { manifest: 0, exe: 0 })
            })
        }

        it('opt為null: 視同預設設定(不拋TypeError)', async function() {
            let fd = newDir(NAME, 'optNull')
            let fetchOri = globalThis.fetch
            globalThis.fetch = async () => new Response('x', { status: 404 }) //確定性錯誤, 避免等待重試間隔
            let err = null
            try {
                err = await fail(downloadFiles(fd, null))
            }
            finally {
                globalThis.fetch = fetchOri
            }
            assert.strictEqual(err.code, 'E_MANIFEST_HTTP')
        })

    })

})
