import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WDwloadDlp.mjs',
    fdSrc,
    fdTar,
    // nameDistType: 'kebabCase',
    hookNameDist: () => {
        return 'w-dwload-dlp'
    },
    globals: {
        'path': 'path',
        'fs': 'fs',
        'os': 'os',
        'process': 'process',
        'child_process': 'child_process',
        'url': 'url',
        'crypto': 'crypto',
        'stream': 'stream',
        'stream/promises': 'promises',
        'w-ffmpeg': 'w-ffmpeg',
        'archiver': 'archiver',
        'archiver-zip-encrypted': 'archiver-zip-encrypted',
        'unzipper': 'unzipper',
    },
    external: [
        'path',
        'fs',
        'os',
        'process',
        'child_process',
        'url',
        'crypto',
        'stream',
        'stream/promises',
        'w-ffmpeg',
        'archiver',
        'archiver-zip-encrypted',
        'unzipper',
    ],
})

