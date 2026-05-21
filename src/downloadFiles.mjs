import fsDownloadFile from 'wsemi/src/fsDownloadFile.mjs'


async function downloadFiles(fdBase) {

    //url
    let url = `https://github.com/yuda-lyu/w-dwload-dlp/raw/refs/heads/master/yt-dlp/yt-dlp.exe`
    // console.log('url',url)

    //fn
    let fn = `yt-dlp.exe`

    //fp
    let fp = `${fdBase}${fn}`

    //fsDownloadFile
    console.log(`downloading url[${url}]...`, `to fp[${fp}]`)
    await fsDownloadFile(url, fp)

}


export default downloadFiles
