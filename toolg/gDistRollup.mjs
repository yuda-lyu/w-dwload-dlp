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
        'process': 'process',
        'child_process': 'child_process',
        'archiver': 'archiver',
        'archiver-zip-encrypted': 'archiver-zip-encrypted',
        'unzipper': 'unzipper',
    },
    external: [
        'path',
        'fs',
        'process',
        'child_process',
        'archiver',
        'archiver-zip-encrypted',
        'unzipper',
    ],
})

