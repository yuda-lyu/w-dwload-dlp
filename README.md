# w-dwload-dlp
A download tool for video.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-dwload-dlp.svg?style=flat)](https://npmjs.org/package/w-dwload-dlp) 
[![license](https://img.shields.io/npm/l/w-dwload-dlp.svg?style=flat)](https://npmjs.org/package/w-dwload-dlp) 
[![npm download](https://img.shields.io/npm/dt/w-dwload-dlp.svg)](https://npmjs.org/package/w-dwload-dlp) 
[![npm download](https://img.shields.io/npm/dm/w-dwload-dlp.svg)](https://npmjs.org/package/w-dwload-dlp) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-dwload-dlp.svg)](https://www.jsdelivr.com/package/npm/w-dwload-dlp)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-dwload-dlp/global.html).

## Core
> `w-dwload-dlp` is basing on `yt-dlp`.

> The ffmpeg.exe file is too large and will be split into small zip files for upload. If ffmpeg is missing during the first execution, it will be automatically decompressed from the zip file.

## Installation
### Using npm(ES6 module):
> **Note:** `w-dwload-dlp` is mainly dependent on `lodash-es` and `wsemi`, and should run in `Windows`.

```alias
npm i w-dwload-dlp
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-dwload-dlp/blob/master/g.mjs)]
```alias
// import WDwloadDlp from 'w-dwload-dlp'
import WDwloadDlp from 'w-dwload-dlp/src/WDwloadDlp.mjs'

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
```
