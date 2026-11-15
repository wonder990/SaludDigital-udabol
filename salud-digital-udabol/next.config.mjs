import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // La app vive dentro de un repositorio más grande: fijamos la raíz de
  // Turbopack para que no intente resolver dependencias desde C:\Users.
  turbopack: {
    root: __dirname,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
