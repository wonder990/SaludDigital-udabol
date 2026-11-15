export default function manifest() {
  return {
    name: 'SaludMóvil Bolivia',
    short_name: 'SaludMóvil',
    description:
      'Atención médica domiciliaria con asignación inteligente de médicos y seguimiento en el mapa.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f1f5f9',
    theme_color: '#1d4ed8',
    lang: 'es-BO',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  };
}
