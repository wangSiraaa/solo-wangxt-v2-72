// 低内存构建管线（esbuild + vue 插件）。当宿主机内存不足以运行 Rollup/Vite 构建时使用：
//   node scripts/build-esbuild.mjs
// 输出到 dist-esbuild/。功能与 vite build 等价：SFC 编译、CSS 提取、?worker 单独打包。
import { build } from 'esbuild'
import vue from 'esbuild-plugin-vue3'
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'

const outdir = 'dist-esbuild'
rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

// 1) 主线程包：把 ?worker 导入重定向到独立入口，运行时由插件产物承担
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  outfile: `${outdir}/assets/index.js`,
  plugins: [
    vue(),
    {
      name: 'worker-bundle',
      setup(b) {
        // 在主线程包中：把 calc.worker.ts?worker 解析为一个虚拟模块
        b.onResolve({ filter: /calc\.worker\.ts\?worker$/ }, (args) => ({
          path: args.path,
          namespace: 'worker-virtual'
        }))
        b.onLoad({ filter: /.*/, namespace: 'worker-virtual' }, () => ({
          contents: `
            const url = new URL('./calc.worker.js', import.meta.url)
            export default class WorkerCtor extends Worker {
              constructor() { super(url, { type: 'module' }) }
            }
          `,
          resolveDir: process.cwd()
        }))
      }
    }
  ],
  loader: { '.css': 'text' },
  logLevel: 'info'
})

// 2) Worker 单独打包（ml-savitzky-golay + ml-matrix 内联）
await build({
  entryPoints: ['src/workers/calc.worker.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  outfile: `${outdir}/assets/calc.worker.js`,
  plugins: [vue()]
})

// 3) index.html：把入口改为 esbuild 产物
let html = readFileSync('index.html', 'utf8')
html = html.replace('/src/main.ts', '/assets/index.js')
html = html.replace('</head>', '  <link rel="stylesheet" href="/assets/index.css" />\n  </head>')
writeFileSync(`${outdir}/index.html`, html)

console.log('esbuild build ->', outdir)
