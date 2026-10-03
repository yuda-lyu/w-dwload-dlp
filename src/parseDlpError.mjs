import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import uniq from 'lodash-es/uniq.js'
import filter from 'lodash-es/filter.js'
import takeRight from 'lodash-es/takeRight.js'
import sep from 'wsemi/src/sep.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import cint from 'wsemi/src/cint.mjs'


//rules, 依yt-dlp之ERROR內容分類, 由具體至泛化排列, 先命中者為準, 各樣式皆取自實測之yt-dlp輸出
let rules = [
    {
        code: 'unsupportedUrl',
        re: /Unsupported URL/,
        hint: 'url is not a video page or stream that yt-dlp can recognize (e.g. a web player page), pass the actual video or stream (m3u8/mp4) url instead',
    },
    {
        code: 'unavailable',
        re: /This video is unavailable/,
        hint: 'video does not exist, has been removed, or is not accessible',
    },
    {
        code: 'sslFailed',
        re: /CERTIFICATE_VERIFY_FAILED/,
        hint: 'ssl certificate verification failed, if the certificate comes from a network-level block page (e.g. DNS filtering) the domain is blocked, otherwise the source host has an invalid certificate',
    },
    {
        code: 'dnsFailed',
        re: /Failed to resolve/,
        hint: 'domain name can not be resolved, check the url and network, or the domain may be invalid or blocked',
    },
    {
        code: 'connectFailed',
        re: /Failed to establish a new connection/,
        hint: 'can not connect to the source host, check the network or retry later',
    },
    {
        code: 'http403',
        re: /HTTP Error 403/,
        hint: 'source refused access (403), it may require referer, cookie or token, or the url has expired',
    },
    {
        code: 'http404',
        re: /HTTP Error 404/,
        hint: 'source not found (404), check whether the url is correct or has expired',
    },
    {
        code: 'httpError',
        re: /HTTP Error \d+/,
        hint: 'source responded with an http error',
    },
]


/**
 * 由yt-dlp之stderr提取錯誤並分類，組成調用方易讀之錯誤訊息
 *
 * 回傳字串首行固定為`[代碼] 說明與處置`，供調用方判斷錯誤類型，次行起依序為下載進度(有fragment資訊時)、yt-dlp之ERROR原文、WARNING原文(去重後最多3行)
 *
 * 代碼可為unsupportedUrl、unavailable、sslFailed、dnsFailed、connectFailed、http403、http404、httpError，有ERROR但不屬前述者為dlpFailed，無任何ERROR者為execFailed
 *
 * @param {String} stderr 輸入yt-dlp之stderr字串，其ERROR與WARNING皆輸出於此
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.raw=''] 輸入execProcess之reject字串，供stderr無ERROR時備援，預設''
 * @param {Integer} [opt.nnf=0] 輸入失敗前已下載fragment數，預設0
 * @param {Integer} [opt.naf=0] 輸入全部須下載fragment數，0代表尚未進入fragment下載階段，預設0
 * @returns {String} 回傳錯誤訊息字串
 * @example
 * import parseDlpError from './src/parseDlpError.mjs'
 *
 * let stderr = 'ERROR: unable to download video data: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007)\n'
 * console.log(parseDlpError(stderr, { nnf: 24, naf: 406 }))
 * // [sslFailed] ssl certificate verification failed, if the certificate comes from a network-level block page (e.g. DNS filtering) the domain is blocked, otherwise the source host has an invalid certificate
 * // progress: 24/406 fragments downloaded before failure
 * // ERROR: unable to download video data: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007)
 *
 */
function parseDlpError(stderr, opt = {}) {

    //raw
    let raw = get(opt, 'raw', '')
    if (!isestr(raw)) {
        raw = ''
    }

    //nnf
    let nnf = get(opt, 'nnf', 0)
    nnf = isnum(nnf) ? cint(nnf) : 0

    //naf
    let naf = get(opt, 'naf', 0)
    naf = isnum(naf) ? cint(naf) : 0

    //ls, stderr逐列
    let ls = isestr(stderr) ? sep(stderr, '\n') : []
    ls = map(ls, (l) => {
        return l.trim()
    })

    //errors, 去重
    let errors = uniq(filter(ls, (l) => {
        return l.indexOf('ERROR:') === 0
    }))

    //warnings, 去重後取最後3行, 避免重試類警告大量重複淹沒錯誤
    let warnings = takeRight(uniq(filter(ls, (l) => {
        return l.indexOf('WARNING:') === 0
    })), 3)

    //code, hint
    let code = ''
    let hint = ''
    if (errors.length === 0) {

        //無ERROR, 例如逾時、子程序異常退出或無法啟動
        code = 'execFailed'
        hint = 'yt-dlp exited abnormally without error message'

    }
    else {

        //依rules分類
        let s = errors.join('\n')
        for (let r of rules) {
            if (r.re.test(s)) {
                code = r.code
                hint = r.hint
                break
            }
        }

        //未命中任何rules
        if (code === '') {
            code = 'dlpFailed'
            hint = 'yt-dlp failed, see the error message below'
        }

    }

    //ms
    let ms = [`[${code}] ${hint}`]

    //progress, 已進入fragment下載階段時, 標示失敗前已下載數量, 供判斷是整體無法下載或中途某片段失敗
    if (naf > 0) {
        ms.push(`progress: ${nnf}/${naf} fragments downloaded before failure`)
    }

    //errors, warnings
    ms = [...ms, ...errors, ...warnings]

    //raw, 無ERROR時以execProcess之reject字串首行(離開碼或逾時)與末3行非空列備援
    if (errors.length === 0 && raw !== '') {
        let rs = filter(map(sep(raw, '\n'), (l) => {
            return l.trim()
        }), (l) => {
            return l !== ''
        })
        let rsTail = takeRight(rs.slice(1), 3)
        ms = [...ms, ...rs.slice(0, 1), ...rsTail]
    }

    return ms.join('\n')
}


export default parseDlpError
