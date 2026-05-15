import tseslint from 'typescript-eslint';
export default tseslint.config({
  files: ['packages/**/*.ts'],
  languageOptions: { parserOptions: { project: ['packages/*/tsconfig.json'] } },
  rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
});
