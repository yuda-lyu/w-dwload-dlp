//假yt-dlp之字幕行為: 供test/api-dwloadSubtitle.test.mjs取代真正之yt-dlp.exe, 由fakeDlp.mjs轉呼叫
//第1次(--write-info-json): 依url(--之後)路徑末段之模式寫`<-o>.info.json`, 字幕軌結構取自yt-dlp 2026.10.26之實測輸出(各軌第1筆可能為無name之vtt、手動字幕可含live_chat、自動字幕含-orig原文軌與機器翻譯軌)
//第2次(--load-info-json): 依資訊檔內之_fakeMode與--sub-langs寫`<-o>.<語言>.json3`; 同真正之yt-dlp, 只有資訊檔之字幕字典(--write-subs為subtitles、--write-auto-subs為automatic_captions)內有該語言之json3格式時才寫檔, 否則離開碼0而不寫檔(實測: 無json3者改下載vtt, 其餘不寫)
//模式: 見modes與下方判斷; 假資料之影片資訊皆為虛構之測試用值, 不對應真實影片
import fs from 'fs'
import path from 'path'


function argOf(args, k) {
    let i = args.indexOf(k)
    return i >= 0 ? args[i + 1] : ''
}


function tr(name) {
    return [{ ext: 'vtt' }, { ext: 'json3', name }, { ext: 'srv1', name }]
}


let okTracks = { 'zh-Hans': tr('Chinese (Simplified)') }

let modes = {
    subManual: {
        subtitles: { 'zh-Hans': tr('Chinese (Simplified)'), 'live_chat': [{ ext: 'json' }] },
        automatic_captions: { 'en-orig': tr('English (Original)'), 'en': tr('English'), 'zh-Hant': tr('Chinese (Traditional)') },
    },
    subAuto: {
        subtitles: {},
        automatic_captions: { 'ab': tr('Abkhazian'), 'ko-orig': tr('Korean (Original)'), 'ko': tr('Korean'), 'zh-Hant': tr('Chinese (Traditional)'), 'en': tr('English') },
    },
    subNone: { subtitles: {} },
    subVttOnly: { subtitles: { 'zh-Hant': [{ ext: 'vtt', name: 'Chinese (Traditional)' }] }, automatic_captions: { 'zh-Hant': [{ ext: 'vtt' }] } },
    subLiveChatOnly: { subtitles: { 'live_chat': [{ ext: 'json' }] } },
    subPlaylist: { _type: 'playlist' },
    subMultiVideo: { _type: 'multi_video' },
    subUpper: { subtitles: { 'ZH-hans': tr('Chinese (Simplified)') } },
    subOddCode: { subtitles: { '-all': tr('Dash'), 'zh.*': tr('Regex'), 'en-uYU-mmqFLq8': tr('English - CC1') } },
    subInfoNull: {},
    subDlFail: { subtitles: okTracks },
    subDlNofile: { subtitles: okTracks },
    subDlVtt: { subtitles: okTracks },
    subDlBad: { subtitles: okTracks },
    subDlEmpty: { subtitles: okTracks },
    subDlDup: { subtitles: okTracks },
    subDlOdd: { subtitles: okTracks },
}


let json3Ok = {
    wireMagic: 'pb3',
    events: [
        { tStartMs: 0, dDurationMs: 1000, id: 1, wpWinPosId: 1 }, //無segs之視窗定義, 應略過
        { tStartMs: 133, dDurationMs: 2333, segs: [{ utf8: '第一句' }] },
        { tStartMs: 2500, aAppend: 1, segs: [{ utf8: '\n' }] }, //僅換行, 應略過
        { tStartMs: 3725000, dDurationMs: 1000, segs: [{ utf8: '第二' }, { utf8: '  句 ' }] }, //連續空白應合併, 逾1小時
    ],
}

let json3Dup = {
    events: [
        { tStartMs: 0, segs: [{ utf8: '[音樂]' }] },
        { tStartMs: 1000, segs: [{ utf8: '[音樂]' }] },
        { tStartMs: 2000, segs: [{ utf8: '你好' }] },
        { tStartMs: 3000, segs: [{ utf8: '你好' }] },
    ],
}

