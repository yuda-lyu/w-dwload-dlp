import fs from 'fs'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'
import { setupMirror } from './tools/dwMirror.mjs'
import { ensureFfmpeg, FFMPEG_BUDGET_MS } from './tools/ffmpegBins.mjs'
import { startSampleServer, isolateExternal } from './tools/sampleServer.mjs'


function isWindows() {
    return process.platform === 'win32'
}


describe('WDwloadDlp m3u8', function() {

    //check
    if (!isWindows()) {
        return
    }

    //yt-dlp.exe以本機鏡像供檔(經清單校驗); ffmpeg.exe經共用取得點ensureFfmpeg取得(時限對齊下載預算, 跨程序只下載一次, R6); m3u8樣本由本機HTTP服務供應, 且yt-dlp.exe之對外請求一律經不通之代理(不連jsDelivr; Node自身之fetch不受此限, 仍會取GitHub主幹清單, 見isolateExternal)
    let m = null
    let srv = null
    let restoreEnv = null
    before(async function() {
        this.timeout(FFMPEG_BUDGET_MS)
        await ensureFfmpeg()
        m = setupMirror('dwM3u8')
        srv = await startSampleServer()
        restoreEnv = isolateExternal()
    })
    after(async function() {
        if (restoreEnv) {
            restoreEnv()
        }
        if (srv) {
            await srv.close()
        }
        if (m) {
            m.restore()
        }
    })

    async function test() {

        //url
        let url = srv.urls.m3u8 //m3u8(HLS), 本機服務供應w-demores之aigen_hls樣本

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
