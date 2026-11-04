import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import pickSubTrack from '../src/pickSubTrack.mjs'
import parseSubJson3 from '../src/parseSubJson3.mjs'


//規格(sgud/rule/rulebook.md R4): 字幕軌限json3; 手動字幕(任何語言)優先於自動字幕; 依langs之順序挑選(大小寫不分, 先完全相同再語言前綴); 自動字幕先取非機器翻譯者; json3轉{ tMs, t, txt }
//fmts, 字幕軌之格式清單, 結構取自yt-dlp 2026.10.26實測: 第1筆可能為無name之vtt, 其餘帶name
let fmts = (name) => [{ ext: 'vtt' }, { ext: 'json3', name }, { ext: 'srv1', name }]


describe(`subtitle: pickSubTrack`, function() {

    let langsDef = ['zh-TW', 'zh-Hant', 'zh', 'en']

    let manual = { 'zh-Hans': fmts('Chinese (Simplified)'), 'en': fmts('English') }
    let autoKo = { 'ab': fmts('Abkhazian'), 'ko-orig': fmts('Korean (Original)'), 'ko': fmts('Korean'), 'zh-Hant': fmts('Chinese (Traditional)'), 'en': fmts('English') }

    it(`should prefer manual tracks of any language over auto tracks`, function() {
        //規格: 任何語言之手動字幕皆優先於自動字幕
        let r = pickSubTrack({ subtitles: { 'en': fmts('English') }, automatic_captions: { 'zh-Hant': fmts('Chinese (Traditional)') } }, langsDef)
        assert.strict.equal(r.track.languageCode, 'en')
        assert.strict.equal(r.track.kind, 'manual')
        assert.strict.equal(r.translated, false)
    })

    it(`should follow the order of langs within the manual tracks, and take the first track when nothing matches`, function() {
        //規格: 依langs之順序挑選; 皆不符時取清單第1筆(無原文軌可言之手動字幕)
        assert.strict.equal(pickSubTrack({ subtitles: manual }, ['en', 'zh']).track.languageCode, 'en')
        assert.strict.equal(pickSubTrack({ subtitles: manual }, ['zh', 'en']).track.languageCode, 'zh-Hans')
        assert.strict.equal(pickSubTrack({ subtitles: manual }, ['fr']).track.languageCode, 'zh-Hans')
    })

    it(`should match the exact code first, then by language prefix in both directions, case-insensitively, and keep the case of the track code`, function() {
        //規格: 同一語言先比完全相同, 再比語言前綴(zh可中zh-Hans, zh-TW可中zh), 大小寫不分; 回傳之語言代碼為軌本身之寫法
        //各案皆另放排在前面之en, 使比對失敗時會落到清單第1筆而轉紅, 不致碰巧答對
        let dict = { 'en': fmts('e'), 'zh-Hans': fmts('a'), 'zh': fmts('b') }
        assert.strict.equal(pickSubTrack({ subtitles: dict }, ['zh']).track.languageCode, 'zh')
        assert.strict.equal(pickSubTrack({ subtitles: { 'en': fmts('e'), 'zh-Hans': fmts('a') } }, ['zh']).track.languageCode, 'zh-Hans')
        assert.strict.equal(pickSubTrack({ subtitles: { 'en': fmts('e'), 'zh': fmts('b') } }, ['zh-TW']).track.languageCode, 'zh')
        assert.strict.equal(pickSubTrack({ subtitles: { 'en': fmts('e'), 'zh-TW': fmts('b') } }, ['ZH-tw']).track.languageCode, 'zh-TW')
        assert.strict.equal(pickSubTrack({ subtitles: { 'en': fmts('e'), 'ZH-hans': fmts('b') } }, ['zh-hans']).track.languageCode, 'ZH-hans')
        assert.strict.equal(pickSubTrack({ subtitles: { 'en': fmts('e'), 'ZH-hans': fmts('b') } }, ['zh']).track.languageCode, 'ZH-hans')
    })

    it(`should not let a longer code stand for a shorter one, nor match without a hyphen boundary`, function() {
        //規格: 語言前綴須以連字號為界(zh不可中zho、en不可中end)
        let dict = { 'ja': fmts('j'), 'zho': fmts('a'), 'end': fmts('b') }
        assert.strict.equal(pickSubTrack({ subtitles: dict }, ['zh']).track.languageCode, 'ja') //無相符, 取第1筆
        assert.strict.equal(pickSubTrack({ subtitles: dict }, ['en']).track.languageCode, 'ja')
    })

    it(`should prefer the original language over a machine translation among auto tracks when langs lists both`, function() {
        //規格: 自動字幕中語言相符者先取非機器翻譯者; 預設偏好序雖先列zh-Hant, 但en為原文時不取機器翻譯之zh-Hant
        let dict = { 'en-orig': fmts('English (Original)'), 'en': fmts('English'), 'zh-Hant': fmts('Chinese (Traditional)') }
        let r = pickSubTrack({ automatic_captions: dict }, langsDef)
        assert.strict.equal(r.track.languageCode, 'en')
        assert.strict.equal(r.track.kind, 'asr')
        assert.strict.equal(r.translated, false)
    })

    it(`should take a machine translation only when no original matches langs, and report translated=true`, function() {
        //規格: 語言相符者僅有機器翻譯時才取, 且須標明translated
        let r = pickSubTrack({ automatic_captions: autoKo }, langsDef)
        assert.strict.equal(r.track.languageCode, 'zh-Hant')
        assert.strict.equal(r.track.kind, 'asr')
        assert.strict.equal(r.translated, true)
    })

    it(`should report translated=false for the original track itself, and for the plain code of the original language`, function() {
        //規格: 原文軌(ko-orig)與原文語言(ko)不是機器翻譯
        let r1 = pickSubTrack({ automatic_captions: autoKo }, ['ko'])
        assert.strict.equal(r1.track.languageCode, 'ko')
        assert.strict.equal(r1.translated, false)
        let r2 = pickSubTrack({ automatic_captions: autoKo }, ['ko-orig'])
        assert.strict.equal(r2.track.languageCode, 'ko-orig')
        assert.strict.equal(r2.translated, false)
    })

    it(`should take the original auto track when nothing matches langs, not the first track of the list`, function() {
        //規格: 皆不符時取原文軌; 清單第1筆常為機器翻譯之無關語言(實測為ab)
        let r = pickSubTrack({ automatic_captions: autoKo }, ['fr'])
        assert.strict.equal(r.track.languageCode, 'ko-orig')
        assert.strict.equal(r.translated, false)
    })

    it(`should take the first auto track and report translated=false when no original track exists`, function() {
        //規格: 無原文軌時取清單第1筆; 無從判定是否機器翻譯者為false
        let r = pickSubTrack({ automatic_captions: { 'fr': fmts('French'), 'de': fmts('German') } }, ['ja'])
        assert.strict.equal(r.track.languageCode, 'fr')
        assert.strict.equal(r.translated, false)
    })

    it(`should only consider tracks having the json3 format, and take the name from the json3 format`, function() {
        //規格: 無json3者無法解析故不列(含live_chat與僅有vtt者); name取自json3該筆, 不取首筆
        let r = pickSubTrack({ subtitles: { 'live_chat': [{ ext: 'json' }], 'de': [{ ext: 'vtt', name: 'German' }], 'en': fmts('English') } }, ['de'])
        assert.strict.equal(r.track.languageCode, 'en')
        assert.strict.equal(r.track.name, 'English')
        assert.strict.deepEqual(r.tracks, [{ languageCode: 'en', name: 'English', kind: 'manual' }])
        let r2 = pickSubTrack({ automatic_captions: { 'zh-Hans': fmts('Chinese (Simplified)') } }, ['zh'])
        assert.strict.equal(r2.track.name, 'Chinese (Simplified)') //自動軌首筆為無name之vtt, 名稱仍取自json3
    })

    it(`should fall back to auto tracks when the manual tracks have no json3`, function() {
        //規格: 手動字幕皆無json3時等同無手動字幕
        let r = pickSubTrack({ subtitles: { 'de': [{ ext: 'vtt' }] }, automatic_captions: { 'en': fmts('English') } }, ['de'])
        assert.strict.equal(r.track.languageCode, 'en')
        assert.strict.equal(r.track.kind, 'asr')
    })

    it(`should return null when there is no usable track, whatever the shape of info is`, function() {
        //規格: 無可用字幕軌時回傳null, 不拋錯
        let infos = [
            {}, { subtitles: {} }, { subtitles: null, automatic_captions: null }, { subtitles: { 'en': [{ ext: 'vtt' }] } },
            null, undefined, 'x', 123, [],
            { subtitles: [] }, { subtitles: 'en' }, { subtitles: { 'en': 'json3' } }, { subtitles: { 'en': null } }, { subtitles: { 'en': [null, 1, {}] } },
        ]
        for (let info of infos) {
            assert.strict.equal(pickSubTrack(info, langsDef), null, JSON.stringify(info))
        }
    })

    it(`should leave out language codes that are not safe as --sub-langs values and file names`, function() {
        //規格: 語言代碼作為--sub-langs之值(yt-dlp視為正規式, 以-開頭者為排除)與檔名之一部分, 只收英數字、底線與連字號且以英數字開頭
        let dict = { '-all': fmts('a'), 'zh.*': fmts('b'), 'a b': fmts('c'), '': fmts('d'), '.x': fmts('e'), 'en-uYU-mmqFLq8': fmts('English - CC1'), 'zh-Hans': fmts('f') }
        let r = pickSubTrack({ subtitles: dict }, ['zh'])
        assert.strict.deepEqual(r.tracks.map((t) => t.languageCode), ['en-uYU-mmqFLq8', 'zh-Hans'])
        assert.strict.equal(r.track.languageCode, 'zh-Hans')
        assert.strict.equal(pickSubTrack({ subtitles: { '-all': fmts('a'), 'zh.*': fmts('b') } }, ['zh']), null)
    })

    it(`should not throw for an unexpected langs, and then take the first track`, function() {
        //規格: langs非陣列視為無偏好
        for (let langs of [undefined, null, 'en', 123, {}]) {
            assert.strict.equal(pickSubTrack({ subtitles: manual }, langs).track.languageCode, 'zh-Hans')
        }
        assert.strict.equal(pickSubTrack({ subtitles: manual }, [null, 5, '', 'en']).track.languageCode, 'en') //略過非字串與空字串
    })

})


