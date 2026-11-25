import fs from 'fs'
import ensureBinsFfmpeg from 'w-ffmpeg/src/ensureBins.mjs'


//測試取得ffmpeg.exe之唯一取得點(rulebook R6)
//ffmpeg.exe為w-ffmpeg內附之外部執行檔(約122MB, 5個分片), 快取於node_modules/w-ffmpeg/bin-cache, w-ffmpeg升版即清空, 故連動後跟跑之測試會遇到首次下載
//mocha --parallel之各worker為獨立程序, 各自下載會互搶頻寬, 且全域--timeout 180000短於下載預算而逾時, 故:
//1. 需要真ffmpeg.exe之測試檔(真跑WDwloadDlp主函數者)一律於before呼叫ensureFfmpeg(), 並以this.timeout(FFMPEG_BUDGET_MS)給足下載預算; 其後之案只用已備妥之快取, 不在it內隱式取得
//2. 跨程序只下載一次由wsemi(1.9.75起)之fsEnsureBins之鎖保證(一個程序下載, 其餘等候後讀快取), 本工具不另寫鎖; 所取為w-ffmpeg之深層入口src/ensureBins.mjs(經頂層wsemi之fsEnsureBins),
//   不用公開之UMD入口WFfmpeg.ensureBins: w-ffmpeg 1.0.60之dist內嵌舊版wsemi而無鎖(見unit-ffmpegBins.test.mjs); w-ffmpeg發布內嵌wsemi 1.9.75以上之dist後可改回公開入口
//3. 取得過程之事件(觀察回調onTrace)於環境變數W_DLP_TEST_TRACE指定一個檔案時逐行(JSON)附加寫入, 供驗收以事件計數(各程序下載之分片數、等候鎖之程序), 未設時不寫


//FFMPEG_NAME, 取得之檔名
let FFMPEG_NAME = 'ffmpeg.exe'

//FFMPEG_PARTS, w-ffmpeg之bin/manifest.json中ffmpeg.exe之分片數(下載單位數); FFMPEG_EXTRACT_BATCHES, 解壓批數(zip單一成員為1); 與清單之對照見unit-ffmpegBins.test.mjs
let FFMPEG_PARTS = 5
let FFMPEG_EXTRACT_BATCHES = 1

//FFMPEG_TOTAL_MS, 交fsEnsureBins之opt.totalMs: 每個下載單位(分片)整體時間上限, 亦為解壓之時間上限(預設600000, 此處收緊為5分鐘, 使最壞情形之預算約33分鐘而非約1小時)
let FFMPEG_TOTAL_MS = 300000

//FFMPEG_LOCK_LIMIT_MS, fsEnsureBins之鎖等候上限(無鏡像時): 下載次數(分片數)×totalMs＋解壓批數×(totalMs＋5秒)＋寬裕(totalMs與60秒之小者); 逾此等候者得E_LOCK_TIMEOUT
let FFMPEG_LOCK_LIMIT_MS = FFMPEG_PARTS * FFMPEG_TOTAL_MS + FFMPEG_EXTRACT_BATCHES * (FFMPEG_TOTAL_MS + 5000) + Math.min(FFMPEG_TOTAL_MS, 60000)

//FFMPEG_BUDGET_MS, 取得之before之時限(this.timeout): 須大於單次之鎖等候上限, 使一般最壞情形(單一持有者卡住)由fsEnsureBins以帶code之錯誤失敗, 而非先被mocha以逾時掩蓋
//限制: ①等候上限於每換一個持有者時重新起算, 取得鎖後尚須自行下載一輪, 連續換手之最壞情形可逾本預算; ②環境若設W_BIN_MIRROR, wsemi之上限依鏡像另加(m=1時約61分), 逾預算時由mocha逾時先到;
//③totalMs由預設600秒收緊為300秒, 26MB之分片於約87KB/s以下會E_TIMEOUT_TOTAL(已接受之取捨: 慢速網路下取得失敗屬訊號, 而非掛起)
let FFMPEG_BUDGET_MS = FFMPEG_LOCK_LIMIT_MS + 120000

//TRACE_KEYS, 寫入事件紀錄之欄位(白名單; 事件之其餘欄位不寫)
let TRACE_KEYS = ['type', 'name', 'file', 'phase', 'hit', 'why', 'ok', 'code', 'mode', 'result']


/**
 * createFfmpegProvider, 建立取得ffmpeg.exe之提供者(含程序內之共用: 同一提供者之併發呼叫共用同一次取得, 失敗不記住, 下次呼叫重取)
 *
 * @param {Object} [opt={}] 設定物件
 * @param {Function} [opt.ensureBins] 取得函數(測試注入用), 預設為w-ffmpeg之src/ensureBins.mjs
 * @param {Object} [opt.env=process.env] 環境變數物件(讀W_DLP_TEST_TRACE)
 * @returns {Object} 回傳{ get }, get()回傳Promise, resolve為ffmpeg.exe之絕對路徑
 */
function createFfmpegProvider(opt = {}) {
    let ensureBins = opt.ensureBins || ensureBinsFfmpeg
    let env = opt.env || process.env
    let pending = null

    let onTrace = (ev) => {
        let fpLog = env.W_DLP_TEST_TRACE
        if (typeof fpLog !== 'string' || fpLog === '') {
            return
        }
        let o = { pid: process.pid, t: Date.now() }
        for (let k of TRACE_KEYS) {
            if (ev[k] !== undefined) {
                o[k] = ev[k]
            }
        }
        try {
            fs.appendFileSync(fpLog, `${JSON.stringify(o)}\n`)
        }
        catch (err) {} // eslint-disable-line no-empty
        //紀錄僅供驗收, 寫不進去(目錄不存在、被占用等)不得影響取得; 契約不仰賴呼叫端(wsemi)吞例外
    }

    let get = () => {
        if (pending === null) {
            pending = Promise.resolve()
                .then(() => ensureBins({ names: FFMPEG_NAME, totalMs: FFMPEG_TOTAL_MS, onTrace }))
                .then((bins) => bins[FFMPEG_NAME])
                .catch((err) => {
                    pending = null
                    throw err
                })
        }
        return pending
    }

    return { get }
}


//ensureFfmpeg, 本程序之共用提供者; 需要真ffmpeg.exe之測試檔於before呼叫(含this.timeout(FFMPEG_BUDGET_MS)), 回傳ffmpeg.exe之絕對路徑
let provider = createFfmpegProvider()
let ensureFfmpeg = provider.get


export { ensureFfmpeg, createFfmpegProvider, FFMPEG_NAME, FFMPEG_PARTS, FFMPEG_EXTRACT_BATCHES, FFMPEG_TOTAL_MS, FFMPEG_LOCK_LIMIT_MS, FFMPEG_BUDGET_MS }
