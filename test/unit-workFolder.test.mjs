import fs from 'fs'
import assert from 'assert'


//規則(sgud/rule/rulebook.md R3): 每次呼叫用自己之工作夾, 不再有共用下載夾與opt.clean; 殘留判定時間為單一常數
describe(`work folder rules in the source (R3)`, function() {

    let src = fs.readFileSync('src/WDwloadDlp.mjs', 'utf8')
    let readme = fs.readFileSync('README.md', 'utf8')

    it(`should not read the removed option clean, nor clean a shared download folder, nor keep the shared folder name`, function() {
        assert.strict.equal(/get\(\s*opt\s*,\s*'clean'/.test(src), false)
        assert.strict.equal(/opt\.clean/.test(src), false)
        assert.strict.equal(/fsCleanFolder/.test(src), false)
        assert.strict.equal(/'Downloads'|\/Downloads/.test(src), false)
    })

    it(`should define the staleness time of leftover work folders at one place, as 24 hours`, function() {
        let ms = src.match(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/g) || []
        assert.strict.equal(ms.length, 1)
        assert.strict.equal(/let msStaleWork = 24 \* 60 \* 60 \* 1000/.test(src), true)
    })

    it(`should mention clean in the README only to announce its removal, and not in the usage example`, function() {
        let iBreaking = readme.indexOf('## Breaking changes')
        assert.strict.equal(iBreaking > 0, true)
        assert.strict.equal(/clean\s*:/.test(readme.slice(0, iBreaking)), false) //範例與說明不再出現clean選項
        let sec = readme.slice(iBreaking)
        assert.strict.equal(/`clean`/.test(sec), true) //Breaking changes載明移除
        assert.strict.equal(sec.includes('w-dwload-dlp/<'), true) //並載明新的暫存位置
    })

    it(`should not pass the removed option clean in the functional tests`, function() {
        for (let fp of ['test/dw_mp4.test.mjs', 'test/dw_m3u8.test.mjs']) {
            assert.strict.equal(/clean\s*:/.test(fs.readFileSync(fp, 'utf8')), false, fp)
        }
    })

})
