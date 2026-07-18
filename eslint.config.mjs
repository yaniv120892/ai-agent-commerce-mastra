import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // Agent worktrees are full checkouts with their own node_modules. Without this,
      // `npm run lint` passes inside a worktree but fails on main, so the gate is not
      // reproducible between the two.
      '.claude/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  prettier,
];

export default eslintConfig;
