import fs from 'fs'
import WDwloadDlp from './src/WDwloadDlp.mjs'


async function test() {

    //url
    let url = `https://www.youtube.com/watch?v=jfXg5ZslKg4&list=RDjfXg5ZslKg4&start_radio=1` //youtube mp4
    // let url = `https://www.youtube.com/watch?v=fTk0mc946dk` //youtube webm
    // let url = `https://www.youtube.com/watch?v=lKoCiBVKQaQ` //youtube webm
    // let url = `https://www.bilibili.com/video/BV1JZ421x7q8/?spm_id_from=333.1073.channel.secondary_floor_video.click` //bilibili
    // let url = `https://ooo.mp4` //直接提供mp4檔
    // let url = `https://cdn.jsdelivr.net/npm/w-demores/res/video/aigen_hls/playlist.m3u8`

    //fp
    let fp = './test.mp4'

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
    console.log('len', len)

    console.log('done:', fp)
}
test()
    .catch((err) => {
        console.log('catch', err)
    })
// prog 0.49% 1 99
// prog 5.05% 4 99
// ...
// prog 99.00% 98 99
// prog 100.00% 99 99
// len 22394508
// done: ./test.mp4

//node g.mjs
