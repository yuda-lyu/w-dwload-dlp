import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import parseDlpManifest from '../src/parseDlpManifest.mjs'


//換yt-dlp.exe後執行本檔重產yt-dlp/manifest.json: node toolg/genManifest.mjs
//雜湊與大小取自yt-dlp/yt-dlp.exe，版本取自yt-dlp/yt-dlp-ver.txt首列(`yt-dlp <tag>`)
//須自套件根目錄執行(使用當前工作路徑下之yt-dlp/)
async function gen() {

    //fd
    let fd = path.resolve('yt-dlp')
    let fpExe = path.join(fd, 'yt-dlp.exe')
    let fpVer = path.join(fd, 'yt-dlp-ver.txt')
    let fpMan = path.join(fd, 'manifest.json')

    //version
    let m = /^yt-dlp\s+(\S+)\s*$/.exec(fs.readFileSync(fpVer, 'utf8').split(/\r?\n/)[0])
    if (!m) {
        throw new Error(`first line of ${fpVer} must be "yt-dlp <tag>"`)
    }

    //sha256, size
    let sha256 = crypto.createHash('sha256').update(fs.readFileSync(fpExe)).digest('hex')
    let size = fs.statSync(fpExe).size

    //manifest, 寫出前先以parseDlpManifest檢核
    let manifest = {
        schema: 1,
        file: 'yt-dlp.exe',
        version: m[1],
        sha256,
        size,
    }
    parseDlpManifest(JSON.stringify(manifest))

    //write
    fs.writeFileSync(fpMan, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    console.log(`wrote ${fpMan}`)
    console.log(JSON.stringify(manifest, null, 2))

}
gen()
    .catch((err) => {
        console.log(err)
        process.exitCode = 1
    })
