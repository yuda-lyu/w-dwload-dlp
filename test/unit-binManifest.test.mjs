import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import { execSync, execFileSync, spawnSync } from 'child_process'
import fsGetBinManifestEntry from 'wsemi/src/fsGetBinManifestEntry.mjs'
import fsEnsureBins from 'wsemi/src/fsEnsureBins.mjs'
import * as nsMain from '../src/WDwloadDlp.mjs'


function isWindows() {
    return process.platform === 'win32'
}


//規格: 外部執行檔之存放下載校驗與離線(制式規格) S1、S2、S5、M1、M2、M4、M5、D1、E2、§8 T1、T2
describe(`bin/manifest.json`, function() {
    this.timeout(180000)

    let fdt = './test/_tmp/binManifest'
    let fdDecoy = './bin-cache/__decoy__'
    let fnDecoys = ['./bin/__decoy__.exe', './bin/__decoy__.dll', './bin/__decoy__.zip.001']

    //manifestOf, 清單在it內讀(缺清單時單案失敗而非整檔載入失敗)
    let manifestOf = () => {
        return JSON.parse(fs.readFileSync('bin/manifest.json', 'utf8'))
    }

    after(function() {
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        fs.rmSync(fdDecoy, { recursive: true, force: true })
        for (let fp of fnDecoys) {
            fs.rmSync(fp, { force: true })
        }

        //誘餌檔可能使bin-cache/被建立: 空夾才移除(開發機已有快取時不動)
        try {
            fs.rmdirSync('./bin-cache')
        }
        catch (err) {} // eslint-disable-line no-empty
    })

    it(`should declare the floating manifest of this package with yt-dlp.exe from bin/ and no commit (M1, M5, S2)`, function() {
        let manifest = manifestOf()
        assert.strict.equal(manifest.schema, 1)
        assert.strict.equal(manifest.pkg, 'w-dwload-dlp')
        assert.strict.equal(manifest.mode, 'floating') //主幹模式, 已於帳本G10登記
        assert.strict.equal(manifest.repo, 'yuda-lyu/w-dwload-dlp')
        assert.strict.equal(manifest.commit, undefined) //主幹模式之自有檔取自master, 不帶commit
        assert.strict.equal(/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(manifest.version), true, manifest.version)
        assert.strict.deepStrictEqual(manifest.files.map((v) => v.name), ['yt-dlp.exe'])

        //M1、M2: 自有檔取自repo之bin/, sha256與大小必填
        let f = manifest.files[0]
        assert.strict.equal(f.path, 'bin/yt-dlp.exe')
        assert.strict.equal(f.url, undefined)
        assert.strict.equal(/^[0-9a-f]{64}$/.test(f.sha256), true)
        assert.strict.equal(Number.isInteger(f.size) && f.size > 0, true)
        assert.strict.equal(f.size <= 100 * 1024 * 1024, true) //S4: 單檔不逾100MB
    })

    it(`should pass the schema check of fsEnsureBins (M1, M2)`, async function() {
        //離線且快取為空資料夾: 清單有效時為E_OFFLINE_MISSING(缺檔), 清單無效時為E_MANIFEST; 不連網
        let err = null
        try {
            await fsEnsureBins('bin/manifest.json', { pkgRoot: '.', cacheDir: `${fdt}/cache`, mirror: '', offline: true })
        }
        catch (e) {
            err = e
        }
        assert.strict.equal(err && err.code, 'E_OFFLINE_MISSING', err && err.message)
    })

    it(`should match the real files in bin/ (M4, T2)`, async function() {
        let manifest = manifestOf()
        for (let f of manifest.files) {
            let e = await fsGetBinManifestEntry(f.path)
            assert.strict.deepStrictEqual([e.sha256, e.size], [f.sha256, f.size], f.path)
        }
    })

    it(`should have bin/ hold only the files of the manifest, plus the manifest itself (M4)`, function() {
        let manifest = manifestOf()
        let names = fs.readdirSync('bin').filter((v) => v !== 'manifest.json').sort()
        assert.strict.deepStrictEqual(names, manifest.files.map((v) => path.posix.basename(v.path)).sort())
    })

    it(`should record in the manifest the version that bin/yt-dlp.exe reports (M4)`, function() {
        if (!isWindows()) {
            this.skip()
        }
        let ver = execFileSync(path.resolve('bin/yt-dlp.exe'), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim()
        assert.strict.equal(manifestOf().version, ver)
    })

    it(`should be exactly what toolg/genBinManifest.mjs generates from bin/, not hand written (M1)`, function() {
        if (!isWindows()) {
            this.skip()
        }

        //於暫存夾組一個假套件根(package.json、bin/yt-dlp.exe之副本、工具本身), 產生後與repo之清單逐位元組比對
        let fdPkg = path.resolve(fdt, 'gen')
        fs.rmSync(fdPkg, { recursive: true, force: true })
        fs.mkdirSync(path.join(fdPkg, 'bin'), { recursive: true })
        fs.mkdirSync(path.join(fdPkg, 'toolg'), { recursive: true })
        fs.copyFileSync('package.json', path.join(fdPkg, 'package.json'))
        fs.copyFileSync('bin/yt-dlp.exe', path.join(fdPkg, 'bin/yt-dlp.exe'))
        fs.copyFileSync('toolg/genBinManifest.mjs', path.join(fdPkg, 'toolg/genBinManifest.mjs'))
        let r = spawnSync(process.execPath, ['toolg/genBinManifest.mjs'], { cwd: fdPkg, encoding: 'utf8', windowsHide: true, timeout: 120000 })
        assert.strict.equal(r.status, 0, `${r.stdout}${r.stderr}`)
        assert.strict.equal(fs.readFileSync(path.join(fdPkg, 'bin/manifest.json'), 'utf8'), fs.readFileSync('bin/manifest.json', 'utf8'))

        //bin/無yt-dlp.exe時拒絕產生, 不寫出清單
        fs.rmSync(path.join(fdPkg, 'bin/yt-dlp.exe'))
        fs.rmSync(path.join(fdPkg, 'bin/manifest.json'))
        let r2 = spawnSync(process.execPath, ['toolg/genBinManifest.mjs'], { cwd: fdPkg, encoding: 'utf8', windowsHide: true, timeout: 120000 })
        assert.strict.notEqual(r2.status, 0)
        assert.strict.equal(fs.existsSync(path.join(fdPkg, 'bin/manifest.json')), false)
    })

    it(`should document the external executable in the README (O5)`, function() {
        let c = fs.readFileSync('README.md', 'utf8')
        assert.strict.equal(c.includes('## 外部執行檔'), true)
        let sec = c.slice(c.indexOf('## 外部執行檔'))
        for (let k of ['W_BIN_CACHE', 'W_BIN_MIRROR', 'W_BIN_OFFLINE', 'yt-dlp.exe', 'ffmpeg.exe', 'ensureBins', 'bin/manifest.json', 'Breaking changes']) {
            assert.strict.equal(c.includes(k), true, `README lacks ${k}`)
        }
        assert.strict.equal(sec.includes('W_BIN_MIRROR'), true)
    })

    it(`should keep the cache folder out of git and treat bin/ as binary so that the work tree bytes equal the GitHub blobs (S5, M1 F12)`, function() {
        //S5: .gitignore列bin-cache/(快取不入版控); M1補充: .gitattributes設bin/** binary(autocrlf不得改動檔案)
        execFileSync('git', ['check-ignore', '-q', '--', 'bin-cache/x/yt-dlp.exe'], { windowsHide: true }) //被忽略時離開碼0, 否則拋錯
        execFileSync('git', ['check-ignore', '-q', '--', 'test/_tmp/x/yt-dlp.exe'], { windowsHide: true })
        let attr = execFileSync('git', ['check-attr', 'binary', '--', 'bin/yt-dlp.exe'], { encoding: 'utf8', windowsHide: true })
        assert.strict.equal(attr.trim().endsWith('binary: set'), true, attr)
    })

    it(`should not pack external executables into the npm package, only bin/manifest.json (S1, S5, T1)`, function() {
        //先放誘餌檔(缺忽略規則時確定性變紅): bin/、快取夾與測試暫存夾內各放探針檔, 測試平行執行時他檔之暫存檔亦不得影響本案
        for (let fp of fnDecoys) {
            fs.writeFileSync(fp, 'x')
        }
        fs.mkdirSync(fdDecoy, { recursive: true })
        fs.writeFileSync(`${fdDecoy}/yt-dlp.exe`, 'x')
        fs.mkdirSync(fdt, { recursive: true })
        fs.writeFileSync(`${fdt}/probe.exe`, 'x')
        let r = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
        let info = Array.isArray(r) ? r[0] : Object.values(r)[0] //npm 11以前為陣列, npm 12起為以套件名為鍵之物件
        let fps = info.files.map((v) => v.path)
        assert.strict.deepStrictEqual(fps.filter((v) => /\.(exe|dll|msi|zip|7z|\d{3})$/i.test(v)), [])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('bin/') || v.startsWith('bin-cache/')), ['bin/manifest.json'])
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('yt-dlp/') || /(^|\/)yt-dlp\.exe$/.test(v)), []) //舊路徑檔不入包
        assert.strict.deepStrictEqual(fps.filter((v) => v.startsWith('test/_tmp/') || v.startsWith('sgud/') || v.startsWith('scripts/')), [])
        assert.strict.equal(fps.includes('src/ensureBins.mjs'), true)
    })

})


