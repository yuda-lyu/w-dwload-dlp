import fs from 'fs'
import path from 'path'
import assert from 'assert'


//規格: rulebook R6(測試之網路需求與資源取得):
//1. 真跑WDwloadDlp主函數(需真ffmpeg.exe)之測試檔, 一律於before經共用取得點ensureFfmpeg()取得, 並以this.timeout(FFMPEG_BUDGET_MS)對齊下載預算; 不在it內隱式取得, 不直接引w-ffmpeg
//2. 樣本(m3u8等)不於測試時自jsDelivr等CDN下載, 改由本機HTTP服務供應
//3. 對外網之整合測試(YouTube)保留, README與rulebook註明其需外網、網路不穩時會紅
//本檔為靜態接線掃描(逐呼叫點), 各檔之實際行為由真跑驗收(dw_*.test.mjs、清空快取之平行全套)

let fdTest = path.resolve('./test')
let read = (fp) => fs.readFileSync(fp, 'utf8')
let listTests = () => fs.readdirSync(fdTest).filter((v) => v.endsWith('.test.mjs')).sort()
let listTools = () => fs.readdirSync(path.join(fdTest, 'tools')).filter((v) => v.endsWith('.mjs')).sort()

//以片段組字串, 使本檔自身不含被禁之字樣
let CDN_HOSTS = ['cdn.jsd' + 'elivr.net', 'jsd' + 'elivr.net', 'un' + 'pkg.com', 'cdn' + 'js.cloudflare.com', 'esm' + '.sh']


describe(`test network guard (R6)`, function() {

    //真跑主函數且經本機鏡像取yt-dlp.exe之測試檔(需真ffmpeg.exe): 匯入dwMirror、有WDwloadDlp(…)之呼叫(不含WDwloadDlp.xxx(之屬性呼叫), 且未以假檔取代w-ffmpeg(createFakeRun或WFfmpeg.ensureBins =))
    let needFfmpeg = () => listTests().filter((v) => {
        let c = read(path.join(fdTest, v))
        return /^import .* from '\.\/tools\/dwMirror\.mjs'/m.test(c) && /(^|[^.\w])WDwloadDlp\(/m.test(c) && !/createFakeRun|WFfmpeg\.ensureBins\s*=/.test(c)
    })

    it(`should find exactly the two files that run the main function for real (dw_m3u8, dw_mp4), so a new one can not slip in unnoticed`, function() {
        assert.strict.deepStrictEqual(needFfmpeg(), ['dw_m3u8.test.mjs', 'dw_mp4.test.mjs'])
    })

    it(`should get ffmpeg.exe in the before hook of each such file through ensureFfmpeg with this.timeout(FFMPEG_BUDGET_MS), before the mirror is set and before any case`, function() {
        for (let v of needFfmpeg()) {
            let c = read(path.join(fdTest, v))
            assert.strict.equal(c.includes(`from './tools/ffmpegBins.mjs'`), true, `${v} does not import the shared tool`)
            //before之內: this.timeout(FFMPEG_BUDGET_MS)在await ensureFfmpeg()之前, 其後才setupMirror
            let m = /before\(async function\(\) \{([\s\S]*?)\n {4}\}\)/.exec(c)
            assert.ok(m !== null, `${v} has no async before hook`)
            let body = m[1]
            let a = body.indexOf('this.timeout(FFMPEG_BUDGET_MS)')
            let b = body.indexOf('await ensureFfmpeg()')
            let d = body.indexOf('setupMirror(')
            assert.strict.equal(a >= 0 && b > a && d > b, true, `${v}: before must be timeout -> ensureFfmpeg -> setupMirror (${a},${b},${d})`)
            //it之內不再隱式取得(自首個it(起算; 找不到it(即失敗, 不以-1切片而恆通過)
            let iIt = c.search(/\bit\(/)
            assert.strict.equal(iIt > 0, true, `${v} has no it(`)
            assert.strict.equal(c.slice(iIt).includes('ensureFfmpeg'), false, `${v} gets ffmpeg inside an it`)
            //不直接引w-ffmpeg取得
            assert.strict.equal(/from 'w-ffmpeg/.test(c), false, `${v} imports w-ffmpeg directly`)
        }
    })

    it(`should not download samples from a CDN in any test or tool (the m3u8 sample is served by the local server)`, function() {
        let fps = [...listTests().map((v) => path.join(fdTest, v)), ...listTools().map((v) => path.join(fdTest, 'tools', v))]
        assert.strict.equal(fps.length > 10, true)
        for (let fp of fps) {
            let c = read(fp)
            for (let h of CDN_HOSTS) {
                assert.strict.equal(c.includes(h), false, `${path.basename(fp)} refers to ${h}`)
            }
        }
    })

    it(`should serve the m3u8 sample from the local server in the files that use it, and cut the external requests while they run`, function() {
        for (let v of ['dw_m3u8.test.mjs', 'dw_subtitle.test.mjs']) {
            let c = read(path.join(fdTest, v))
            assert.strict.equal(c.includes('startSampleServer()'), true, `${v} does not start the sample server`)
            assert.strict.equal(c.includes('isolateExternal()'), true, `${v} does not isolate external requests`)
            assert.strict.equal(c.includes('srv.urls.m3u8'), true, `${v} does not use the local url`)
        }
    })

    it(`should leave the YouTube integration tests in place (not skipped by default) and document their need of the external network in README and the rulebook`, function() {
        for (let v of ['dw_mp4.test.mjs', 'dw_subtitle.test.mjs']) {
            let c = read(path.join(fdTest, v))
            assert.strict.equal(c.includes('www.youtube.com/watch'), true, `${v} no longer downloads from YouTube`)
            assert.strict.equal(/process\.env\.\w*(SKIP|ONLINE|NETWORK)\w*/i.test(c), false, `${v} is gated by an environment variable`)
            assert.strict.equal(c.includes('須外網'), true, `${v} does not state the need of the external network`)
        }
        let readme = read('README.md')
        assert.strict.equal(readme.includes('## 測試之網路需求'), true)
        let iSec = readme.indexOf('## 測試之網路需求')
        let iEnd = readme.indexOf('\n## ', iSec + 1)
        assert.strict.equal(iEnd > iSec, true)
        let sec = readme.slice(iSec, iEnd) //只看本節(不含他節同詞)
        for (let k of ['YouTube', '外網', 'ffmpeg.exe', 'W_DLP_TEST_TRACE', '127.0.0.1']) {
            assert.strict.equal(sec.includes(k), true, `README section lacks ${k}`)
        }
        let rb = read('sgud/rule/rulebook.md')
        assert.strict.equal(rb.includes('## R6 '), true)
        let r6 = rb.slice(rb.indexOf('## R6 '), rb.indexOf('## 破壞性變更紀錄'))
        for (let k of ['YouTube', '外網', 'ensureFfmpeg', 'FFMPEG_BUDGET_MS']) {
            assert.strict.equal(r6.includes(k), true, `rulebook R6 lacks ${k}`)
        }
    })

})
