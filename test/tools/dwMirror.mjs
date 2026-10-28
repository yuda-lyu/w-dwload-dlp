import fs from 'fs'
import path from 'path'


//功能測試(dw_*.test.mjs)用: 以本機鏡像供yt-dlp.exe(規格O1), 使功能測試不依賴GitHub主幹是否已推送bin/yt-dlp.exe
//鏡像結構為<鏡像>/<套件>/<sha256>/<name>, 檔案取自repo之bin/, 仍由fsEnsureBins依清單校驗後才進快取
//ffmpeg.exe由w-ffmpeg自行取得(功能測試本就需要網路連YouTube)
//用法: let m = setupMirror('dwMp4'); ...; m.restore()
function setupMirror(tag) {
    let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    let f = manifest.files[0]
    let mirror = path.resolve('./test/_tmp', tag)
    let fd = path.join(mirror, manifest.pkg, f.sha256)
    fs.rmSync(mirror, { recursive: true, force: true })
    fs.mkdirSync(fd, { recursive: true })
    fs.copyFileSync(f.path, path.join(fd, f.name))
    let old = process.env.W_BIN_MIRROR
    process.env.W_BIN_MIRROR = mirror
    return {
        mirror,
        restore: () => {
            if (old === undefined) {
                delete process.env.W_BIN_MIRROR
            }
            else {
                process.env.W_BIN_MIRROR = old
            }
            fs.rmSync(mirror, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        },
    }
}


export { setupMirror }
