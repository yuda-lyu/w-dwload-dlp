import fs from 'fs'
import path from 'path'
import cp from 'child_process'
import WFfmpeg from 'w-ffmpeg'


//createFakeRun, 主函數類測試(api-ensureBins、api-workFolder)共用之假執行環境: WDwloadDlp主函數無法注入fetch與spawn, 故攔截全域fetch(被呼叫即記錄並拋錯)與child_process.spawn(記錄後改以node執行假yt-dlp), 另以假檔取代w-ffmpeg之ensureBins
//斷言: 未連網(否則回歸為直連時測試仍會因真網路而綠)、啟動者為ensureBins回傳之路徑(舊路徑檔與快取檔位元相同時, 只驗功能輸出之測試對[先取得卻仍用舊路徑]盲)
//用法: let fr = createFakeRun('案名'); before(fr.install); after(fr.uninstall); beforeEach(fr.reset)
//陣列netCalls、spawnCalls、ffCalls全程為同一個物件(reset時就地清空), 可解構後長期持有; ffMode可設為'fail'令假WFfmpeg.ensureBins拋錯、'offline'令其拋E_OFFLINE_MISSING(帶ffMissing), reset時還原為'ok'
function createFakeRun(tag) {
    let fdt = path.resolve('./test/_tmp', tag)
    let manifest = JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    let keys = ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE']
    let bak = {}
    let fetchBak = null
    let spawnBak = null
    let ffBak = null

    let fr = {
        fdt,
        manifest,
        sha256: manifest.files[0].sha256,
        name: 'yt-dlp.exe',
        pkgName: 'w-dwload-dlp',
        mirror: path.join(fdt, 'mirror'),
        fpFakeFfmpeg: path.join(fdt, 'fake-ffmpeg', 'ffmpeg.exe'),
        fpFakeDlp: path.resolve('test/tools/fakeDlp.mjs'),
        netCalls: [],
        spawnCalls: [],
        ffCalls: [],
        ffMode: 'ok',
        ffMissing: { name: 'ffmpeg.exe', sha256: 'f1e2d3c4b5a6978877665544332211009f8e7d6c5b4a39281706f5e4d3c2b1a0', size: 123456789, cachePath: 'Z:\\fake-w-ffmpeg-cache\\f1e2d3c4\\ffmpeg.exe', mirrorPath: null, url: 'https://fake.invalid/w-ffmpeg/ffmpeg.exe', member: null, archive: null, parts: null, reasons: [], bundle: null },
    }

    //setEnv, 設定W_BIN_*環境變數(未給或值為undefined者刪除)
    fr.setEnv = (vars) => {
        for (let k of keys) {
            if (vars[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = vars[k]
            }
        }
    }

    fr.install = () => {
        fetchBak = globalThis.fetch
        globalThis.fetch = (url) => {
            fr.netCalls.push(String(url))
            throw new Error(`network access is forbidden in tests: ${url}`)
        }
        spawnBak = cp.spawn
        cp.spawn = (prog, args, opts) => {
            fr.spawnCalls.push({ prog, args: [...args], cwd: process.cwd() })
            return spawnBak(process.execPath, [fr.fpFakeDlp, ...args], opts)
        }
        ffBak = WFfmpeg.ensureBins
        WFfmpeg.ensureBins = async(opt) => {
            fr.ffCalls.push(opt)
            if (fr.ffMode === 'fail') {
                let err = new Error('fake failure of w-ffmpeg')
                err.code = 'E_FAKE_FFMPEG'
                throw err
            }
            if (fr.ffMode === 'offline') {
                //離線缺檔: 帶code與結構欄位missing[](值為逐筆相異之sha256、大小、路徑); 訊息刻意帶值與標記, 用以確認包裝不轉抄訊息而只取missing[].name
                let err = new Error(`fake offline message FAKE-MSG-MARK ${fr.ffMissing.sha256} ${fr.ffMissing.cachePath}`)
                err.code = 'E_OFFLINE_MISSING'
                err.missing = [fr.ffMissing]
                throw err
            }
            return { 'ffmpeg.exe': fr.fpFakeFfmpeg }
        }
        for (let k of keys) {
            bak[k] = process.env[k]
        }
        fs.rmSync(fdt, { recursive: true, force: true })
        let fd = path.join(fr.mirror, fr.pkgName, fr.sha256)
        fs.mkdirSync(fd, { recursive: true })
        fs.copyFileSync('bin/yt-dlp.exe', path.join(fd, fr.name))
        fs.mkdirSync(path.dirname(fr.fpFakeFfmpeg), { recursive: true })
        fs.writeFileSync(fr.fpFakeFfmpeg, 'FAKE-FFMPEG')
    }

    fr.uninstall = () => {
        globalThis.fetch = fetchBak
        cp.spawn = spawnBak
        WFfmpeg.ensureBins = ffBak
        fr.setEnv(bak)
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }

    fr.reset = () => {
        fr.netCalls.length = 0
        fr.spawnCalls.length = 0
        fr.ffCalls.length = 0
        fr.ffMode = 'ok'
    }

    return fr
}


export { createFakeRun }
