// import WDwloadDlp from 'w-dwload-dlp'
import WDwloadDlp from './src/WDwloadDlp.mjs'


async function test() {

    //url
    let url = `https://www.youtube.com/watch?v=uj8hjLyEBmU&ab_channel=%E7%A0%81%E5%86%9C%E9%AB%98%E5%A4%A9` //youtube
    // let url = `https://www.bilibili.com/video/BV1JZ421x7q8/?spm_id_from=333.1073.channel.secondary_floor_video.click` //bilibili

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
// done: ./test.mp4

//node --experimental-modules g.mjs
