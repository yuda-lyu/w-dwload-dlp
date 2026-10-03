import assert from 'assert'
import parseDlpError from '../src/parseDlpError.mjs'


//樣本, 皆為yt-dlp 2026.08.19之stderr原文, 由實際執行各失敗情境取得
let S = {
    unsupported: 'WARNING: [generic] Falling back on generic information extractor\nERROR: Unsupported URL: https://example.com/\n',
    unavailable: 'WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default; to use another runtime add  --js-runtimes RUNTIME[:PATH]  to your command/config. YouTube extraction without a JS runtime has been deprecated, and some formats may be missing. See  https://github.com/yt-dlp/yt-dlp/wiki/EJS  for details on installing one\nERROR: [youtube] aaaaaaaaaaa: This video is unavailable\n',
    sslExtract: 'ERROR: [generic] self-signed.badssl: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007) (caused by CertificateVerifyError(\'[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007)\')); please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U\n',
    sslFragment: 'ERROR: unable to download video data: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007)\n',
    dns: 'ERROR: [generic] a: Unable to download webpage: HTTPSConnection(host=\'this-domain-does-not-exist-xyz123abc.com\', port=443): Failed to resolve \'this-domain-does-not-exist-xyz123abc.com\' ([Errno 11001] getaddrinfo failed) (caused by TransportError("HTTPSConnection(host=\'this-domain-does-not-exist-xyz123abc.com\', port=443): Failed to resolve \'this-domain-does-not-exist-xyz123abc.com\' ([Errno 11001] getaddrinfo failed)"))\n',
    refused: 'ERROR: [generic] a: Unable to download webpage: HTTPSConnection(host=\'127.0.0.1\', port=9): Failed to establish a new connection: [WinError 10061] 無法連線，因為目標電腦拒絕連線。 (caused by TransportError("HTTPSConnection(host=\'127.0.0.1\', port=9): Failed to establish a new connection: [WinError 10061] 無法連線，因為目標電腦拒絕連線。"))\n',
    http403: 'ERROR: [generic] 403: Unable to download webpage: HTTP Error 403: FORBIDDEN (caused by <HTTPError 403: FORBIDDEN>)\n',
    http404: 'ERROR: [generic] x: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)\n',
    http500: 'ERROR: [generic] 500: Unable to download webpage: HTTP Error 500: INTERNAL SERVER ERROR (caused by <HTTPError 500: INTERNAL SERVER ERROR>)\n',
    format: 'ERROR: [generic] playlist: Requested format is not available. Use --list-formats for a list of available formats\n',
}

//W, 實際出現過之WARNING原文
let W = [
    'WARNING: [generic] Falling back on generic information extractor',
    'WARNING: Your yt-dlp version (2026.03.17) is older than 90 days!',
    'WARNING: playlist: Possible MPEG-TS in MP4 container or malformed AAC timestamps. Install ffmpeg to fix this automatically',
    'WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default; to use another runtime add  --js-runtimes RUNTIME[:PATH]  to your command/config. YouTube extraction without a JS runtime has been deprecated, and some formats may be missing. See  https://github.com/yt-dlp/yt-dlp/wiki/EJS  for details on installing one',
]


//summary, 拆解錯誤訊息為首行之代碼、首行是否附處置說明、其餘各行
function summary(s) {
    let ls = s.split('\n')
    let m = ls[0].match(/^\[(\w+)\] (.*)$/)
    return {
        code: m ? m[1] : '',
        hasHint: m ? m[2].trim().length > 0 : false,
        lines: ls.slice(1),
    }
}


