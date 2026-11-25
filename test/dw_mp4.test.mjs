import fs from 'fs'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { setupMirror } from './tools/dwMirror.mjs'
import { ensureFfmpeg, FFMPEG_BUDGET_MS } from './tools/ffmpegBins.mjs'


function isWindows() {
    return process.platform === 'win32'
}


describe('WDwloadDlp mp4', function() {

    //check
    if (!isWindows()) {
        return
    }

    //yt-dlp.exe以本機鏡像供檔(經清單校驗); ffmpeg.exe經共用取得點ensureFfmpeg取得(時限對齊下載預算, 跨程序只下載一次, R6)
    //本檔為本套件核心功能之整合測試: 下載YouTube真實影片, 須外網, 網路不穩或YouTube限制時會紅(見README〈測試之網路需求〉與rulebook R6), 不改為預設略過
    let m = null
    before(async function() {
        this.timeout(FFMPEG_BUDGET_MS)
        await ensureFfmpeg()
        m = setupMirror('dwMp4')
    })
    after(function() {
        if (m) {
            m.restore()
        }
    })

    async function test() {

        //url
        let url = `https://www.youtube.com/watch?v=jfXg5ZslKg4` //youtube mp4

        //fp
        let fp = './test_mp4.mp4'

        //funProg
        let funProg = (prog, nn, na) => {
            console.log('prog', `${prog.toFixed(2)}%`, nn, na)
        }

        //WDwloadDlp
        await WDwloadDlp(url, fp, {
            funProg,
        })

        //len
        let len = fs.statSync(fp).size
        // console.log('len', len)

        //unlinkSync
        fs.unlinkSync(fp)

        return len
    }
    // test()
    //     .catch((err) => {
    //         console.log('catch', err)
    //     })

    it('download', async function() {
        let r = 50947689
        let rr = await test()
        assert.strict.deepEqual(r, rr)
    })

})