describe(`subtitle: parseSubJson3`, function() {

    it(`should convert events into segments with ms, timestamp and text`, function() {
        //規格: 每項為{ tMs, t, txt }, t未滿1小時為mm:ss, 否則為hh:mm:ss
        let s = JSON.stringify({ events: [{ tStartMs: 133, segs: [{ utf8: '第一句' }] }, { tStartMs: 3725000, segs: [{ utf8: '第二句' }] }] })
        assert.strict.deepEqual(parseSubJson3(s), [
            { tMs: 133, t: '00:00', txt: '第一句' },
            { tMs: 3725000, t: '01:02:05', txt: '第二句' },
        ])
    })

    it(`should format the timestamp at the boundaries of minutes and hours`, function() {
        //規格: t未滿1小時為mm:ss, 否則為hh:mm:ss; 以毫秒無條件捨去至秒
        let t = (ms) => parseSubJson3(JSON.stringify({ events: [{ tStartMs: ms, segs: [{ utf8: 'x' }] }] }))[0].t
        assert.strict.equal(t(0), '00:00')
        assert.strict.equal(t(999), '00:00')
        assert.strict.equal(t(59999), '00:59')
        assert.strict.equal(t(60000), '01:00')
        assert.strict.equal(t(3599999), '59:59')
        assert.strict.equal(t(3600000), '01:00:00')
        assert.strict.equal(t(360000000), '100:00:00')
    })

    it(`should join the segs of an event and merge consecutive whitespace`, function() {
        //規格: txt為連續空白(含換行、定位字元)已合併為單一空格之文字, 故txt不含換行
        let s = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'hello' }, { utf8: '  big\n' }, { utf8: 'world\t\r\n ' }] }] })
        assert.strict.equal(parseSubJson3(s)[0].txt, 'hello big world')
    })

    it(`should skip events without segs and events having only whitespace`, function() {
        //規格: 無segs之event為視窗定義; 自動字幕之換行event其segs僅含空白, 兩者皆略過
        let s = JSON.stringify({ events: [{ tStartMs: 0, id: 1 }, { tStartMs: 1, segs: [] }, { tStartMs: 2, aAppend: 1, segs: [{ utf8: '\n' }] }, { tStartMs: 3, segs: [{ utf8: 'x' }] }] })
        assert.strict.deepEqual(parseSubJson3(s).map((v) => v.tMs), [3])
    })

    it(`should keep consecutive identical lines as they are, since they are the subtitle itself`, function() {
        //規格: 不去除連續相同之文字(例如重複之[音樂]), 段落數與逐列數一致
        let s = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: '[音樂]' }] }, { tStartMs: 1000, segs: [{ utf8: '[音樂]' }] }] })
        assert.strict.deepEqual(parseSubJson3(s), [{ tMs: 0, t: '00:00', txt: '[音樂]' }, { tMs: 1000, t: '00:01', txt: '[音樂]' }])
    })

    it(`should return an empty array for invalid, truncated or empty content`, function() {
        //規格: 內容非有效json、被截斷或無任何文字時回傳空陣列, 不拋錯
        let list = [
            'NOT-JSON', '', '{}', '{"events":[]}', '{"events":"x"}', '{"events":{}}', 'null', '[]', '123', '"x"',
            '{"events":[{"tStartMs":0,"segs":[{"utf8":"a', //被截斷
            '{"events":[{"tStartMs":0},{"tStartMs":1,"segs":[{"utf8":"\\n"}]}]}', //無任何文字
        ]
        for (let s of list) {
            assert.strict.deepEqual(parseSubJson3(s), [], s)
        }
        for (let s of [undefined, null, 123, {}, []]) {
            assert.strict.deepEqual(parseSubJson3(s), [], String(s))
        }
    })

    it(`should reuse the previous start time when tStartMs is missing or not a valid number, and accept numeric strings`, function() {
        //規格: tStartMs缺漏、負數、非數字時沿用前一段落之tMs(首段為0), 使tMs不遞減; 由數字組成之字串視為數字(舊版timedtext以字串給值)
        let s = JSON.stringify({
            events: [
                { segs: [{ utf8: 'a' }] }, //首段缺漏 -> 0
                { tStartMs: 1500, segs: [{ utf8: 'b' }] },
                { segs: [{ utf8: 'c' }] }, //缺漏
                { tStartMs: 'abc', segs: [{ utf8: 'd' }] }, //非數字
                { tStartMs: -5, segs: [{ utf8: 'e' }] }, //負數
                { tStartMs: null, segs: [{ utf8: 'f' }] },
                { tStartMs: '2500', segs: [{ utf8: 'g' }] }, //數字字串
                { tStartMs: 3000.9, segs: [{ utf8: 'h' }] }, //小數無條件捨去
            ],
        })
        assert.strict.deepEqual(parseSubJson3(s).map((v) => [v.txt, v.tMs]), [['a', 0], ['b', 1500], ['c', 1500], ['d', 1500], ['e', 1500], ['f', 1500], ['g', 2500], ['h', 3000]])
    })

    it(`should ignore unexpected items in events and segs without throwing`, function() {
        //規格: event、seg之非預期型別略過, 不拋錯; utf8非字串者視為空
        let s = JSON.stringify({
            events: [
                null,
                'x',
                5,
                { tStartMs: 1000, segs: [{ utf8: 'a' }] },
                { tStartMs: 2500, segs: [null, { utf8: 5 }, { utf8: 'e' }, {}, 'zz'] },
                { tStartMs: 3000, segs: 'zzz' },
                { tStartMs: 4000, segs: {} },
            ],
        })
        assert.strict.deepEqual(parseSubJson3(s).map((v) => [v.txt, v.tMs]), [['a', 1000], ['e', 2500]])
    })

    it(`should keep the order of the events as given, and not sort them`, function() {
        //規格: 不重排; 順序即YouTube所給
        let s = JSON.stringify({ events: [{ tStartMs: 5000, segs: [{ utf8: 'late' }] }, { tStartMs: 1000, segs: [{ utf8: 'early' }] }] })
        assert.strict.deepEqual(parseSubJson3(s).map((v) => v.txt), ['late', 'early'])
    })

})


describe(`subtitle: export`, function() {

    it(`should attach dwloadSubtitle as a static property of the main function`, function() {
        //規格: 主檔只有default匯出, 新功能掛靜態屬性(rulebook R1、R4)
        assert.strict.equal(typeof WDwloadDlp.dwloadSubtitle, 'function')
        assert.strict.equal(typeof WDwloadDlp.ensureBins, 'function')
    })

})
