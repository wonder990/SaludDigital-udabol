import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata = {
  title: {
    default: 'SaludMóvil Bolivia · Atención médica domiciliaria',
    template: '%s · SaludMóvil Bolivia',
  },
  description:
    'Plataforma de atención médica domiciliaria con asignación inteligente de médicos y seguimiento en tiempo real sobre el mapa.',
  applicationName: 'SaludMóvil Bolivia',
  authors: [{ name: 'Salud Digital UDABOL' }],
  keywords: [
    'salud',
    'atención domiciliaria',
    'médicos',
    'SIG',
    'Bolivia',
    'UDABOL',
  ],
  openGraph: {
    title: 'SaludMóvil Bolivia',
    description:
      'Solicita atención médica a domicilio y sigue la llegada del médico en el mapa.',
    locale: 'es_BO',
    type: 'website',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1d4ed8',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es-BO" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
