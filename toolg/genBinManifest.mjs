//產生bin/manifest.json(規格M1: 依repo內實檔計算sha256與大小, 不手寫)
//用法: node toolg/genBinManifest.mjs
//本套件為主幹模式(mode為floating, 已於主控帳本G10登記): 自有檔取自GitHub master, 清單不帶commit; yt-dlp須隨YouTube變動即時更新
//流程(規格U2): 替換bin/yt-dlp.exe → 本工具重產清單(version取自bin/yt-dlp.exe --version, 不手填) → 跑測試(M4) → 一併推GitHub即生效; npm包內之基準清單於下次發布時更新
//須自套件根目錄執行, 且只能於Windows執行(需執行yt-dlp.exe取得版本)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'


//---- 本套件之設定 ----

//mode, 主幹模式(須於主控帳本G10登記)
let mode = 'floating'

//fnExe, 清單記載版本之執行檔名稱
let fnExe = 'yt-dlp.exe'

//---- 以下不需修改 ----

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))

//版本, 由執行檔自報, 避免清單之版本標示與實檔不符
let version = execFileSync(path.resolve('bin', fnExe), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim()
if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version)) {
    console.log(`bin/${fnExe} --version is not a yt-dlp version tag: ${JSON.stringify(version)}`)
    process.exit(1)
}

//自有檔: bin/內除清單外之全部檔案(主幹模式下檔案尚未提交, 故以實檔列舉而非git ls-files)
let names = fs.readdirSync('bin', { withFileTypes: true })
    .filter((v) => v.isFile() && v.name !== 'manifest.json')
    .map((v) => v.name)
    .sort()
if (!names.includes(fnExe)) {
    console.log(`bin/${fnExe} is missing`)
    process.exit(1)
}
let files = []
for (let name of names) {
    files.push(await fsGetBinManifestEntry(`bin/${name}`, { name, path: `bin/${name}` }))
}

let manifest = { schema: 1, pkg: pkg.name, mode, repo: `yuda-lyu/${pkg.name}`, version, files }
fs.writeFileSync('bin/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`bin/manifest.json: ${files.length} file(s), yt-dlp ${version}`)
