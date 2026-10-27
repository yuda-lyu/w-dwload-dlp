/**
 * 解析並檢核yt-dlp/manifest.json(內附執行檔之完整性清單)
 *
 * 清單格式(schema 1)為JSON物件，欄位如下，多餘欄位忽略：
 * schema: 固定為1；
 * file: 執行檔檔名，須等於fileExpected；
 * version: yt-dlp版本tag，如`2026.10.26`，須與yt-dlp-ver.txt首列之tag一致；
 * sha256: 執行檔之SHA-256，64碼小寫十六進位；
 * size: 執行檔位元組數，正整數。
 *
 * 任一欄位缺漏或格式不符即拋錯(code為E_MANIFEST_FORMAT)，不做任何容錯或預設值，
 * 因清單是下載後比對之唯一依據，寧可失敗也不退回未驗證之下載
 *
 * @private
 * @param {String} text 清單原文字串
 * @param {String} [fileExpected='yt-dlp.exe'] 預期之執行檔檔名
 * @returns {Object} 回傳物件{schema,file,version,sha256,size}
 */
function parseDlpManifest(text, fileExpected = 'yt-dlp.exe') {

    let bad = (msg) => {
        let err = new Error(`manifest is invalid: ${msg}`)
        err.code = 'E_MANIFEST_FORMAT'
        return err
    }

    //JSON
    let o = null
    try {
        o = JSON.parse(text)
    }
    catch (err) {
        throw bad(`not a JSON (${err.message})`)
    }
    if (o === null || typeof o !== 'object' || Array.isArray(o)) {
        throw bad('the root is not an object')
    }

    //schema
    if (o.schema !== 1) {
        throw bad(`schema must be 1, got ${JSON.stringify(o.schema)}`)
    }

    //file
    if (o.file !== fileExpected) {
        throw bad(`file must be "${fileExpected}", got ${JSON.stringify(o.file)}`)
    }

    //version
    if (typeof o.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(o.version)) {
        throw bad(`version must be a tag string like "2026.10.26", got ${JSON.stringify(o.version)}`)
    }

    //sha256
    if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) {
        throw bad(`sha256 must be 64 lowercase hex characters, got ${JSON.stringify(o.sha256)}`)
    }

    //size
    if (!Number.isSafeInteger(o.size) || o.size <= 0) {
        throw bad(`size must be a positive integer, got ${JSON.stringify(o.size)}`)
    }

    return {
        schema: o.schema,
        file: o.file,
        version: o.version,
        sha256: o.sha256,
        size: o.size,
    }
}


export default parseDlpManifest
