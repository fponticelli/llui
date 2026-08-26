import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'node', // the CLI only touches the filesystem and fetch
    },
  }),
)
