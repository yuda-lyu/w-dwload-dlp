import path from 'path'
import { fileURLToPath } from 'url'
import downloadFiles from '../src/downloadFiles.mjs'


async function init() {

    //check, 被安裝為相依套件時才執行 (位於node_modules內)
    let __dirname = path.dirname(fileURLToPath(import.meta.url))
    if (!__dirname.includes('node_modules')) {
        return //非位於node_modules, 代表開發套件本身, 不下載
    }

    //fdSrv, postinstall時cwd=套件自身在node_modules內的目錄
    let fdSrv = path.resolve()

    //fdBase, 對應yt-dlp.exe所在資料夾
    let fdBase = `${fdSrv}/yt-dlp/`

    //downloadFiles
    await downloadFiles(fdBase)

}
init()
    .catch((err) => {
        console.log(err)
    })

//node scripts/install.mjs
