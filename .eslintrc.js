module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  ignorePatterns: ['.eslintrc.js', 'dist/**/*'],
  plugins: ['@typescript-eslint', 'n8n-nodes-base'],
  extends: ['plugin:n8n-nodes-base/nodes'],
  rules: {
    'n8n-nodes-base/node-param-default-missing': 'warn',
  },
};
