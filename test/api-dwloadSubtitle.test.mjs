import fs from 'fs'
import os from 'os'
import path from 'path'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { createFakeRun } from './tools/fakeRun.mjs'


const ms1h = 60 * 60 * 1000


//規格(sgud/rule/rulebook.md R4): WDwloadDlp.dwloadSubtitle(url, opt)不下載影片, 由yt-dlp取得影片資訊後下載所挑字幕軌之json3並解析, 結果以物件回傳; reject為字串, 首行為`[代碼] 說明與處置`
//以假yt-dlp(test/tools/fakeDlpSub.mjs)真的起子行程並寫真的檔案, 不連外網; 以環境變數TEMP/TMP把os.tmpdir()導到test/_tmp, 不碰使用者之暫存夾
describe(`dwloadSubtitle`, function() {
    this.timeout(180000)

    //本套件只支援Windows
    if (process.platform !== 'win32') {
        return
    }

    let fr = createFakeRun('apiSubtitle')
    let { fdt, spawnCalls, ffCalls, netCalls, setEnv } = fr
    let fdTmp = path.join(fdt, 'tmp')
    let fdRoot = path.join(fdTmp, 'w-dwload-dlp')
    let reWork = /^\d{14}-[0-9A-Za-z]{6}$/
    let tmpBak = {}
    let dwl = (mode, opt) => WDwloadDlp.dwloadSubtitle(`https://fake.invalid/${mode}`, opt)

    //workLeft, 工作夾根目錄下殘留之項目
    let workLeft = () => (fs.existsSync(fdRoot) ? fs.readdirSync(fdRoot).sort() : [])

    //workOfCall, 第i次啟動yt-dlp時之輸出資料夾(-o之上層), 即該次呼叫之工作夾
    let workOfCall = (i) => {
        let a = spawnCalls[i].args
        return path.dirname(path.resolve(a[a.indexOf('-o') + 1]))
    }

    //rejectOf, 取reject之值, 未reject即失敗
    let rejectOf = async(p) => {
        let r = await p.then(() => ({ ok: true }), (err) => ({ ok: false, err }))
        assert.strict.equal(r.ok, false, 'should reject')
        assert.strict.equal(typeof r.err, 'string', 'reject value should be a string')
        return r.err
    }

    //code, 取reject字串首行之代碼
    let codeOf = (err) => {
        let m = err.split('\n')[0].match(/^\[(\w+)\] /)
        assert.strict.notEqual(m, null, `first line should be [code] ...: ${err}`)
        return m[1]
    }

    //seed, 在工作夾上層夾建立一個指定名稱之殘留夾, 並把修改時間設為ageMs之前
    let seed = (name, ageMs) => {
        let p = path.join(fdRoot, name)
        fs.mkdirSync(path.join(p, 'sub'), { recursive: true })
        fs.writeFileSync(path.join(p, 'sub', 'x.json3'), 'LEFTOVER')
        let t = new Date(Date.now() - ageMs)
        fs.utimesSync(p, t, t) //須在建立內容之後設定, 否則資料夾修改時間又被更新
        return p
    }

    before(fr.install)
    before(function() {
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cache'), W_BIN_MIRROR: fr.mirror, W_BIN_OFFLINE: '1' })
        for (let k of ['TEMP', 'TMP']) {
            tmpBak[k] = process.env[k]
            process.env[k] = fdTmp
        }
        fs.mkdirSync(fdTmp, { recursive: true })
        assert.strict.equal(path.resolve(os.tmpdir()).toLowerCase(), path.resolve(fdTmp).toLowerCase()) //os.tmpdir()確實已導向測試夾
    })
    after(function() {
        for (let k of ['TEMP', 'TMP']) {
            if (tmpBak[k] === undefined) {
                delete process.env[k]
            }
            else {
                process.env[k] = tmpBak[k]
            }
        }
    })
    after(fr.uninstall)
    beforeEach(fr.reset)
    beforeEach(function() {
        fs.rmSync(fdRoot, { recursive: true, force: true })
    })

    it(`should return the picked manual track with metadata and segments`, async function() {
        //規格: resolve回傳之物件欄位; 手動字幕優先; segments略過無文字之event且合併空白
        let url = 'https://fake.invalid/subManual'
        let r = await WDwloadDlp.dwloadSubtitle(url)
        assert.strict.deepEqual(r, {
            url,
            videoId: 'fakeVideoId',
            title: '假影片',
            channel: '假頻道',
            uploadDate: '20261103',
            durationString: '12:21',
            description: '假說明',
            language: 'zh-Hans',
            languageName: 'Chinese (Simplified)',
            kind: 'manual',
            translated: false,
            availableTracks: [{ languageCode: 'zh-Hans', name: 'Chinese (Simplified)', kind: 'manual' }],
            segments: [
                { tMs: 133, t: '00:00', txt: '第一句' },
                { tMs: 3725000, t: '01:02:05', txt: '第二 句' },
            ],
            segmentsCount: 2,
            plainText: '第一句\n第二 句',
            timestampedText: '[00:00] 第一句\n[01:02:05] 第二 句',
        })
    })

    it(`should run yt-dlp twice in one work folder with the exe from ensureBins: information first, then only the picked track`, async function() {
        //規格: 第1次取影片資訊(--flat-playlist、只列舉第1項), 第2次以--load-info-json下載所挑之軌(不重新解析影片); 手動軌用--write-subs; 限json3; 不下載影片; 不用ffmpeg
        let url = 'https://fake.invalid/subManual'
        await WDwloadDlp.dwloadSubtitle(url)
        assert.strict.equal(spawnCalls.length, 2)
        let bins = await WDwloadDlp.ensureBins({ names: fr.name })
        for (let c of spawnCalls) {
            assert.strict.equal(c.prog, bins[fr.name])
            assert.strict.equal(c.args.includes('--skip-download'), true)
            assert.strict.equal(c.args.includes('--no-playlist'), true)
            assert.strict.equal(c.args[c.args.indexOf('--encoding') + 1], 'utf-8')
            assert.strict.equal(c.args.includes('--ffmpeg-location'), false)
            assert.strict.equal(c.args.includes('--merge-output-format'), false)
        }
        let [a1, a2] = [spawnCalls[0].args, spawnCalls[1].args]
        assert.strict.equal(a1.includes('--write-info-json'), true)
        assert.strict.equal(a1.includes('--flat-playlist'), true)
        assert.strict.equal(a1[a1.indexOf('--playlist-items') + 1], '1')
        assert.strict.deepEqual(a1.slice(-2), ['--', url]) //url在--之後(規則R5)
        assert.strict.equal(a1.filter((v) => v === url).length, 1)
        assert.strict.equal(a2.includes('--load-info-json'), true)
        assert.strict.equal(a2.includes('--write-subs'), true)
        assert.strict.equal(a2.includes('--write-auto-subs'), false)
        assert.strict.equal(a2[a2.indexOf('--sub-langs') + 1], 'zh-Hans')
        assert.strict.equal(a2[a2.indexOf('--sub-format') + 1], 'json3')
        assert.strict.equal(a2.includes(url), false) //第2次不重新解析影片
        assert.strict.equal(workOfCall(0), workOfCall(1)) //同一呼叫之兩次共用同一工作夾
        assert.strict.equal(path.resolve(a2[a2.indexOf('--load-info-json') + 1]), path.join(workOfCall(0), 'dl.info.json'))
        assert.strict.equal(path.dirname(workOfCall(0)).toLowerCase(), fdRoot.toLowerCase())
        assert.strict.equal(reWork.test(path.basename(workOfCall(0))), true)
    })

    it(`should treat url as a url even when it begins with a dash`, async function() {
        //規格: --之後一律視為網址, url以-開頭時不得被當成yt-dlp之選項(規則R5)
        let url = '--fake-option/subManual'
        let r = await WDwloadDlp.dwloadSubtitle(url)
        assert.strict.equal(r.url, url)
        let a1 = spawnCalls[0].args
        assert.strict.deepEqual(a1.slice(-2), ['--', url])
        assert.strict.equal(a1.indexOf(url) > a1.indexOf('--'), true)
    })

    it(`should need neither ffmpeg nor direct network access`, async function() {
        //規格: 只下載字幕不須ffmpeg.exe; 字幕由yt-dlp下載, 套件本身不連網(rulebook R1)
        await dwl('subManual')
        assert.strict.equal(ffCalls.length, 0)
        assert.strict.deepEqual(netCalls, [])
    })

    it(`should use --write-auto-subs for an auto track and report a machine translation`, async function() {
        //規格: 自動軌用--write-auto-subs; 語言相符者僅有機器翻譯時才取且標明translated
        let r = await dwl('subAuto')
        assert.strict.equal(r.language, 'zh-Hant')
        assert.strict.equal(r.kind, 'asr')
        assert.strict.equal(r.translated, true)
        assert.strict.equal(r.availableTracks.length, 5)
        let a2 = spawnCalls[1].args
        assert.strict.equal(a2.includes('--write-auto-subs'), true)
        assert.strict.equal(a2.includes('--write-subs'), false)
        assert.strict.equal(a2[a2.indexOf('--sub-langs') + 1], 'zh-Hant')
    })

    it(`should honor opt.langs given as an array or a string, case-insensitively, and ignore surrounding spaces`, async function() {
        //規格: opt.langs為非空字串或非空字串之非空陣列; 語言代碼大小寫不分
        let r1 = await dwl('subAuto', { langs: ['ko'] })
        assert.strict.equal(r1.language, 'ko')
        assert.strict.equal(r1.translated, false)
        let r2 = await dwl('subAuto', { langs: 'en' })
        assert.strict.equal(r2.language, 'en')
        assert.strict.equal(r2.translated, true)
        let r3 = await dwl('subAuto', { langs: ['KO'] })
        assert.strict.equal(r3.language, 'ko')
        let r4 = await dwl('subAuto', { langs: ' ko ' })
        assert.strict.equal(r4.language, 'ko')
        let r5 = await dwl('subAuto', { langs: ['fr', 'KO-ORIG'] })
        assert.strict.equal(r5.language, 'ko-orig')
        assert.strict.equal(r5.translated, false)
    })

    it(`should keep the case of the track code for --sub-langs and the output file, and match it case-insensitively`, async function() {
        //規格: 語言代碼大小寫不分地比對, 但--sub-langs與輸出檔用軌本身之寫法, 回傳之language亦同
        for (let opt of [undefined, { langs: ['zh-hans'] }, { langs: 'ZH' }]) {
            fr.reset()
            let r = await dwl('subUpper', opt)
            assert.strict.equal(r.language, 'ZH-hans')
            let a2 = spawnCalls[1].args
            assert.strict.equal(a2[a2.indexOf('--sub-langs') + 1], 'ZH-hans')
        }
    })

    it(`should leave out unsafe language codes of the video, and handle the track ids of YouTube such as en-uYU-mmqFLq8`, async function() {
        //規格: 語言代碼只收英數字、底線與連字號且以英數字開頭, 其餘不列(作為--sub-langs之值時yt-dlp視為正規式, -開頭者為排除)
        let r = await dwl('subOddCode')
        assert.strict.deepEqual(r.availableTracks, [{ languageCode: 'en-uYU-mmqFLq8', name: 'English - CC1', kind: 'manual' }])
        assert.strict.equal(r.language, 'en-uYU-mmqFLq8')
        let a2 = spawnCalls[1].args
        assert.strict.equal(a2[a2.indexOf('--sub-langs') + 1], 'en-uYU-mmqFLq8')
    })

    it(`should use the default langs without error when opt or opt.langs is unexpected, and not modify opt`, async function() {
        //規格: dspec輸入參數K3: opt給錯值視為未給、改用預設, 不報錯; V4: opt為null或非物件視為未給; V9: 不改寫呼叫端之opt; V11: 讀取拋錯視同未給
        let bad = [
            null,
            123,
            'abc',
            [],
            { langs: null },
            { langs: 123 },
            { langs: '' },
            { langs: '  ' },
            { langs: [] },
            { langs: ['zh', 1] },
            { langs: [''] },
            { langs: [' '] },
            { langs: {} },
            { langs: true },
            {
                get langs() {
                    throw new Error('unreadable')
                },
            },
        ]
        for (let opt of bad) {
            let r = await dwl('subAuto', opt)
            assert.strict.equal(r.language, 'zh-Hant') //預設偏好序之結果
        }
        let opt = { langs: ['ko'] }
        let optStr = JSON.stringify(opt)
        let r = await dwl('subAuto', opt)
        assert.strict.equal(r.language, 'ko')
        assert.strict.equal(JSON.stringify(opt), optStr)
        //V9: 未給langs、給了非預期值、帶debug者, 其opt之鍵與值皆不被改寫(例如不得補上預設langs); 不以debug搭配非預期langs, 因警告狀態為行程層級(見下一案)
        let funLog = () => {}
        for (let o of [{}, { langs: null }, { langs: undefined }, { langs: 123 }, { langs: [] }, { debug: true, funLog }]) {
            let snap = Object.keys(o).map((k) => [k, o[k]])
            await dwl('subAuto', o)
            assert.strict.deepEqual(Object.keys(o).map((k) => [k, o[k]]), snap)
        }
        let optFrozen = Object.freeze({ langs: Object.freeze(['ko']) })
        assert.strict.equal((await dwl('subAuto', optFrozen)).language, 'ko') //凍結之opt亦可
    })

    it(`should warn once without echoing the value only when opt.debug is true`, async function() {
        //規格: dspec輸入參數K3: debug為true才警告, 出口為opt.funLog或console.warn, 每行程一次; K9: 不含傳入之值
        //警告狀態為行程層級, 本案之前未以debug給過非預期值
        let logs = []
        let funLog = (msg, info) => logs.push({ msg, info })
        await dwl('subAuto', { langs: 987654, funLog })
        assert.strict.equal(logs.length, 0) //無debug不警告
        await dwl('subAuto', { langs: 987654, debug: 1, funLog })
        assert.strict.equal(logs.length, 0) //debug非布林視為false
        await dwl('subAuto', { langs: 987654, debug: true, funLog })
        assert.strict.equal(logs.length, 1)
        assert.strict.equal(logs[0].msg.includes('opt.langs'), true)
        assert.strict.equal(logs[0].msg.includes('987654'), false)
        assert.strict.deepEqual(logs[0].info, { fn: 'dwloadSubtitle', reason: 'invalid', key: 'opt.langs' })
        await dwl('subAuto', { langs: 987654, debug: true, funLog })
        assert.strict.equal(logs.length, 1) //同一行程只一次
    })

    it(`should reject [noSubtitle] when there is no usable track, without the second run`, async function() {
        //規格: 無可用字幕軌(無字幕、僅vtt、僅live_chat)reject noSubtitle, 不再執行第2次
        for (let mode of ['subNone', 'subVttOnly', 'subLiveChatOnly']) {
            fr.reset()
            let err = await rejectOf(dwl(mode))
            assert.strict.equal(codeOf(err), 'noSubtitle', `${mode}: ${err}`)
            assert.strict.equal(spawnCalls.length, 1, mode)
            assert.strict.deepEqual(workLeft(), [], mode)
        }
    })

    it(`should reject [invalidUrl] for a playlist or a multi-video page, without the second run`, async function() {
        //規格: 播放清單或頻道頁(_type為playlist)與多影片頁面(multi_video)reject invalidUrl
        for (let mode of ['subPlaylist', 'subMultiVideo']) {
            fr.reset()
            let err = await rejectOf(dwl(mode))
            assert.strict.equal(codeOf(err), 'invalidUrl', `${mode}: ${err}`)
            assert.strict.equal(spawnCalls.length, 1, mode)
        }
    })

    it(`should classify the failures of yt-dlp in both runs`, async function() {
        //規格: yt-dlp執行失敗時由parseDlpError分類, 次行起為ERROR與WARNING原文; 429維持httpError且含原文(不重試, 不新增分類)
        let err1 = await rejectOf(dwl('subInfoFail'))
        assert.strict.equal(codeOf(err1), 'unavailable', err1)
        assert.strict.equal(err1.includes('ERROR: [youtube] fake: This video is unavailable'), true)
        assert.strict.equal(err1.includes('WARNING: [fake] a warning before the error'), true)
        assert.strict.equal(spawnCalls.length, 1)
        fr.reset()
        let err2 = await rejectOf(dwl('subDlFail'))
        assert.strict.equal(codeOf(err2), 'httpError', err2)
        assert.strict.equal(err2.includes('HTTP Error 429: Too Many Requests'), true)
        assert.strict.equal(spawnCalls.length, 2) //不重試
    })

    it(`should reject [outputNotFound] when an expected output file is missing, including when yt-dlp silently falls back to another format`, async function() {
        //規格: yt-dlp離開碼0但無預期輸出檔reject outputNotFound; yt-dlp遇無json3者不報錯而改下載其他格式(實測), 不得當成功
        for (let mode of ['subInfoNofile', 'subDlNofile', 'subDlVtt']) {
            let err = await rejectOf(dwl(mode))
            assert.strict.equal(codeOf(err), 'outputNotFound', `${mode}: ${err}`)
        }
    })

    it(`should reject [invalidOutput] when an output file can not be parsed or has no text`, async function() {
        //規格: 輸出檔內容無法解析、非物件或無文字reject invalidOutput(.json3檔損壞、被截斷、僅有視窗定義)
        for (let mode of ['subInfoBad', 'subInfoNull', 'subDlBad', 'subDlEmpty']) {
            let err = await rejectOf(dwl(mode))
            assert.strict.equal(codeOf(err), 'invalidOutput', `${mode}: ${err}`)
        }
    })

    it(`should reject [invalidOutput] as a string when an output file exists but can not be read, and still remove the work folder`, async function() {
        //規格: 檔案存在卻讀不到(權限、被占用)時reject字串而非拋出Error物件; 工作夾照刪
        for (let suffix of ['dl.info.json', '.json3']) {
            fr.reset()
            let rfBak = fs.readFileSync
            fs.readFileSync = (p, ...rest) => {
                if (String(p).endsWith(suffix)) {
                    let e = new Error(`EACCES: permission denied, open '${p}'`)
                    e.code = 'EACCES'
                    throw e
                }
                return rfBak.call(fs, p, ...rest)
            }
            let err = ''
            try {
                err = await rejectOf(dwl('subManual'))
            }
            finally {
                fs.readFileSync = rfBak
            }
            assert.strict.equal(codeOf(err), 'invalidOutput', `${suffix}: ${err}`)
            assert.strict.deepEqual(workLeft(), [], suffix)
        }
    })

    it(`should remove the work folder of the call on success and on every failure`, async function() {
        //規格: 同WDwloadDlp(rulebook R3), 結束時(成功或失敗)刪除工作夾; 各模式皆確認工作夾曾被使用過(由-o取得)且已不存在
        let modes = ['subManual', 'subNone', 'subVttOnly', 'subLiveChatOnly', 'subPlaylist', 'subMultiVideo', 'subInfoFail', 'subInfoNofile', 'subInfoBad', 'subInfoNull', 'subDlFail', 'subDlNofile', 'subDlVtt', 'subDlBad', 'subDlEmpty']
        for (let mode of modes) {
            fr.reset()
            await dwl(mode).catch(() => {})
            assert.strict.equal(spawnCalls.length >= 1, true, mode)
            assert.strict.equal(fs.existsSync(workOfCall(0)), false, mode)
            assert.strict.deepEqual(workLeft(), [], mode)
        }
    })

    it(`should keep parallel calls apart, each in its own work folder`, async function() {
        //規格: 併行調用互不影響(rulebook R3)
        let [r1, r2] = await Promise.all([dwl('subManual'), dwl('subAuto')])
        assert.strict.equal(r1.language, 'zh-Hans')
        assert.strict.equal(r2.language, 'zh-Hant')
        let works = spawnCalls.map((c) => path.dirname(c.args[c.args.indexOf('-o') + 1]))
        assert.strict.equal(new Set(works).size, 2)
        for (let w of works) {
            assert.strict.equal(path.dirname(w).toLowerCase(), fdRoot.toLowerCase())
        }
        assert.strict.deepEqual(workLeft(), [])
    })

    it(`should delete leftover work folders older than 24 hours like WDwloadDlp does, and leave the younger and the others`, async function() {
        //規格: 殘留清理與WDwloadDlp共用(runInWork, rulebook R3): 逾24小時之工作夾於呼叫開始時刪除, 23小時者與命名不符者不動
        let pOld = seed('20200101000000-AAAAAA', 25 * ms1h)
        let pNew = seed('20200101000001-BBBBBB', 23 * ms1h)
        let pOther = seed('keep-me', 48 * ms1h)
        await dwl('subManual')
        assert.strict.equal(fs.existsSync(pOld), false)
        assert.strict.equal(fs.existsSync(pNew), true)
        assert.strict.equal(fs.existsSync(pOther), true)
    })

    it(`should keep consecutive identical lines in segments and in plainText, which then has one line per segment`, async function() {
        //規格: 不去除連續相同之行(其為字幕本身); plainText逐行對應segments
        let r = await dwl('subDlDup')
        assert.strict.equal(r.segmentsCount, 4)
        assert.strict.equal(r.plainText, '[音樂]\n[音樂]\n你好\n你好')
        assert.strict.equal(r.plainText.split('\n').length, r.segmentsCount)
        assert.strict.equal(r.timestampedText, '[00:00] [音樂]\n[00:01] [音樂]\n[00:02] 你好\n[00:03] 你好')
    })

    it(`should survive a subtitle file with odd events, reusing the previous start time for a missing or invalid one`, async function() {
        //規格: 時間欄位缺漏或非有效數字沿用前一段落(首段為0); 無segs或segs內非預期項目者略過
        let r = await dwl('subDlOdd')
        assert.strict.deepEqual(r.segments, [
            { tMs: 1000, t: '00:01', txt: 'a' },
            { tMs: 1000, t: '00:01', txt: 'b' },
            { tMs: 1000, t: '00:01', txt: 'c' },
            { tMs: 1000, t: '00:01', txt: 'd' },
            { tMs: 2500, t: '00:02', txt: 'e' },
        ])
    })

    it(`should reject [invalidUrl] for a non-string or blank url without echoing it nor running anything`, async function() {
        //規格: dspec輸入參數K2: 一般參數必給且給錯報錯; K9: 不回顯值; V17: 檢測先於副作用; S1: 交給spawn者只收原始字串
        //eslint-disable-next-line no-new-wrappers
        for (let url of [undefined, null, '', ' ', '\t\n', 0, 123, true, {}, [], () => {}, new String('https://fake.invalid/subManual')]) {
            let err = await rejectOf(WDwloadDlp.dwloadSubtitle(url))
            assert.strict.equal(err, '[invalidUrl] url is not an effective string')
        }
        assert.strict.equal(spawnCalls.length, 0)
        assert.strict.deepEqual(workLeft(), [])
    })

    it(`should reject a url that can not be passed to a process as a string with a code, and remove the work folder`, async function() {
        //規格: 無法交給子程序之網址(含空字元)仍以字串reject, 不拋出Error物件
        let err = await rejectOf(WDwloadDlp.dwloadSubtitle('https://fake.invalid/a\u0000b'))
        assert.strict.equal(codeOf(err), 'execFailed', err)
        assert.strict.deepEqual(workLeft(), [])
    })

    it(`should reject [exeNotReady] with the code of ensureBins and create no work folder`, async function() {
        //規格: 取不到yt-dlp.exe時reject, 首行exeNotReady, 次行為錯誤碼; 同WDwloadDlp
        setEnv({ W_BIN_CACHE: path.join(fdt, 'cacheEmpty'), W_BIN_OFFLINE: '1' })
        try {
            let err = await rejectOf(dwl('subManual'))
            let ls = err.split('\n')
            assert.strict.equal(ls[0].startsWith('[exeNotReady] '), true, err)
            assert.strict.equal(ls[1].startsWith('E_OFFLINE_MISSING'), true, err)
            assert.strict.equal(spawnCalls.length, 0)
            assert.strict.deepEqual(workLeft(), [])
        }
        finally {
            setEnv({ W_BIN_CACHE: path.join(fdt, 'cache'), W_BIN_MIRROR: fr.mirror, W_BIN_OFFLINE: '1' })
        }
    })

    it(`should reject [osNotSupported] on other operating systems before anything else`, async function() {
        //規格: 只能用於Windows; 同WDwloadDlp
        let bak = Object.getOwnPropertyDescriptor(process, 'platform')
        Object.defineProperty(process, 'platform', { ...bak, value: 'linux' })
        try {
            let err = await rejectOf(dwl('subManual'))
            assert.strict.equal(err, '[osNotSupported] operating system is not windows')
        }
        finally {
            Object.defineProperty(process, 'platform', bak)
        }
        assert.strict.equal(spawnCalls.length, 0)
    })

})
