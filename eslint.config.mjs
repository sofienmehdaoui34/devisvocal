import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.tsbuildinfo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Fichiers de config Node (CommonJS) : expose les globals Node.
    files: ['**/*.config.js', '**/*.cjs'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', process: 'readonly', __dirname: 'readonly' },
    },
  },
  {
    rules: {
      // `any` toléré mais signalé (dette technique visible sans bloquer la CI).
      '@typescript-eslint/no-explicit-any': 'warn',
      // Les variables/paramètres préfixés `_` sont volontairement inutilisés.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  }
);