//規格 D1、E2: 套件端不得自寫下載, 且不得於postinstall下載
describe(`no self-written download in src/ (D1, E2)`, function() {

    let fdSrc = './src'
    let fps = fs.readdirSync(fdSrc).filter((v) => v.endsWith('.mjs')).map((v) => path.join(fdSrc, v))

    it(`should not import fsDownloadFile nor fetch binaries by itself`, function() {
        assert.strict.equal(fps.length > 0, true)
        for (let fp of fps) {
            let c = fs.readFileSync(fp, 'utf8')
            assert.strict.equal(/fsDownloadFile(?!Verify)/.test(c), false, `${fp} imports fsDownloadFile`)
            assert.strict.equal(/raw\/refs\/heads|raw\.githubusercontent\.com|\bfetch\s*\(|createWriteStream|createHash/.test(c), false, `${fp} downloads or verifies by itself`)
        }
    })

    it(`should have removed the self-written download, the trunk-manifest reader, the postinstall script and the old yt-dlp/ folder`, function() {
        for (let fp of ['src/downloadFiles.mjs', 'src/ensureDlpExe.mjs', 'src/autoDownloadFiles.mjs', 'src/parseDlpManifest.mjs', 'scripts/install.mjs', 'toolg/genManifest.mjs', 'yt-dlp/yt-dlp.exe', 'yt-dlp/manifest.json', 'yt-dlp/yt-dlp-ver.txt']) {
            assert.strict.equal(fs.existsSync(fp), false, `${fp} still exists`)
        }
    })

    it(`should not download in postinstall (D1)`, function() {
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, 'postinstall'), false)
        assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, 'install'), false)
        assert.strict.equal(Object.prototype.hasOwnProperty.call(pkg.scripts, 'preinstall'), false)
    })

    it(`should depend on wsemi 1.9.27 or later and w-ffmpeg 1.0.29 or later, the first versions with fsEnsureBins (E4)`, function() {
        let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
        let ver = (s) => String(s).replace(/^[^0-9]*/, '').split('.').map((v) => parseInt(v, 10))
        let atLeast = (a, b) => {
            for (let i = 0; i < 3; i++) {
                if (a[i] !== b[i]) {
                    return a[i] > b[i]
                }
            }
            return true
        }
        assert.strict.equal(atLeast(ver(pkg.dependencies.wsemi), [1, 9, 27]), true, pkg.dependencies.wsemi)
        assert.strict.equal(atLeast(ver(pkg.dependencies['w-ffmpeg']), [1, 0, 29]), true, pkg.dependencies['w-ffmpeg'])
        let fpEnsure = fileURLToPath(import.meta.resolve('wsemi/src/fsEnsureBins.mjs'))
        let installed = JSON.parse(fs.readFileSync(path.join(path.dirname(fpEnsure), '..', 'package.json'), 'utf8')).version
        assert.strict.equal(atLeast(ver(installed), [1, 9, 27]), true, installed)
    })

    it(`should list the node modules needed by fsEnsureBins and w-ffmpeg as external and globals of the UMD build (rollup)`, function() {
        let c = fs.readFileSync('toolg/gDistRollup.mjs', 'utf8')
        let ext = c.slice(c.indexOf('external:'))
        let glb = c.slice(c.indexOf('globals:'), c.indexOf('external:'))
        for (let m of ['url', 'crypto', 'stream', 'stream/promises', 'child_process', 'fs', 'path', 'os', 'w-ffmpeg']) {
            assert.strict.equal(ext.includes(`'${m}'`), true, `external lacks ${m}`)
            assert.strict.equal(glb.includes(`'${m}':`), true, `globals lacks ${m}`)
        }
    })

    it(`should export only the default from the main file and attach ensureBins as its static property (E2)`, function() {
        //具名匯出會使rollup UMD改輸出exports.default, 破壞require('w-dwload-dlp')之既有用法
        assert.strict.deepStrictEqual(Object.keys(nsMain), ['default'])
        assert.strict.equal(typeof nsMain.default.ensureBins, 'function')
    })

})
