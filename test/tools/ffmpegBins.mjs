import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import WFfmpeg from 'w-ffmpeg'
import fsEnsureBinsBudget from 'wsemi/src/fsEnsureBinsBudget.mjs'


//測試取得ffmpeg.exe之唯一取得點(rulebook R6)
//ffmpeg.exe為w-ffmpeg內附之外部執行檔(約122MB, 5個分片), 快取於node_modules/w-ffmpeg/bin-cache, w-ffmpeg升版即清空, 故連動後跟跑之測試會遇到首次下載
//mocha --parallel之各worker為獨立程序, 各自下載會互搶頻寬, 且全域--timeout 180000短於下載預算而逾時, 故:
//1. 需要真ffmpeg.exe之測試檔(真跑WDwloadDlp主函數者)一律於before呼叫ensureFfmpeg(), 並以this.timeout(FFMPEG_BUDGET_MS)給足下載預算; 其後之案只用已備妥之快取, 不在it內隱式取得
//2. 跨程序只下載一次由wsemi(1.9.75起)之fsEnsureBins之鎖保證(一個程序下載, 其餘等候後讀快取), 本工具不另寫鎖; 所取為w-ffmpeg之公開入口WFfmpeg.ensureBins(w-ffmpeg 1.0.61起之dist內嵌wsemi 1.9.75以上而具鎖, 見unit-ffmpegBins.test.mjs)
//3. 時限依規格(外部執行檔之存放下載校驗與離線 §6 E5-3)以wsemi之fsEnsureBinsBudget依w-ffmpeg之清單求得, 不自寫算式; 傳給取得函數之每檔上限(totalMs)不短於其預設, 故不傳(取預設)
//4. 取得過程之事件(觀察回調onTrace)於環境變數W_DLP_TEST_TRACE指定一個檔案時逐行(JSON)附加寫入, 供驗收以事件計數(各程序下載之分片數、等候鎖之程序), 未設時不寫


//FFMPEG_NAME, 取得之檔名
let FFMPEG_NAME = 'ffmpeg.exe'

//FFMPEG_PARTS, w-ffmpeg之bin/manifest.json中ffmpeg.exe之分片數(下載單位數), 供事件彙總(ffmpegTrace)判定空快取驗收須見到之下載次數; 預算不依賴它(由fsEnsureBinsBudget讀清單求得); 與清單之對照見unit-ffmpegBins.test.mjs
let FFMPEG_PARTS = 5

//FFMPEG_BUDGET_FACTOR, 首次取得之before時限對鎖等候上限之倍數: 並行時等候者最壞要先等他方(上限即鎖等候上限), 他方失敗才自行取得, 最壞約為兩倍(規格E5-3建議取兩倍)
let FFMPEG_BUDGET_FACTOR = 2

//pkgRootFfmpeg, w-ffmpeg之套件根(其bin/manifest.json即取得所依之清單)
let require = createRequire(import.meta.url)
let pkgRootFfmpeg = path.dirname(require.resolve('w-ffmpeg/package.json'))

//TRACE_KEYS, 寫入事件紀錄之欄位(白名單; 事件之其餘欄位不寫)
let TRACE_KEYS = ['type', 'name', 'file', 'phase', 'hit', 'why', 'ok', 'code', 'mode', 'result']


/**
 * calcFfmpegLockLimitMs, 依w-ffmpeg之清單求取得ffmpeg.exe之鎖等候上限(毫秒), 即wsemi之fsEnsureBinsBudget(與fsEnsureBins之鎖之上限同一算式), 不連網、不建資料夾、不讀快取
 *
 * @param {Object} [opt={}] 設定物件, 交fsEnsureBinsBudget(mirror、offline、env、totalMs等); 未給時讀環境變數W_BIN_MIRROR、W_BIN_OFFLINE(使用鏡像者每個來源另加1次); pkgRoot與names固定為w-ffmpeg之套件根與ffmpeg.exe
 * @returns {Number} 回傳鎖等候上限毫秒數
 */
function calcFfmpegLockLimitMs(opt = {}) {
    return fsEnsureBinsBudget('bin/manifest.json', { ...opt, pkgRoot: pkgRootFfmpeg, names: FFMPEG_NAME })
}

//FFMPEG_LOCK_LIMIT_MS, 取得之鎖等候上限(依本程序之環境變數); 逾此等候者得E_LOCK_TIMEOUT
let FFMPEG_LOCK_LIMIT_MS = calcFfmpegLockLimitMs()

//FFMPEG_BUDGET_MS, 取得之before之時限(this.timeout): 鎖等候上限之FFMPEG_BUDGET_FACTOR倍, 使並行時之最壞情形(先等他方、他方失敗才自行取得)仍由fsEnsureBins以帶code之錯誤失敗, 而非先被mocha以逾時掩蓋
//限制: ①等候上限於每換一個持有者時重新起算, 連續換手之最壞情形仍可逾本預算; ②預算依本程序載入時之環境變數(W_BIN_MIRROR、W_BIN_OFFLINE)求得, 其後才改環境變數者不反映
let FFMPEG_BUDGET_MS = FFMPEG_LOCK_LIMIT_MS * FFMPEG_BUDGET_FACTOR


/**
 * createFfmpegProvider, 建立取得ffmpeg.exe之提供者(含程序內之共用: 同一提供者之併發呼叫共用同一次取得, 失敗不記住, 下次呼叫重取)
 *
 * @param {Object} [opt={}] 設定物件
 * @param {Function} [opt.ensureBins] 取得函數(測試注入用), 預設於呼叫時取w-ffmpeg公開入口之WFfmpeg.ensureBins
 * @param {Object} [opt.env=process.env] 環境變數物件(讀W_DLP_TEST_TRACE)
 * @returns {Object} 回傳{ get }, get()回傳Promise, resolve為ffmpeg.exe之絕對路徑
 */
function createFfmpegProvider(opt = {}) {
    let ensureBins = opt.ensureBins || ((o) => WFfmpeg.ensureBins(o))
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
                .then(() => ensureBins({ names: FFMPEG_NAME, onTrace })) //不傳totalMs: 每檔上限取fsEnsureBins之預設(不短於其預設), 與預算之算式一致
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


export { ensureFfmpeg, createFfmpegProvider, calcFfmpegLockLimitMs, FFMPEG_NAME, FFMPEG_PARTS, FFMPEG_BUDGET_FACTOR, FFMPEG_LOCK_LIMIT_MS, FFMPEG_BUDGET_MS }
