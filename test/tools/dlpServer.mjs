import fs from 'fs'
import path from 'path'
import http from 'http'
import crypto from 'crypto'
import { fileURLToPath } from 'url'


//測試用本機HTTP伺服器與夾具, 供unit-downloadFiles與unit-ensureDlpExe共用, 不連外網

let __dirname = path.dirname(fileURLToPath(import.meta.url))


//fdTmpRoot, 測試臨時資料夾根(test/_tmp, 已於.gitignore)
let fdTmpRoot = path.resolve(__dirname, '..', '_tmp')


function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex')
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


//mkSpec, 由內容產生清單內容物件
function mkSpec(buf, version = '2026.10.26') {
    return { schema: 1, file: 'yt-dlp.exe', version, sha256: sha256(buf), size: buf.length }
}


//mkBad, 與原內容同長度但內容不同
function mkBad(buf) {
    let bad = Buffer.from(buf)
    bad[Math.floor(bad.length / 2)] ^= 0xff
    return bad
}


//sendBuf, 帶content-length送出
function sendBuf(res, buf, status = 200) {
    res.writeHead(status, { 'content-type': 'application/octet-stream', 'content-length': buf.length })
    res.end(buf)
}


//sendChunked, 不帶content-length(chunked)送出後乾淨結束, 接收端無法由標頭得知是否完整
function sendChunked(res, buf) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.write(buf)
    res.end()
}


//sendJson
function sendJson(res, o) {
    let s = JSON.stringify(o)
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) })
    res.end(s)
}


//send, 送出指定狀態碼與文字
function send(res, status, text = '') {
    res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) })
    res.end(text)
}


//listen, 自basePort起向後找可用埠(固定遞增, 不隨機)
async function listen(server, basePort) {
    for (let i = 0; i < 40; i++) {
        let port = basePort + i
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
            server.listen(port, '127.0.0.1', () => {
                server.off('error', onErr)
                resolve(true)
            })
        })
        if (ok) {
            return port
        }
    }
    throw new Error(`no free port from ${basePort}`)
}


/**
 * 啟動本機伺服器: GET /yt-dlp/manifest.json 與 /yt-dlp/yt-dlp.exe, 各自由onManifest, onExe處理, 並記錄命中次數hits
 * 處理函式簽名(n, req, res): n為該路徑第幾次請求(自1起)
 */
async function startServer(basePort) {
    let srv = {
        port: 0,
        urlBase: '',
        hits: { manifest: 0, exe: 0 },
        onManifest: null,
        onExe: null,
        reset: null,
        close: null,
    }
    let sockets = new Set()
    let server = http.createServer((req, res) => {
        //不設Connection: close: Node 24.22.1之undici在伺服端回應後關閉連線且用戶端因背壓暫停讀取時, 會於Parser.finish拋出未捕捉之AssertionError(assert(!this.paused))使行程結束, 修前與修後之下載皆會中, 非本套件程式所致
        let u = req.url.split('?')[0]
        if (u === '/yt-dlp/manifest.json' && srv.onManifest) {
            srv.hits.manifest++
            srv.onManifest(srv.hits.manifest, req, res)
        }
        else if (u === '/yt-dlp/yt-dlp.exe' && srv.onExe) {
            srv.hits.exe++
            srv.onExe(srv.hits.exe, req, res)
        }
        else {
            send(res, 404, 'not found')
        }
    })
    server.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
    })
    srv.port = await listen(server, basePort)
    srv.urlBase = `http://127.0.0.1:${srv.port}/yt-dlp/`
    srv.reset = () => {
        srv.hits.manifest = 0
        srv.hits.exe = 0
        srv.onManifest = null
        srv.onExe = null
    }
    srv.close = async () => {
        for (let s of sockets) {
            s.destroy()
        }
        await new Promise((resolve) => server.close(resolve))
    }
    return srv
}


//newDir, 建立(先清空)測試臨時資料夾: test/_tmp/<name>/<sub>
function newDir(name, sub) {
    let fd = path.join(fdTmpRoot, name, sub)
    fs.rmSync(fd, { recursive: true, force: true })
    fs.mkdirSync(fd, { recursive: true })
    return fd
}


//rmDir, 刪除測試臨時資料夾: test/_tmp/<name>
function rmDir(name) {
    fs.rmSync(path.join(fdTmpRoot, name), { recursive: true, force: true })
}


//ls, 列出資料夾內檔名(排序)
function ls(fd) {
    return fs.readdirSync(fd).sort()
}


export {
    sha256,
    mkBuf,
    mkSpec,
    mkBad,
    sendBuf,
    sendChunked,
    sendJson,
    send,
    startServer,
    newDir,
    rmDir,
    ls
}
