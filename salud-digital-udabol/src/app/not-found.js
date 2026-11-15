import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="!flex !min-h-screen !max-w-none items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-4xl" aria-hidden="true">
          🩺
        </p>
        <h1 className="mt-2 text-xl font-bold text-slate-900">
          Página no encontrada
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          La dirección que abriste no existe o fue movida.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
