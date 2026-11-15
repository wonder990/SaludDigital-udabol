'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { sb } from '../lib/supabase';

export default function Shell({ titulo, nombre, children }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    try {
      await sb.auth.signOut();
    } finally {
      router.replace('/');
      router.refresh();
    }
  }

  return (
    <>
      <header>
        <div className="min-w-0">
          <h1 className="truncate">
            <span
              className="flag-bo"
              role="img"
              aria-label="Bandera de Bolivia"
            />
            SaludMóvil Bolivia
          </h1>
          <small className="block truncate">{titulo}</small>
        </div>
        <div className="hdr shrink-0">
          <span className="hidden max-w-[180px] truncate sm:inline">
            {nombre || 'Usuario'}
          </span>
          <button
            type="button"
            className="ghost"
            onClick={salir}
            disabled={saliendo}
          >
            {saliendo ? 'Saliendo…' : 'Salir'}
          </button>
        </div>
      </header>
      {children}
    </>
  );
}
