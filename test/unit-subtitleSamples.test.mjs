import fs from 'fs'
import assert from 'assert'
import pickSubTrack from '../src/pickSubTrack.mjs'


//規格(sgud/rule/rulebook.md R4): 挑軌規則(手動優先、依langs、自動軌先取非機器翻譯者、無json3不列)
//本檔以真實yt-dlp輸出之字幕軌結構(test/tools/ytSubSamples.json, 2026-11-04 對公開影片實測取得, 只留各軌格式之ext與name)驗證, 不連網;
//用途: 真實網站在限流(HTTP 429, 機器翻譯軌尤甚)時無法功能測試機器翻譯軌之下載, 其挑選仍以真實結構驗證;
//編碼: 每軌[name, 'ext1,ext2,…'], ext前綴~代表該筆格式無name欄
let fixture = JSON.parse(fs.readFileSync(new URL('./tools/ytSubSamples.json', import.meta.url), 'utf8'))

let unpack = (o) => {
    let d = {}
    for (let k of Object.keys(o)) {
        let [name, exts] = o[k]
        d[k] = exts === '' ? [] : exts.split(',').map((e) => (e.startsWith('~') ? { ext: e.slice(1) } : { ext: e, name }))
    }
    return d
}

let load = (key) => {
    let s = fixture.samples[key]
    return { subtitles: unpack(s.subtitles), automatic_captions: unpack(s.automatic_captions) }
}

let langsDef = ['zh-TW', 'zh-Hant', 'zh', 'en']


describe(`subtitle: pickSubTrack with the track lists that yt-dlp really returned`, function() {

    it(`should have the structure of the samples that the cases below rely on`, function() {
        //前提: 樣本之結構(以免樣本被改而案例碰巧通過)
        let tx = load('TXcnAHNA0RU')
        assert.strict.deepEqual(Object.keys(tx.subtitles), ['zh-Hans'])
        assert.strict.equal(Object.keys(tx.automatic_captions).length, 157)
        assert.strict.deepEqual(tx.automatic_captions['zh-Hans'][0], { ext: 'vtt' }) //自動軌第1筆格式為無name之vtt
        assert.strict.equal(tx.automatic_captions['zh-Hans'].some((f) => f.ext === 'json3' && f.name === 'Chinese (Simplified)'), true)
        let ps = load('9bZkp7q19f0')
        assert.strict.deepEqual(Object.keys(ps.subtitles), [])
        assert.strict.equal(Object.keys(ps.automatic_captions).length, 157)
        assert.strict.equal(Object.keys(ps.automatic_captions)[0], 'ab') //清單第1筆為無關語言
        assert.strict.equal('ko-orig' in ps.automatic_captions, true)
        let jf = load('jfXg5ZslKg4')
        assert.strict.deepEqual(jf.automatic_captions['zh-Hant'].map((f) => f.ext), ['vtt']) //自動軌僅vtt
    })

    it(`should take the only manual track of a video and not an auto track, whatever langs says`, function() {
        //規格: 有手動字幕時只從手動字幕挑(任何語言之手動字幕優先於自動字幕); 回傳之name取自json3
        let info = load('TXcnAHNA0RU')
        for (let langs of [langsDef, ['en'], ['ko'], ['zh-Hans']]) {
            let r = pickSubTrack(info, langs)
            assert.strict.equal(r.track.languageCode, 'zh-Hans')
            assert.strict.equal(r.track.kind, 'manual')
            assert.strict.equal(r.track.name, 'Chinese (Simplified)')
            assert.strict.equal(r.translated, false)
            assert.strict.equal(r.tracks.length, 1)
        }
    })

    it(`should pick the auto track from the auto-only video: a machine translation by default, the original language when asked`, function() {
        //規格: 自動字幕中語言相符者先取非機器翻譯者, 只有機器翻譯相符時才取並標translated; 皆不符取原文軌而非清單第1筆(ab)
        let info = load('9bZkp7q19f0')
        let rDef = pickSubTrack(info, langsDef)
        assert.strict.equal(rDef.track.languageCode, 'zh-Hant')
        assert.strict.equal(rDef.track.kind, 'asr')
        assert.strict.equal(rDef.translated, true)
        assert.strict.equal(rDef.tracks.length, 157)
        let rKo = pickSubTrack(info, ['ko'])
        assert.strict.equal(rKo.track.languageCode, 'ko')
        assert.strict.equal(rKo.translated, false)
        assert.strict.equal(pickSubTrack(info, ['ko-orig']).track.languageCode, 'ko-orig')
        let rNone = pickSubTrack(info, ['xx'])
        assert.strict.equal(rNone.track.languageCode, 'ko-orig')
        assert.strict.equal(rNone.translated, false)
        let rZh = pickSubTrack(info, ['zh']) //語言前綴: 只有機器翻譯之zh-*
        assert.strict.equal(rZh.track.languageCode.startsWith('zh-'), true)
        assert.strict.equal(rZh.translated, true)
    })

    it(`should not take an auto track that has no json3 format, and prefer the manual track of the same language`, function() {
        //規格: 無json3者不列(實測yt-dlp遇之不報錯而改下載vtt); 同語言之手動軌(有json3)優先
        let jf = load('jfXg5ZslKg4')
        let r = pickSubTrack(jf, langsDef)
        assert.strict.equal(r.track.languageCode, 'zh-Hant')
        assert.strict.equal(r.track.kind, 'manual')
        assert.strict.equal(pickSubTrack({ automatic_captions: jf.automatic_captions }, langsDef), null) //只剩僅vtt之自動軌: 無可用字幕軌
    })

    it(`should pick the caption tracks that have an id suffix in their codes, such as en-uYU-mmqFLq8`, function() {
        //規格: 語言代碼可含軌別碼(非標準BCP47), 語言前綴(en)可中, 完全相同者優先; 手動(CC)字幕優先於自動字幕
        let info = load('7ZiUbT1-djA')
        assert.strict.deepEqual(Object.keys(info.subtitles), ['en-uYU-mmqFLq8', 'en-JkeT_87f4cc'])
        let r = pickSubTrack(info, langsDef)
        assert.strict.equal(r.track.languageCode, 'en-uYU-mmqFLq8')
        assert.strict.equal(r.track.kind, 'manual')
        assert.strict.equal(r.track.name.length > 0, true)
        assert.strict.equal(pickSubTrack(info, ['en-JkeT_87f4cc']).track.languageCode, 'en-JkeT_87f4cc')
        assert.strict.equal(pickSubTrack(info, ['EN-JKET_87F4CC']).track.languageCode, 'en-JkeT_87f4cc') //大小寫不分
        assert.strict.equal(r.tracks.length, 2)
    })

})
