import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'


//測試樣本之本機供應(rulebook R6): 測試不再於執行時自jsDelivr下載m3u8樣本, 改由本檔之HTTP服務(只綁127.0.0.1, 埠由作業系統配發)供應
//樣本即w-demores之res/video/aigen_hls: 播放清單(PLAYLIST, 與原檔之LF內容逐位元相同, 以常數內建而不存檔, 免git換行轉換使雜湊改變)與唯一之分段segment_000.ts(存於test/fixtures/hls/)
//未知路徑一律404並記入requests, 使新增之外部依賴在測試中現形
let dirTest = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let fpSegment = path.join(dirTest, 'fixtures', 'hls', 'segment_000.ts')

let PLAYLIST = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:8.041667,\nsegment_000.ts\n#EXT-X-ENDLIST\n'

//樣本之雜湊(w-demores原檔; 播放清單為LF內容)
let SAMPLE_SHA256 = {
    playlist: 'fde1b40cdde8753817e4b0f7309d7b9971c84f72ccc29e595ee6248872f517eb',
    segment: 'bdecdb0a8c625d42962fcda111163598795e83f033590c8938b19ffc71e0c27c',
}


/**
 * startSampleServer, 啟動本機樣本服務
 *
 * @returns {Promise} resolve為{ origin, host(實際綁定位址), urls: { m3u8 }, requests, close }; requests為[{ method, url, status, range }]之同一陣列(就地增加); close()為Promise, 關閉並等連線結束
 */
function startSampleServer() {
    let requests = []
    let segment = fs.readFileSync(fpSegment)

    let server = http.createServer((req, res) => {
        let rec = { method: req.method, url: req.url, status: 0, range: req.headers.range || null }
        requests.push(rec)
        let send = (status, headers, body) => {
            rec.status = status
            res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
            res.end(req.method === 'HEAD' ? undefined : body)
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return send(405, { 'Content-Type': 'text/plain' }, 'method not allowed')
        }
        let pathname = String(req.url).split('?')[0]
        if (pathname === '/hls/playlist.m3u8') {
            let body = Buffer.from(PLAYLIST, 'utf8')
            return send(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Length': body.length }, body)
        }
        if (pathname === '/hls/segment_000.ts') {
            let m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
            if (m && (m[1] !== '' || m[2] !== '')) {
                let n = segment.length
                let a = m[1] === '' ? Math.max(0, n - Number(m[2])) : Number(m[1])
                let b = m[1] === '' || m[2] === '' ? n - 1 : Math.min(Number(m[2]), n - 1)
                if (a > b || a >= n) {
                    return send(416, { 'Content-Range': `bytes */${n}` }, '')
                }
                let body = segment.subarray(a, b + 1)
                return send(206, { 'Content-Type': 'video/mp2t', 'Content-Range': `bytes ${a}-${b}/${n}`, 'Content-Length': body.length, 'Accept-Ranges': 'bytes' }, body)
            }
            return send(200, { 'Content-Type': 'video/mp2t', 'Content-Length': segment.length, 'Accept-Ranges': 'bytes' }, segment)
        }
        return send(404, { 'Content-Type': 'text/plain' }, 'not found')
    })

    //closeServer, 關閉服務並等連線結束(含保持連線者)
    let closeServer = () => {
        return new Promise((resolve) => {
            server.close(() => {
                resolve()
            })
            server.closeAllConnections()
        })
    }

    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            let addr = server.address()
            let origin = `http://127.0.0.1:${addr.port}`
            resolve({
                origin,
                host: addr.address, //實際綁定之位址(須為127.0.0.1)
                urls: { m3u8: `${origin}/hls/playlist.m3u8` },
                requests,
                close: closeServer,
            })
        })
    })
}


/**
 * isolateExternal, 令本程序之子行程yt-dlp.exe(Python)之HTTP(S)請求一律經一個不通之代理, 只有127.0.0.1與localhost直連; 用於證明yt-dlp.exe只取用本機樣本(任何對外請求即連線失敗, 與網路是否暢通無關)
 * 限制: 只截斷會讀HTTP_PROXY、HTTPS_PROXY、NO_PROXY之程式(yt-dlp.exe); Node自身之fetch預設不讀這些變數, 不受影響(如WDwloadDlp內經ensureBins取GitHub主幹清單, 取不到時退回基準清單; 冷快取時之ffmpeg.exe下載亦同), 故不得據此宣稱測試整體零對外請求
 *
 * @returns {Function} 還原函數(恢復環境變數原值)
 */
function isolateExternal() {
    let keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
    let old = {}
    for (let k of keys) {
        old[k] = process.env[k]
    }
    process.env.HTTP_PROXY = 'http://127.0.0.1:9'
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
    process.env.NO_PROXY = '127.0.0.1,localhost'
    return () => {
        for (let k of keys) {
            if (old[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = old[k]
            }
        }
    }
}


export { startSampleServer, isolateExternal, PLAYLIST, SAMPLE_SHA256 }