let json3Odd = {
    events: [
        null,
        'x',
        { tStartMs: 1000, segs: [{ utf8: 'a' }] },
        { segs: [{ utf8: 'b' }] }, //缺tStartMs
        { tStartMs: 'abc', segs: [{ utf8: 'c' }] }, //非數字
        { tStartMs: -5, segs: [{ utf8: 'd' }] }, //負數
        { tStartMs: '2500', segs: [null, { utf8: 5 }, { utf8: 'e' }, {}] }, //字串數字; segs含非預期之項目
        { tStartMs: 3000, segs: 'zzz' }, //segs非陣列
    ],
}


function runFakeSub(args) {
    let fpBase = argOf(args, '-o')
    fs.mkdirSync(path.dirname(fpBase), { recursive: true })

    //第1次
    if (args.includes('--write-info-json')) {
        let iSep = args.indexOf('--')
        if (iSep < 0 || iSep !== args.length - 2) {
            console.error('ERROR: [fake] url must be the only argument after "--"')
            process.exit(2)
        }
        let url = args[iSep + 1]
        let mode = url.split('/').pop()
        fs.writeFileSync(`${fpBase}.temp`, 'FAKE-TEMP') //刻意留下以驗證呼叫結束時整個工作夾被刪
        if (mode === 'subInfoFail') {
            console.error('WARNING: [fake] a warning before the error')
            console.error('ERROR: [youtube] fake: This video is unavailable')
            process.exit(1)
        }
        if (mode === 'subInfoNofile') {
            return
        }
        if (mode === 'subInfoBad') {
            fs.writeFileSync(`${fpBase}.info.json`, 'NOT-JSON')
            return
        }
        if (mode === 'subInfoNull') {
            fs.writeFileSync(`${fpBase}.info.json`, 'null')
            return
        }
        let info = {
            id: 'fakeVideoId',
            title: '假影片',
            channel: '假頻道',
            upload_date: '20261103',
            duration_string: '12:21',
            description: '假說明',
            _fakeMode: mode,
            ...modes[mode],
        }
        fs.writeFileSync(`${fpBase}.info.json`, JSON.stringify(info))
        return
    }

    //第2次
    let info = JSON.parse(fs.readFileSync(argOf(args, '--load-info-json'), 'utf8'))
    let mode = info._fakeMode
    let lang = argOf(args, '--sub-langs')
    let dict = args.includes('--write-subs') ? info.subtitles : (args.includes('--write-auto-subs') ? info.automatic_captions : {})
    let fmts = (dict && dict[lang]) || []
    if (mode === 'subDlFail') {
        console.error('ERROR: Unable to download video subtitles for \'zh-Hans\': HTTP Error 429: Too Many Requests')
        process.exit(1)
    }
    if (mode === 'subDlNofile' || !fmts.some((f) => f.ext === 'json3')) {
        return
    }
    let fpSub = `${fpBase}.${lang}.json3`
    if (mode === 'subDlVtt') {
        fs.writeFileSync(`${fpBase}.${lang}.vtt`, 'WEBVTT') //yt-dlp遇無json3者不報錯而改下載其他格式
        return
    }
    if (mode === 'subDlBad') {
        fs.writeFileSync(fpSub, 'NOT-JSON')
        return
    }
    if (mode === 'subDlEmpty') {
        fs.writeFileSync(fpSub, JSON.stringify({ events: [{ tStartMs: 0 }, { tStartMs: 1, segs: [{ utf8: '\n' }] }] }))
        return
    }
    if (mode === 'subDlDup') {
        fs.writeFileSync(fpSub, JSON.stringify(json3Dup))
        return
    }
    if (mode === 'subDlOdd') {
        fs.writeFileSync(fpSub, JSON.stringify(json3Odd))
        return
    }
    fs.writeFileSync(fpSub, JSON.stringify({ ...json3Ok, _lang: lang, _kindFlag: args.includes('--write-subs') ? 'manual' : 'asr' }))
}


export default runFakeSub
