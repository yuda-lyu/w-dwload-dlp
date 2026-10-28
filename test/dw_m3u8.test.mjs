import fs from 'fs'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { setupMirror } from './tools/dwMirror.mjs'


function isWindows() {
    return process.platform === 'win32'
}


describe('WDwloadDlp m3u8', function() {

    //check
    if (!isWindows()) {
        return
    }

    //yt-dlp.exe以本機鏡像供檔(經清單校驗), ffmpeg.exe由w-ffmpeg取得
    let m = null
    before(function() {
        m = setupMirror('dwM3u8')
    })
    after(function() {
        m.restore()
    })

    async function test() {

        //url
        let url = `https://cdn.jsdelivr.net/npm/w-demores/res/video/aigen_hls/playlist.m3u8` //m3u8(HLS)

        //fp
        let fp = './test_m3u8.mp4'

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
        let r = 283222
        let rr = await test()
        assert.strict.deepEqual(r, rr)
    })

})
