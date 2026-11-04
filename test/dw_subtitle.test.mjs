import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { setupMirror } from './tools/dwMirror.mjs'


//功能測試: 實際連YouTube/jsdelivr, yt-dlp.exe以本機鏡像供檔(同dw_*.test.mjs)
//規格: 同test/api-dwloadSubtitle.test.mjs(sgud/rule/rulebook.md R4); 本檔只驗真實網站上之行為, 錯誤分類與工作夾等細節由假yt-dlp之api測試驗證
//
//外部資料之處理(字幕由上傳者與YouTube提供, 可能變動):
//1. 預期值不寫死特定軌, 改由oracle(直接以yt-dlp.exe取同一影片之資訊, 不經本套件之挑軌)取得該影片當下有json3之手動/自動字幕軌, 再斷言函數之結果符合規格; 影片已不具備測試前提(例如手動字幕被移除)時, 以[fixture changed upstream]為訊息使該案失敗, 以別於函數之缺陷
//2. YouTube對字幕下載限流(HTTP 429, 機器翻譯軌尤甚)時標為pending, 此屬外部服務之狀態; 只有首行為[httpError]且含HTTP Error 429者才算, 其餘任何錯誤(含其他http錯誤、網路錯誤、分類錯誤)皆照常失敗
describe(`dwloadSubtitle (real network)`, function() {
    this.timeout(180000)

    //本套件只支援Windows
    if (process.platform !== 'win32') {
        return
    }

    let fdt = path.resolve('./test/_tmp/dwSubtitleTmp')
    let fdRoot = path.join(fdt, 'w-dwload-dlp')
    let reWork = /^\d{14}-[0-9A-Za-z]{6}$/
    let m = null
    let envBak = {}
    let fpExe = ''
    let factsCache = new Map()

    before(async function() {
        fs.rmSync(fdt, { recursive: true, force: true })
        fs.mkdirSync(fdt, { recursive: true })
        m = setupMirror('dwSubtitle')
        for (let k of ['TEMP', 'TMP']) {
            envBak[k] = process.env[k]
            process.env[k] = fdt //工作夾導到測試夾, 以斷言本次呼叫之工作夾已刪
        }
        assert.strict.equal(path.resolve(os.tmpdir()).toLowerCase(), path.resolve(fdt).toLowerCase())
        let bins = await WDwloadDlp.ensureBins({ names: 'yt-dlp.exe' })
        fpExe = bins['yt-dlp.exe']
    })
    after(function() {
        for (let k of ['TEMP', 'TMP']) {
            if (envBak[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = envBak[k]
            }
        }
        m.restore()
        fs.rmSync(fdt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })

    //is429, 是否為YouTube限流: 首行為[httpError]且含HTTP Error 429
    let is429 = (err) => {
        return typeof err === 'string' && err.split('\n')[0].startsWith('[httpError] ') && err.includes('HTTP Error 429')
    }

    //real, 呼叫dwloadSubtitle; 限流(is429)時標為pending, 其餘錯誤照常拋出
    let real = async(ctx, url, opt) => {
        try {
            return await WDwloadDlp.dwloadSubtitle(url, opt)
        }
        catch (err) {
            if (is429(err)) {
                ctx.skip()
            }
            throw err
        }
    }

    //facts, oracle: 直接以yt-dlp.exe取影片資訊(不經本套件之挑軌), 回傳有json3格式之手動軌與自動軌之語言代碼; 同一網址只取一次
    let facts = async(ctx, url) => {
        if (!factsCache.has(url)) {
            let r = spawnSync(fpExe, ['--dump-single-json', '--skip-download', '--flat-playlist', '--no-playlist', '--encoding', 'utf-8', '--', url], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 28 })
            if (r.status !== 0 && String(r.stderr).includes('HTTP Error 429')) {
                ctx.skip() //oracle本身遇限流, 同樣標pending
            }
            assert.strict.equal(r.status, 0, `oracle failed (not a defect of dwloadSubtitle): ${String(r.stderr).slice(-300)}`)
            let info = JSON.parse(r.stdout)
            let codes = (dict) => Object.keys(dict || {}).filter((k) => (dict[k] || []).some((f) => f.ext === 'json3'))
            factsCache.set(url, { id: info.id, manual: codes(info.subtitles), auto: codes(info.automatic_captions) })
        }
        return factsCache.get(url)
    }

    //need, 測試前提; 不成立表示外部影片已變動, 以別於函數缺陷之訊息失敗
    let need = (cond, msg) => {
        assert.strict.equal(!!cond, true, `[fixture changed upstream] ${msg}`)
    }

    let workLeft = () => {
        return (fs.existsSync(fdRoot) ? fs.readdirSync(fdRoot) : []).filter((v) => reWork.test(v))
    }

    let assertSegments = (r) => {
        //規格: segments每項為{ tMs, t, txt }且依時間遞增, 文字非空且不含換行; plainText逐行對應
        assert.strict.equal(r.segmentsCount, r.segments.length)
        assert.strict.equal(r.segmentsCount > 0, true)
        let pre = -1
        for (let s of r.segments) {
            assert.strict.equal(s.tMs >= pre, true)
            assert.strict.equal(s.txt.length > 0, true)
            assert.strict.equal(s.txt.includes('\n'), false)
            assert.strict.match(s.t, /^(\d{2,}:)?\d{2}:\d{2}$/)
            pre = s.tMs
        }
        assert.strict.equal(r.plainText.split('\n').length, r.segmentsCount)
        assert.strict.equal(r.timestampedText.split('\n').length, r.segmentsCount)
        assert.strict.equal(workLeft().length, 0) //本次呼叫之工作夾已刪
    }

    it(`should treat only [httpError] with HTTP Error 429 as rate limiting, and nothing else as pending`, function() {
        //規格: 限流標pending之判準; 其他錯誤不得被吞成pending
        assert.strict.equal(is429('[httpError] source responded with an http error\nERROR: Unable to download video subtitles for \'zh-Hant\': HTTP Error 429: Too Many Requests'), true)
        assert.strict.equal(is429('[http403] source refused access (403)\nERROR: HTTP Error 429'), false)
        assert.strict.equal(is429('[httpError] source responded with an http error\nERROR: HTTP Error 500: Internal Server Error'), false)
        assert.strict.equal(is429('[dlpFailed] yt-dlp failed\nERROR: HTTP Error 429'), false)
        assert.strict.equal(is429('[execFailed] 429'), false)
        assert.strict.equal(is429(new Error('[httpError] HTTP Error 429')), false)
        assert.strict.equal(is429(undefined), false)
    })

    it(`should download the manual track of a video that has manual tracks`, async function() {
        //規格: 有手動字幕時取手動字幕(不取自動字幕), 語言為影片實有之手動軌, availableTracks為該影片之手動軌; 不產生影片檔
        let url = 'https://www.youtube.com/watch?v=TXcnAHNA0RU'
        let f = await facts(this, url)
        need(f.manual.length > 0, `${url} has no manual subtitle track in json3`)
        let r = await real(this, url)
        assert.strict.equal(r.videoId, f.id)
        assert.strict.equal(r.kind, 'manual')
        assert.strict.equal(f.manual.includes(r.language), true, r.language)
        assert.strict.deepEqual(r.availableTracks.map((v) => v.languageCode).sort(), [...f.manual].sort())
        assert.strict.equal(r.translated, false)
        assert.strict.equal(r.title.length > 0, true)
        assert.strict.equal(r.segments[0].txt.includes('最佳拍档'), true) //該影片之開場白(內容確為所挑之字幕)
        assertSegments(r)
    })

    it(`should reach the same single video from a short url and from a url carrying a playlist parameter`, async function() {
        //規格: 單一影片之網址不因帶list參數或為短網址而被當成播放清單(--no-playlist、--playlist-items 1不影響單一影片)
        let f = await facts(this, 'https://www.youtube.com/watch?v=TXcnAHNA0RU')
        need(f.manual.length > 0, `TXcnAHNA0RU has no manual subtitle track in json3`)
        for (let url of ['https://youtu.be/TXcnAHNA0RU', 'https://www.youtube.com/watch?v=TXcnAHNA0RU&list=RDTXcnAHNA0RU']) {
            let r = await real(this, url)
            assert.strict.equal(r.videoId, f.id, url)
            assert.strict.equal(r.kind, 'manual', url)
            assertSegments(r)
        }
    })

    it(`should download the original auto track when opt.langs asks for the original language`, async function() {
        //規格: 無手動字幕時從自動字幕挑; 原文語言(ko)相符者不是機器翻譯
        let url = 'https://www.youtube.com/watch?v=9bZkp7q19f0'
        let f = await facts(this, url)
        need(f.manual.length === 0, `${url} now has manual subtitle tracks`)
        need(f.auto.includes('ko-orig') && f.auto.includes('ko'), `${url} has no ko-orig and ko auto tracks`)
        let r = await real(this, url, { langs: ['ko'] })
        assert.strict.equal(r.kind, 'asr')
        assert.strict.equal(r.language, 'ko')
        assert.strict.equal(r.translated, false)
        assertSegments(r)
    })

    it(`should report a machine translation when only a translation matches the default langs`, async function() {
        //規格: 語言相符者僅有機器翻譯時才取且標明translated; 預設langs依序為zh-TW、zh-Hant、zh、en, 取其中影片實有者之第1個
        let url = 'https://www.youtube.com/watch?v=9bZkp7q19f0'
        let f = await facts(this, url)
        need(f.manual.length === 0 && f.auto.includes('ko-orig'), `${url} is no longer an auto-only video with the original track ko-orig`)
        let expected = ['zh-TW', 'zh-Hant', 'zh', 'en'].find((c) => f.auto.includes(c))
        need(expected !== undefined, `${url} has none of the default langs`)
        let r = await real(this, url)
        assert.strict.equal(r.kind, 'asr')
        assert.strict.equal(r.language, expected)
        assert.strict.equal(r.translated, true)
        assertSegments(r)
    })

    it(`should reject [noSubtitle] for a stream without subtitles`, async function() {
        //規格: 無可用字幕軌reject noSubtitle
        let err = await WDwloadDlp.dwloadSubtitle('https://cdn.jsdelivr.net/npm/w-demores/res/video/aigen_hls/playlist.m3u8')
            .then(() => 'resolved', (e) => e)
        assert.strict.equal(err.split('\n')[0].startsWith('[noSubtitle] '), true, err)
        assert.strict.equal(workLeft().length, 0)
    })

    it(`should reject [invalidUrl] for a channel page without resolving the videos in it`, async function() {
        //規格: 頻道頁(播放清單)reject invalidUrl; --flat-playlist與--playlist-items 1使其不逐一解析影片(逐一解析需時數十秒以上, 此處以上限60秒判定)
        let t0 = Date.now()
        let err = await WDwloadDlp.dwloadSubtitle('https://www.youtube.com/@YouTube/videos')
            .then(() => 'resolved', (e) => e)
        assert.strict.equal(err.split('\n')[0].startsWith('[invalidUrl] '), true, err)
        assert.strict.equal(Date.now() - t0 < 60000, true, `took ${Date.now() - t0}ms`)
        assert.strict.equal(workLeft().length, 0)
    })

    it(`should reject [unavailable] for a video that does not exist`, async function() {
        //規格: yt-dlp執行失敗時由parseDlpError分類
        let err = await WDwloadDlp.dwloadSubtitle('https://www.youtube.com/watch?v=aaaaaaaaaaa')
            .then(() => 'resolved', (e) => e)
        assert.strict.equal(err.split('\n')[0].startsWith('[unavailable] '), true, err)
        assert.strict.equal(workLeft().length, 0)
    })

})
