//子行程工具: 於他處工作目錄(由呼叫端以cwd指定)載入src/ensureBins.mjs並離線呼叫, 輸出快取路徑
//供test/api-ensureBins.test.mjs驗證pkgRoot與載入時之工作目錄無關(pkgRoot於模組載入時決定, 故須以子行程載入)
//用法: node test/tools/ensureBinsChild.mjs <src/ensureBins.mjs之絕對路徑>
import { pathToFileURL } from 'url'


let fp = process.argv[2]
let { default: ensureBins } = await import(pathToFileURL(fp).href)

let err = null
await ensureBins({ offline: true, mirror: '' })
    .catch((e) => {
        err = e
    })

console.log(JSON.stringify({
    cwd: process.cwd(),
    code: err && err.code,
    cachePath: err && err.missing && err.missing[0] && err.missing[0].cachePath,
}))
