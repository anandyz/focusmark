import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => ({
  build: {
    target: 'node18',
    outDir: 'dist',
    emptyOutDir: true,
    minify: mode === 'production',
    sourcemap: mode !== 'production',
    
    rollupOptions: {
      input: resolve(__dirname, 'src/extension.ts'),
      external: [
        'vscode',
        // Node.js built-ins
        'fs',
        'node:fs',
        'path',
        'node:path',
        'os',
        'node:os',
        'crypto',
        'node:crypto',
        'events',
        'node:events',
        'util',
        'node:util',
        'stream',
        'node:stream',
        'buffer',
        'node:buffer',
        'process',
        'node:process',
      ],
      output: {
        entryFileNames: 'extension.js',
        format: 'cjs',
        // Preserve module structure
        preserveModules: false,
        // Ensure exports are not mangled
        interop: 'auto',
      },
      treeshake: mode === 'production',
    },
  },
  
  // Development server config (not used for extension but good for tooling)
  server: {
    hmr: false, // Not needed for VS Code extensions
  },
  
  // Path resolution
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  
  // Define for build-time constants
  define: {
    __DEV__: process.env.NODE_ENV !== 'production',
  },
})) 