describe('parseDlpError', function() {

    //首行[代碼]供調用方判斷錯誤類型, 並附處置說明; 其後保留yt-dlp之ERROR與WARNING原文

    it('unsupportedUrl', function() {
        let r = {
            code: 'unsupportedUrl',
            hasHint: true,
            lines: [
                'ERROR: Unsupported URL: https://example.com/',
                'WARNING: [generic] Falling back on generic information extractor',
            ],
        }
        let rr = summary(parseDlpError(S.unsupported))
        assert.strict.deepEqual(rr, r)
    })

    it('unavailable', function() {
        let r = {
            code: 'unavailable',
            hasHint: true,
            lines: [
                'ERROR: [youtube] aaaaaaaaaaa: This video is unavailable',
                W[3],
            ],
        }
        let rr = summary(parseDlpError(S.unavailable))
        assert.strict.deepEqual(rr, r)
    })

    it('sslFailed when extracting', function() {
        let rr = summary(parseDlpError(S.sslExtract))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['sslFailed', true, [S.sslExtract.trim()]])
    })

    it('sslFailed during fragment download, with progress', function() {
        //失敗於下載中途時, 須標示失敗前已下載之fragment數, 供判斷是中途某片段失敗而非整體無法下載
        let r = {
            code: 'sslFailed',
            hasHint: true,
            lines: [
                'progress: 24/406 fragments downloaded before failure',
                'ERROR: unable to download video data: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self signed certificate (_ssl.c:1007)',
            ],
        }
        let rr = summary(parseDlpError(S.sslFragment, { nnf: 24, naf: 406 }))
        assert.strict.deepEqual(rr, r)
    })

    it('dnsFailed', function() {
        let rr = summary(parseDlpError(S.dns))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['dnsFailed', true, [S.dns.trim()]])
    })

    it('connectFailed, keeps chinese system message', function() {
        let rr = summary(parseDlpError(S.refused))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['connectFailed', true, [S.refused.trim()]])
        assert.strict.equal(rr.lines[0].indexOf('無法連線，因為目標電腦拒絕連線。') >= 0, true)
    })

    it('http403', function() {
        let rr = summary(parseDlpError(S.http403))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['http403', true, [S.http403.trim()]])
    })

    it('http404', function() {
        let rr = summary(parseDlpError(S.http404))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['http404', true, [S.http404.trim()]])
    })

    it('httpError for other status', function() {
        let rr = summary(parseDlpError(S.http500))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['httpError', true, [S.http500.trim()]])
    })

    it('dlpFailed when error matches no rule', function() {
        let rr = summary(parseDlpError(S.format))
        assert.strict.deepEqual([rr.code, rr.hasHint, rr.lines], ['dlpFailed', true, [S.format.trim()]])
    })

    it('execFailed when no error, falls back to raw', function() {
        //無ERROR時(例如逾時)以execProcess之reject字串首行備援, 調用方仍可得知為逾時
        let r = {
            code: 'execFailed',
            hasHint: true,
            lines: [
                'timeout[300ms]:',
            ],
        }
        let rr = summary(parseDlpError('', { raw: 'timeout[300ms]:\n' }))
        assert.strict.deepEqual(rr, r)
    })

    it('excludes progress lines of raw when error exists', function() {
        //有ERROR時不得夾帶execProcess之reject字串中之大量進度列
        let raw = 'code[1]:\n[download]   5.5% of ~ 328.39MiB at    2.70MiB/s ETA 02:12 (frag 23/406)\n[download]   5.7% of ~ 327.23MiB at    2.57MiB/s ETA 02:11 (frag 24/406)\n' + S.sslFragment
        let s = parseDlpError(S.sslFragment, { raw, nnf: 24, naf: 406 })
        assert.strict.equal(s.indexOf('[download]'), -1)
        assert.strict.equal(s.indexOf('code[1]:'), -1)
    })

    it('dedupes repeated errors', function() {
        let rr = summary(parseDlpError(S.http404 + S.http404))
        assert.strict.deepEqual(rr.lines, [S.http404.trim()])
    })

    it('keeps the last 3 distinct warnings', function() {
        //重試類警告可能大量重複, 去重後僅保留最後3行, 避免淹沒錯誤
        let stderr = [W[0], W[1], W[0], W[2], W[3], S.format.trim()].join('\n')
        let rr = summary(parseDlpError(stderr))
        assert.strict.deepEqual(rr.lines, [S.format.trim(), W[1], W[2], W[3]])
    })

    it('handles windows line endings', function() {
        let rr = summary(parseDlpError(S.http404.replace('\n', '\r\n')))
        assert.strict.deepEqual([rr.code, rr.lines], ['http404', [S.http404.trim()]])
    })

})
