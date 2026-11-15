'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="!flex !min-h-screen !max-w-none items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <p className="text-4xl" aria-hidden="true">
          ⚠️
        </p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">
          Algo salió mal
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Ocurrió un error inesperado al cargar esta sección.
        </p>

        {error?.message && (
          <p className="mt-3 rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-500">
            {error.message}
          </p>
        )}

        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={reset}>
            Reintentar
          </button>
          <Link
            href="/"
            className="rounded-lg border border-blue-700 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
