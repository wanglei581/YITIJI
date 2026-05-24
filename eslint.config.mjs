import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'legacy-miaoda/**'],
  },
  /* ── Shared: TypeScript + React Hooks for all source ── */
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  /* ── Apps only: react-refresh (HMR guard, not needed in library packages) ── */
  {
    plugins: { 'react-refresh': reactRefresh },
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
