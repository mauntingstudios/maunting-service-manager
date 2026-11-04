import type { StorybookConfig } from '@storybook/react-vite'
import autoprefixer from 'autoprefixer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from 'tailwindcss'

const hier = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: { name: '@storybook/react-vite', options: {} },
  async viteFinal(viteConfig) {
    viteConfig.css = {
      ...viteConfig.css,
      postcss: {
        plugins: [
          tailwindcss({ config: path.resolve(hier, '../../../tailwind.config.ts') }),
          autoprefixer(),
        ],
      },
    }
    return viteConfig
  },
}

export default config
