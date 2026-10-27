import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import parseDlpManifest from '../src/parseDlpManifest.mjs'


//套件根目錄(本檔位於test/)
let __dirname = path.dirname(fileURLToPath(import.meta.url))
let root = path.resolve(__dirname, '..')

let HINT = '換yt-dlp.exe後須重產清單: 於套件根目錄執行 node toolg/genManifest.mjs'


function sha256File(fp) {
    return new Promise((resolve, reject) => {
        let hash = crypto.createHash('sha256')
        fs.createReadStream(fp)
            .on('data', (c) => hash.update(c))
            .on('end', () => resolve(hash.digest('hex')))
            .on('error', reject)
    })
}


describe('parseDlpManifest', function() {

    let ok = { schema: 1, file: 'yt-dlp.exe', version: '2026.10.26', sha256: 'a'.repeat(64), size: 123 }

    it('合法清單: 回傳schema,file,version,sha256,size; 多餘欄位忽略', function() {
        let r = parseDlpManifest(JSON.stringify({ ...ok, note: 'x' }))
        assert.deepStrictEqual(r, ok)
    })

    it('可指定預期檔名', function() {
        assert.strictEqual(parseDlpManifest(JSON.stringify({ ...ok, file: 'a.exe' }), 'a.exe').file, 'a.exe')
        assert.throws(() => parseDlpManifest(JSON.stringify(ok), 'a.exe'), { code: 'E_MANIFEST_FORMAT' })
    })

    let bads = {
        '非JSON': ['{', /not a JSON/],
        '根為陣列': ['[]', /not an object/],
        'schema錯': [{ ...ok, schema: 2 }, /schema/],
        'file錯': [{ ...ok, file: 'x.exe' }, /file/],
        'version非字串': [{ ...ok, version: 20261026 }, /version/],
        'sha256大寫': [{ ...ok, sha256: 'A'.repeat(64) }, /sha256/],
        'sha256短': [{ ...ok, sha256: 'a'.repeat(63) }, /sha256/],
        'size非整數': [{ ...ok, size: 1.5 }, /size/],
        'size為0': [{ ...ok, size: 0 }, /size/],
    }
    for (let [title, [input, re]] of Object.entries(bads)) {
        it(`格式錯(${title}): 拋E_MANIFEST_FORMAT, 訊息指出欄位`, function() {
            let text = typeof input === 'string' ? input : JSON.stringify(input)
            assert.throws(() => parseDlpManifest(text), (err) => {
                return err.code === 'E_MANIFEST_FORMAT' && re.test(err.message)
            })
        })
    }

})


//防清單過期: 日後換yt-dlp.exe忘了更新yt-dlp/manifest.json時, 以下案例即紅
describe('yt-dlp/manifest.json 與 yt-dlp.exe、yt-dlp-ver.txt 一致', function() {

    this.timeout(60000)

    let fpMan = path.join(root, 'yt-dlp', 'manifest.json')
    let fpExe = path.join(root, 'yt-dlp', 'yt-dlp.exe')
    let fpVer = path.join(root, 'yt-dlp', 'yt-dlp-ver.txt')

    it('清單存在且格式合法', function() {
        assert.ok(fs.existsSync(fpMan), `yt-dlp/manifest.json 不存在。${HINT}`)
        parseDlpManifest(fs.readFileSync(fpMan, 'utf8'))
    })

    it('size與yt-dlp.exe之實際大小相同', function() {
        let m = parseDlpManifest(fs.readFileSync(fpMan, 'utf8'))
        let size = fs.statSync(fpExe).size
        assert.strictEqual(m.size, size, `清單size[${m.size}]與yt-dlp.exe實際大小[${size}]不同。${HINT}`)
    })

    it('sha256與yt-dlp.exe之實際SHA-256相同', async function() {
        let m = parseDlpManifest(fs.readFileSync(fpMan, 'utf8'))
        let h = await sha256File(fpExe)
        assert.strictEqual(m.sha256, h, `清單sha256[${m.sha256}]與yt-dlp.exe實際SHA-256[${h}]不同。${HINT}`)
    })

    it('version與yt-dlp-ver.txt首列之tag相同', function() {
        let m = parseDlpManifest(fs.readFileSync(fpMan, 'utf8'))
        let first = fs.readFileSync(fpVer, 'utf8').split(/\r?\n/)[0]
        let r = /^yt-dlp\s+(\S+)\s*$/.exec(first)
        assert.ok(r, `yt-dlp-ver.txt首列[${first}]須為"yt-dlp <tag>"`)
        assert.strictEqual(m.version, r[1], `清單version[${m.version}]與yt-dlp-ver.txt首列tag[${r[1]}]不同。${HINT}`)
    })

})


//清單與exe一樣只供自GitHub下載, 不入npm包
describe('npm pack 內容', function() {

    this.timeout(120000)

    it('不含yt-dlp/manifest.json、yt-dlp.exe與暫存檔(含測試正在寫的test/_tmp), 含新增之src模組', function() {

        //哨兵: 先放一個應被排除的暫存檔與測試暫存檔, 排除規則被刪除時此案例才會紅(不靠別的測試碰巧留下檔案)
        let fpSentinel = path.join(root, 'yt-dlp', 'pack-sentinel.exe.1.deadbeef.part')
        let fdTestTmp = path.join(__dirname, '_tmp', 'dlpManifestPack')
        let fpSentinel2 = path.join(fdTestTmp, 'sentinel.part')
        let out = ''
        try {
            fs.writeFileSync(fpSentinel, 'x')
            fs.mkdirSync(fdTestTmp, { recursive: true })
            fs.writeFileSync(fpSentinel2, 'x')
            out = execSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        }
        finally {
            fs.rmSync(fpSentinel, { force: true })
            fs.rmSync(fdTestTmp, { recursive: true, force: true })
        }
        let j = JSON.parse(out) //新版npm回傳以套件名為鍵之物件, 舊版回傳陣列
        let info = Array.isArray(j) ? j[0] : Object.values(j)[0]
        let files = info.files.map((v) => v.path.replace(/\\/g, '/'))
        assert.ok(!files.includes('yt-dlp/manifest.json'), 'manifest.json不應入npm包')
        assert.ok(!files.includes('yt-dlp/yt-dlp.exe'), 'yt-dlp.exe不應入npm包')
        assert.ok(!files.some((v) => v.endsWith('.part')), '暫存檔不應入npm包')
        assert.ok(!files.some((v) => v.startsWith('test/_tmp/')), '測試暫存資料夾不應入npm包')
        for (let fn of ['src/downloadFiles.mjs', 'src/parseDlpManifest.mjs', 'src/ensureDlpExe.mjs', 'src/autoDownloadFiles.mjs', 'scripts/install.mjs']) {
            assert.ok(files.includes(fn), `${fn}應入npm包`)
        }
    })

})
