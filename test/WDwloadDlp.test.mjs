import fs from 'fs'
import assert from 'assert'
import WDwloadDlp from '../src/WDwloadDlp.mjs'


function isWindows() {
    return process.platform === 'win32'
}


describe('WDwloadDlp', function() {

    //check
    if (!isWindows()) {
        return
    }

    async function test() {

        //url
        let url = `https://www.youtube.com/watch?v=ygA19W750zc` //youtube mp4

        //fp
        let fp = './abc.mp4'

        //funProg
        let funProg = (prog, nn, na) => {
            console.log('prog', `${prog.toFixed(2)}%`, nn, na)
        }

        //WDwloadDlp
        await WDwloadDlp(url, fp, {
            clean: true, //單一程序執行時, 事先清除之前暫存檔, 減少浪費硬碟空間
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
        let r = 22394508
        let rr = await test()
        assert.strict.deepEqual(r, rr)
    })

})
