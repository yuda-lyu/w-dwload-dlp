//假yt-dlp: 供主函數類測試(api-ensureBins、api-workFolder)取代真正之yt-dlp.exe(攔截child_process.spawn後改以node執行本檔)
//行為: 依yt-dlp之引數慣例解析-o,先在其後加.mp4.part寫出下載中之檔,結束時改寫成.mp4假影片檔(另留一個中介檔,模擬合併前之分軌檔),並輸出數列進度到stdout,離開碼0
//模式(由url路徑末段決定): fail→留下.part與中介檔,於stderr輸出ERROR並以離開碼1結束; nofile→刪除.part且不寫輸出檔,離開碼0(模擬下載中被他人刪檔); 其餘→正常
//閘門: 環境變數FAKE_DLP_GATE有值時,寫完.part後建立`${FAKE_DLP_GATE}-<末段>.started`,待`${FAKE_DLP_GATE}-<末段>`出現才繼續(供測試令併行之呼叫確定同時在跑)
//用法: node test/tools/fakeDlp.mjs <url> -o <輸出路徑(無副檔名)> ...
import fs from 'fs'
import path from 'path'


let args = process.argv.slice(2)
let url = args[0]
let i = args.indexOf('-o')
let fpBase = args[i + 1]
let fpOut = `${fpBase}.mp4`
let mode = url.split('/').pop()

//下載中之檔
fs.mkdirSync(path.dirname(fpOut), { recursive: true })
fs.writeFileSync(`${fpOut}.part`, 'FAKE-PART')

//閘門
let gate = process.env.FAKE_DLP_GATE
if (gate) {
    let fpGate = `${gate}-${mode}`
    fs.writeFileSync(`${fpGate}.started`, String(process.pid))
    let tEnd = Date.now() + 60000
    while (!fs.existsSync(fpGate)) {
        if (Date.now() > tEnd) {
            console.error('ERROR: fake yt-dlp waited for the gate too long')
            process.exit(3)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
}

//中介檔, yt-dlp正常會自行刪除, 此處刻意留下以驗證呼叫結束時是整個工作夾被刪, 而非只刪輸出檔
fs.writeFileSync(`${fpBase}.f137.mp4`, 'FAKE-STREAM')

if (mode === 'fail') {
    console.error('ERROR: [fake] intentional failure of the fake yt-dlp')
    process.exit(1)
}
fs.rmSync(`${fpOut}.part`, { force: true })
if (mode !== 'nofile') {
    fs.writeFileSync(fpOut, `FAKE-MP4 ${url}`)
}
console.log('[download]  50.0% of   10.00MiB at    1.00MiB/s ETA 00:05')
console.log('[download] 100% of   10.00MiB in 00:00:10 at 1.00MiB/s')
